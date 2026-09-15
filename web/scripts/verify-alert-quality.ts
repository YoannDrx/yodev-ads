import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { setTimeout } from 'node:timers/promises'
import { Client } from 'pg'
import { sql } from 'drizzle-orm'
import { withTenantTransaction } from '../src/db/transactions'
import { reviewAlertQuality } from '../src/lib/alert-quality'
import { alertQualityState } from '../src/lib/alert-quality-model'
import { lockWorkspaceActor } from '../src/lib/workspace-actor-guard'
import { listAlertPage } from '../src/lib/workspace-collections'

const url = new URL(process.env.DATABASE_SYSTEM_URL ?? '')
assert(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && url.pathname.startsWith('/yodev_test'), 'Disposable local database required')
globalThis.fetch = async () => { throw new Error('Provider calls forbidden') }
const db = new Client({ connectionString: url.href }), blocker = new Client({ connectionString: url.href })
const [workspaceId, foreignId, org, foreignOrg, owner, actor, clientId, foreignClient, agentId, foreignAgent, incidentId, foreignIncident] = Array.from({ length: 12 }, () => randomUUID())
const input = { workspaceId, actorUserId: actor, incidentId, label: 'useful', expectedOccurrence: 1, expectedVersion: 0 }
function code(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined
  if ('code' in error && typeof error.code === 'string') return error.code
  return 'cause' in error ? code(error.cause) : undefined
}
const current = async () => (await db.query('select quality_label as "qualityLabel",quality_occurrence as "qualityOccurrence",quality_version as "qualityVersion",occurrence_count as "occurrenceCount",status from alert_incidents where id=$1', [incidentId])).rows[0]
async function main() {
  await db.connect(); await blocker.connect()
  try {
    for (const user of [owner, actor]) await db.query('insert into auth_users(id,name,email,email_verified) values($1,$1,$2,true)', [user, `quality-${user}@example.test`])
    for (const organization of [org, foreignOrg]) await db.query('insert into auth_organizations(id,name,slug) values($1::text,$1::text,$1::text)', [organization])
    for (const [id, organization] of [[workspaceId, org], [foreignId, foreignOrg]]) await db.query("insert into workspaces(id,name,slug,auth_organization_id,owner_user_id,auth_owner_user_id,plan,access_state) values($1,$2::text,$2::text,$2::text,$3::text,$3::text,'studio','active')", [id, organization, owner])
    await db.query("insert into auth_members(id,organization_id,user_id,role) values($1,$2,$3,'strategist')", [randomUUID(), org, actor])
    for (const [id, workspace, client, agent] of [[incidentId, workspaceId, clientId, agentId], [foreignIncident, foreignId, foreignClient, foreignAgent]]) {
      await db.query("insert into clients(id,workspace_id,google_customer_id,name) values($1,$2,'9100000091','Quality fixture')", [client, workspace])
      await db.query("insert into monitoring_agents(id,workspace_id,created_by,kind,name,description,threshold) values($1,$2,$3,'no_delivery','Quality fixture','Quality fixture',1)", [agent, workspace, owner])
      await db.query("insert into alert_incidents(id,workspace_id,client_id,agent_id,fingerprint,title,description) values($1,$2,$3,$4,'quality-fixture','Quality fixture','Quality fixture')", [id, workspace, client, agent])
    }
    assert.equal(alertQualityState(await current()), 'unreviewed')
    const race = await Promise.allSettled([reviewAlertQuality(input), reviewAlertQuality({ ...input, label: 'noise' })])
    assert.equal(race.filter((result) => result.status === 'fulfilled').length, 1)
    assert.equal((await current()).qualityVersion, 1)
    assert.equal((await current()).status, 'open')
    assert.equal((await db.query("select count(*)::int as count from audit_events where workspace_id=$1 and action='monitoring.alert_quality_reviewed'", [workspaceId])).rows[0].count, 1)
    await db.query('update alert_incidents set occurrence_count=2 where id=$1', [incidentId])
    assert.equal(alertQualityState(await current()), 'stale')
    let page = await listAlertPage(workspaceId)
    assert.equal(page.summary.staleReviews, 1); assert.equal(page.summary.useful + page.summary.noise + page.summary.falsePositive, 0)
    await assert.rejects(() => reviewAlertQuality({ ...input, expectedVersion: 1 }), /changed/)
    await reviewAlertQuality({ ...input, label: 'false_positive', expectedVersion: 1, expectedOccurrence: 2 })
    page = await listAlertPage(workspaceId)
    assert.equal(page.summary.falsePositive, 1); assert.equal(page.summary.staleReviews, 0)
    await assert.rejects(() => reviewAlertQuality({ ...input, incidentId: foreignIncident }), /changed/)
    await assert.rejects(() => reviewAlertQuality({ ...input, workspaceId: foreignId, incidentId: foreignIncident }), /non autorisée/)
    await assert.rejects(() => withTenantTransaction({ workspaceId, userId: actor }, (tx) => tx.execute(sql`select * from auth_members`)), (error: unknown) => code(error) === '42501')
    await assert.rejects(() => withTenantTransaction({ workspaceId, userId: actor }, (tx) => lockWorkspaceActor(tx, { ...input, workspaceId: foreignId, permission: 'alerts:manage' })), (error: unknown) => code(error) === '42501')
    await assert.rejects(() => withTenantTransaction({ workspaceId, userId: actor }, (tx) => lockWorkspaceActor(tx, { ...input, actorUserId: owner, permission: 'alerts:manage' })), (error: unknown) => code(error) === '42501')
    // Crossing the trial deadline while waiting must use time after lock acquisition.
    await db.query("update workspaces set access_state='trial',plan='internal',trial_ends_at=clock_timestamp()+interval '1 second' where id=$1", [workspaceId])
    await blocker.query('begin')
    await blocker.query('select pg_advisory_xact_lock(hashtext($1))', [`${workspaceId}:workspace-access`])
    const crossingExpiry = Promise.allSettled([reviewAlertQuality({ ...input, expectedVersion: 2, expectedOccurrence: 2 })])
    try {
      const deadline = Date.now() + 5_000
      let waiting = false
      while (Date.now() < deadline) {
        waiting = (await db.query("select 1 from pg_locks where locktype='advisory' and not granted and objid=(hashtext($1)::bigint & 4294967295)::oid", [`${workspaceId}:workspace-access`])).rowCount! > 0
        if (waiting) break
        await setTimeout(20)
      }
      assert(waiting)
      while (!(await db.query('select trial_ends_at<=clock_timestamp() as expired from workspaces where id=$1', [workspaceId])).rows[0].expired) await setTimeout(20)
    } finally { await blocker.query('commit') }
    const expiryResult = (await crossingExpiry)[0]
    assert.equal(expiryResult.status, 'rejected', 'A trial expiring during the lock wait must refuse the mutation')
    assert.equal((await current()).qualityVersion, 2)
    // The alert row can block after actor authorization, including an idempotent review.
    for (const label of ['useful', 'unreviewed', 'false_positive']) {
      await db.query("update workspaces set access_state='trial',plan='studio',trial_ends_at=clock_timestamp()+interval '1 second' where id=$1", [workspaceId])
      const before = await current()
      const auditCount = (await db.query('select count(*) from audit_events where workspace_id=$1', [workspaceId])).rows[0].count
      await blocker.query('begin')
      await blocker.query('select id from alert_incidents where id=$1 for update', [incidentId])
      const result = Promise.allSettled([reviewAlertQuality({ ...input, label, expectedVersion: 2, expectedOccurrence: 2 })])
      try {
        const deadline = Date.now() + 5_000
        let waiting = false
        while (Date.now() < deadline) {
          waiting = (await db.query("select 1 from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and query like '%quality_label%' and query like '%for update%'" )).rowCount! > 0
          if (waiting) break
          await setTimeout(20)
        }
        assert(waiting, 'Review must wait for the alert row after actor authorization')
        while (!(await db.query('select trial_ends_at<=clock_timestamp() as expired from workspaces where id=$1', [workspaceId])).rows[0].expired) await setTimeout(20)
      } finally { await blocker.query('commit') }
      assert.equal((await result)[0].status, 'rejected', `Trial expiry after actor authorization must reject ${label}`)
      assert.deepEqual(await current(), before)
      assert.equal((await db.query('select count(*) from audit_events where workspace_id=$1', [workspaceId])).rows[0].count, auditCount)
    }
    for (const state of ['grace', 'suspended', 'deletion_pending', 'deleted']) {
      await db.query('update workspaces set access_state=$1 where id=$2', [state, workspaceId])
      await assert.rejects(() => reviewAlertQuality({ ...input, expectedVersion: 2, expectedOccurrence: 2 }), /non autorisée/)
    }
    await db.query("update workspaces set access_state='trial',plan='internal',trial_ends_at=now()-interval '1 day' where id=$1", [workspaceId])
    await assert.rejects(() => reviewAlertQuality({ ...input, expectedVersion: 2, expectedOccurrence: 2 }), /non autorisée/)
    await db.query("update workspaces set access_state='active',plan='studio',trial_ends_at=null where id=$1", [workspaceId])
    // A role change outside the workspace advisory lock must also be serialized by membership row locking.
    await blocker.query('begin')
    await blocker.query("update auth_members set role='analyst' where organization_id=$1 and user_id=$2", [org, actor])
    const pending = Promise.allSettled([reviewAlertQuality({ ...input, expectedVersion: 2, expectedOccurrence: 2 })])
    try {
      let waiting = false
      const deadline = Date.now() + 5_000
      while (Date.now() < deadline) {
        waiting = (await db.query("select 1 from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and query like '%lock_workspace_actor%'" )).rowCount! > 0
        if (waiting) break
        await setTimeout(20)
      }
      assert(waiting, 'Review must wait for the changed membership row')
    } finally { await blocker.query('commit') }
    assert.equal((await pending)[0].status, 'rejected')
    assert.equal((await current()).qualityVersion, 2)
    await db.query("update auth_members set role='strategist' where organization_id=$1 and user_id=$2", [org, actor])
    for (const clause of ["quality_label=null", 'quality_occurrence=null', "quality_label='resolved'", 'quality_occurrence=3', "quality_reviewed_by=''", 'quality_version=-1']) {
      await assert.rejects(() => db.query(`update alert_incidents set ${clause} where id=$1`, [incidentId]), (error: unknown) => code(error) === '23514')
    }
    await reviewAlertQuality({ ...input, label: 'unreviewed', expectedVersion: 2, expectedOccurrence: 2 })
    assert.equal((await current()).qualityVersion, 3); assert.equal((await current()).qualityLabel, null)
    assert.equal((await listAlertPage(workspaceId)).summary.unreviewed, 1)
    console.log(JSON.stringify({ ok: true, verified: ['single_concurrent_review', 'observation_and_review_conflicts', 'no_workflow_mutation', 'stale_review_excluded_from_current_quality', 'tenant_and_context_denials', 'global_auth_tables_remain_private', 'inactive_and_expired_trial_denied', 'trial_expiry_during_lock_wait_denied', 'post_authorization_alert_wait_rolls_back_review_reset_and_noop', 'membership_row_wait_reauthorization', 'complete_review_constraint', 'audited_reset'], providerCalls: 0 }))
  } finally {
    await blocker.query('rollback')
    await db.query('delete from workspaces where id=any($1::uuid[])', [[workspaceId, foreignId]])
    await db.query('delete from auth_organizations where id=any($1::text[])', [[org, foreignOrg]])
    await db.query('delete from auth_users where id=any($1::text[])', [[owner, actor]])
    await blocker.end(); await db.end()
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
