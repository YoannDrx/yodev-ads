import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { setTimeout } from 'node:timers/promises'
import { Client } from 'pg'
import { entitlementContext } from '../src/lib/entitlements'
import { acknowledgeWorkspaceAlert, createWorkspaceMonitoringAgent, requestWorkspaceMonitoringScan, setWorkspaceMonitoringAgentEnabled, updateWorkspaceAlertWorkflow } from '../src/lib/monitoring-workflows'

const url = new URL(process.env.DATABASE_SYSTEM_URL ?? '')
assert(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && url.pathname.startsWith('/yodev_test'), 'Disposable local database required')
globalThis.fetch = async () => { throw new Error('Provider calls forbidden') }
process.env.GOOGLE_READS_ENABLED = '1'; process.env.SCHEDULER_ENABLED = '1'
const db = new Client({ connectionString: url.href }), blocker = new Client({ connectionString: url.href })
const [workspaceId, organization, owner, actorUserId, clientId, agentId, incidentId] = Array.from({ length: 7 }, () => randomUUID())
const actor = { workspaceId, actorUserId }, scanNow = new Date()
const operations = {
  create: () => createWorkspaceMonitoringAgent({ ...actor, clientId, kind: 'no_delivery', name: 'Actor fixture', description: 'Fixture', threshold: 0, reminderIntervalHours: null, entitlements: entitlementContext('internal', 'internal') }),
  toggle: () => setWorkspaceMonitoringAgentEnabled({ ...actor, agentId, enabled: true }),
  scan: () => requestWorkspaceMonitoringScan({ ...actor, now: scanNow }),
  acknowledge: () => acknowledgeWorkspaceAlert({ ...actor, incidentId }),
  workflow: () => updateWorkspaceAlertWorkflow({ ...actor, incidentId, operation: 'resolve', comment: 'Guard fixture' }),
}
async function unchanged() {
  return (await db.query("select (select count(*)::int from monitoring_agents where workspace_id=$1) as monitors,(select count(*)::int from audit_events where workspace_id=$1) as audits,(select count(*)::int from jobs where workspace_id=$1) as jobs,(select count(*)::int from alert_comments where workspace_id=$1) as comments,(select status from alert_incidents where id=$2) as status,(select enabled from monitoring_agents where id=$3) as enabled", [workspaceId, incidentId, agentId])).rows[0]
}
async function denied(label: string) {
  const before = await unchanged(), results = await Promise.allSettled(Object.values(operations).map((run) => run()))
  assert.equal(results.filter((item) => item.status === 'fulfilled').length, 0, `${label}: all five mutations must refuse a stale actor; results=${results.map((item) => item.status).join(',')}`)
  assert.deepEqual(await unchanged(), before, `${label}: no business write, job, comment or audit`)
}
async function main() {
  await db.connect(); await blocker.connect()
  try {
    for (const user of [owner, actorUserId]) await db.query('insert into auth_users(id,name,email,email_verified) values($1,$1,$2,true)', [user, `monitor-actor-${user}@example.test`])
    await db.query('insert into auth_organizations(id,name,slug) values($1::text,$1::text,$1::text)', [organization])
    await db.query("insert into workspaces(id,name,slug,auth_organization_id,owner_user_id,auth_owner_user_id,plan,access_state) values($1,$2::text,$2::text,$2::text,$3::text,$3::text,'agency','active')", [workspaceId, organization, owner])
    await db.query("insert into auth_members(id,organization_id,user_id,role) values($1,$2,$3,'analyst')", [randomUUID(), organization, actorUserId])
    await db.query("insert into clients(id,workspace_id,google_customer_id,name) values($1,$2,'9100000034','Actor fixture')", [clientId, workspaceId])
    await db.query("insert into monitoring_agents(id,workspace_id,created_by,kind,name,description,threshold,enabled) values($1,$2,$3,'no_delivery','Actor fixture','Fixture',0,false)", [agentId, workspaceId, owner])
    await db.query("insert into alert_incidents(id,workspace_id,client_id,agent_id,fingerprint,title,description) values($1,$2,$3,$4,'actor-fixture','Actor fixture','Fixture')", [incidentId, workspaceId, clientId, agentId])
    await denied('Role revoked after action precheck')
    await db.query('delete from auth_members where organization_id=$1', [organization]); await denied('Membership removed')
    await db.query("insert into auth_members(id,organization_id,user_id,role) values($1,$2,$3,'strategist')", [randomUUID(), organization, actorUserId])
    for (const state of ['grace', 'suspended', 'deletion_pending', 'deleted']) {
      await db.query('update workspaces set access_state=$1 where id=$2', [state, workspaceId]); await denied(state)
    }
    await db.query("update workspaces set access_state='trial',plan='internal',trial_ends_at=now()-interval '1 second' where id=$1", [workspaceId]); await denied('Expired trial with internal plan')
    await db.query("update workspaces set access_state='active',plan='agency' where id=$1", [workspaceId])
    for (const [name, run] of Object.entries(operations)) {
      const before = await unchanged()
      await blocker.query('begin')
      await blocker.query('select pg_advisory_xact_lock(hashtext($1))', [`${workspaceId}:workspace-access`])
      await blocker.query("update auth_members set role='analyst' where organization_id=$1 and user_id=$2", [organization, actorUserId])
      const pending = Promise.allSettled([run()])
      try {
        let waiting = false
        const deadline = Date.now() + 5000
        while (Date.now() < deadline) {
          waiting = (await db.query("select 1 from pg_locks where locktype='advisory' and not granted and objid=(hashtext($1)::bigint & 4294967295)::oid", [`${workspaceId}:workspace-access`])).rowCount! > 0
          if (waiting) break
          await setTimeout(20)
        }
        assert(waiting, `${name} must wait for the access lock`)
      } finally { await blocker.query('commit') }
      assert.equal((await pending)[0].status, 'rejected', `${name} must observe the committed revoked role`)
      assert.deepEqual(await unchanged(), before)
      await db.query("update auth_members set role='strategist' where organization_id=$1", [organization])
    }
    // Time can expire after the actor locks, while waiting for quota, a business row, or a unique job key.
    for (const [name, run] of Object.entries(operations)) {
      await db.query("update workspaces set access_state='trial',plan='agency',trial_ends_at=clock_timestamp()+interval '1 second' where id=$1", [workspaceId])
      const before = await unchanged(), blockedJobId = randomUUID()
      await blocker.query('begin')
      if (name === 'create' || name === 'toggle') await blocker.query('select pg_advisory_xact_lock(hashtext($1))', [`${workspaceId}:monitors`])
      else if (name === 'scan') await blocker.query("insert into jobs(id,workspace_id,type,deduplication_key) values($1,$2,'monitoring.scan',$3)", [blockedJobId, workspaceId, `monitoring.manual:${workspaceId}:${Math.floor(scanNow.getTime()/300000)}`])
      else await blocker.query('select id from alert_incidents where id=$1 for update', [incidentId])
      const pending = Promise.allSettled([run()])
      try {
        let waiting = false
        const deadline = Date.now()+5000
        while (Date.now()<deadline) {
          waiting = (await db.query("select 1 from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and pid<>$1 and (query like '%pg_advisory_xact_lock%' or query like 'update \"alert_incidents\"%' or query like 'insert into \"jobs\"%')", [(await blocker.query('select pg_backend_pid() as pid')).rows[0].pid])).rowCount!>0
          if (waiting) break
          await setTimeout(20)
        }
        assert(waiting, `${name} must reach its business lock after authorization`)
        while (!(await db.query('select trial_ends_at<=clock_timestamp() as expired from workspaces where id=$1',[workspaceId])).rows[0].expired) await setTimeout(20)
      } finally { await blocker.query('commit') }
      assert.equal((await pending)[0].status,'rejected',`${name} must roll back after trial expiry during its business wait`)
      if (name==='scan') await db.query('delete from jobs where id=$1',[blockedJobId])
      assert.deepEqual(await unchanged(),before,`${name} expiry must roll back all writes`)
      assert.equal((await db.query('select count(*)::int as count from activation_milestones where workspace_id=$1',[workspaceId])).rows[0].count,0)
    }
    await db.query("update workspaces set access_state='active',plan='agency' where id=$1", [workspaceId])
    // A permitted strategist retains the complete set of operations.
    for (const run of Object.values(operations)) await run()
    const after = await unchanged()
    assert.equal(after.monitors, 2); assert.equal(after.enabled, true); assert.equal(after.jobs, 1)
    assert.equal(after.status, 'resolved'); assert.equal(after.comments, 1); assert.equal(after.audits, 5)
    console.log(JSON.stringify({ ok: true, verified: ['five_mutations_deny_revoked_or_removed_actor', 'inactive_and_expired_trial_denied', 'five_real_lock_waits_reauthorize', 'five_post_authorization_waits_roll_back_expired_trials', 'no_denied_business_job_comment_audit_write', 'strategist_retains_all_five_operations'], providerCalls: 0 }))
  } finally {
    await blocker.query('rollback').catch(() => {}); await blocker.end()
    await db.query('delete from workspaces where id=$1', [workspaceId])
    await db.query('delete from auth_organizations where id=$1', [organization])
    await db.query('delete from auth_users where id=any($1::text[])', [[owner, actorUserId]])
    await db.end()
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
