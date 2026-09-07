import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { setTimeout } from 'node:timers/promises'
import { Client } from 'pg'
import { createWorkspacePublicReport, reviseWorkspacePublicReport, revokeWorkspacePublicReport } from '../src/lib/public-report-workflows'
import { entitlementContext } from '../src/lib/entitlements'
import { encryptSecret, decryptSecret } from '../src/lib/crypto'
import { hashToken } from '../src/lib/tokens'

const url = new URL(process.env.DATABASE_SYSTEM_URL ?? '')
assert(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && url.pathname.startsWith('/yodev_test'), 'Disposable local database required')
globalThis.fetch = async () => { throw new Error('Provider calls forbidden') }
const db = new Client({ connectionString: url.href }), blocker = new Client({ connectionString: url.href })
const [workspaceId, organizationId, actor, clientId] = Array.from({ length: 4 }, () => randomUUID())
const context = { workspaceId, actorUserId: actor }, entitlements = entitlementContext('active', 'agency')
let shareId = '', editionId = ''
const publish = (label = 'Fixture new report') => createWorkspacePublicReport({ ...context, clientId, label, locale: 'fr', periodDays: 7, mode: 'fixed', token: randomUUID(), entitlements, fallbackOrigin: 'https://ads.example.test' })
const operations = {
  publish: () => publish(),
  revise: () => reviseWorkspacePublicReport({ ...context, shareId, previousEditionId: editionId, fallbackOrigin: 'https://ads.example.test' }),
  revoke: () => revokeWorkspacePublicReport({ ...context, shareId }),
}
async function snapshot() { return (await db.query('select (select json_agg(l order by id) from share_links l where workspace_id=$1) as links,(select json_agg(e order by id) from report_editions e where workspace_id=$1) as editions,(select json_agg(a order by id) from audit_events a where workspace_id=$1) as audits,(select json_agg(s order by id) from secret_revelations s where workspace_id=$1) as secrets,(select json_agg(m order by id) from activation_milestones m where workspace_id=$1) as milestones,(select json_agg(s order by id) from report_schedules s where workspace_id=$1) as schedules', [workspaceId])).rows[0] }
async function restore() {
  await db.query("update workspaces set access_state='active',plan='agency',trial_ends_at=null where id=$1", [workspaceId])
  await db.query("insert into auth_members(id,organization_id,user_id,role) values($1,$2,$1,'admin') on conflict(id) do update set role='admin'", [actor, organizationId])
  await db.query('delete from share_links where workspace_id=$1', [workspaceId]); await db.query('delete from secret_revelations where workspace_id=$1', [workspaceId]); await db.query('delete from audit_events where workspace_id=$1', [workspaceId])
  await publish('Fixture initial')
  shareId = (await db.query('select id from share_links where workspace_id=$1', [workspaceId])).rows[0].id
  editionId = (await db.query('select id from report_editions where share_id=$1', [shareId])).rows[0].id
}
async function denied(operation: () => Promise<unknown>, label: string) { const before = await snapshot(); await assert.rejects(operation(), /non autorisée|Quota/, label); assert.deepEqual(await snapshot(), before) }
async function waitFor(pattern: string) {
  const end = Date.now() + 5_000
  while (Date.now() < end) { if ((await db.query("select 1 from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and query like $1", [pattern])).rowCount) return; await setTimeout(20) }
  assert.fail(`Expected lock wait: ${pattern}`)
}
async function actorWait(operation: () => Promise<unknown>, trial = false) {
  const before = await snapshot()
  await blocker.query('begin'); await blocker.query(trial ? 'lock table audit_events in share mode' : `update auth_members set role='client' where id='${actor}'`)
  const pending = Promise.allSettled([operation()])
  try {
    await waitFor(trial ? 'insert into%audit_events%' : '%select * from public.lock_workspace_actor%')
    if (trial) while (!(await db.query('select trial_ends_at<=clock_timestamp() as expired from workspaces where id=$1', [workspaceId])).rows[0].expired) await setTimeout(20)
  } finally { await blocker.query('commit') }
  assert.equal((await pending)[0].status, 'rejected'); assert.deepEqual(await snapshot(), before)
}
async function main() {
  await db.connect(); await blocker.connect()
  try {
    await db.query('insert into auth_users(id,name,email,email_verified) values($1,$1,$2,true)', [actor, `${actor}@example.test`])
    await db.query('insert into auth_organizations(id,name,slug) values($1::text,$1::text,$1::text)', [organizationId])
    await db.query("insert into workspaces(id,name,slug,auth_organization_id,owner_user_id,plan,access_state) values($1,$2::text,$2::text,$2::text,'other-owner','agency','active')", [workspaceId, organizationId])
    await db.query("insert into clients(id,workspace_id,google_customer_id,name,timezone,currency_code,active) values($1,$2,'8490000001','Fixture advertiser','Europe/Paris','EUR',true)", [clientId, workspaceId])
    await db.query("insert into daily_account_metrics(workspace_id,client_id,metric_date,currency_code,timezone,cost_micros,clicks,conversions,coverage_status,source_version,source_observed_at) select $1,$2,((now() at time zone 'Europe/Paris')::date-days)::text,'EUR','Europe/Paris','1000000','10','1','complete','fixture',now() from generate_series(1,8) days", [workspaceId, clientId])
    for (const [name, operation] of Object.entries(operations)) {
      for (const role of ['client', 'strategist']) { await restore(); await db.query('update auth_members set role=$1 where id=$2', [role, actor]); await denied(operation, `${name}:${role}`) }
      await db.query('delete from auth_members where id=$1', [actor]); await denied(operation, `${name}:removed`)
      for (const state of ['grace', 'suspended', 'deletion_pending', 'deleted']) { await restore(); await db.query('update workspaces set access_state=$1 where id=$2', [state, workspaceId]); await denied(operation, `${name}:${state}`) }
      await restore(); await actorWait(operation)
      await restore(); await db.query("update workspaces set access_state='trial',trial_ends_at=clock_timestamp()+interval '1 second' where id=$1", [workspaceId]); await actorWait(operation, true)
      await restore(); await db.query("update auth_members set role='analyst' where id=$1", [actor]); await operation()
    }
    await restore(); await db.query("update workspaces set plan='solo' where id=$1", [workspaceId]); await publish('Quota 2'); await publish('Quota 3'); await denied(operations.publish, 'Current Solo quota')
    // A credential replaced while the revision waits must be the one revealed.
    await restore(); const token = randomUUID()
    await blocker.query('begin'); await blocker.query('update share_links set token_hash=$1,encrypted_report_token=$2 where id=$3', [hashToken(token), encryptSecret(token), shareId])
    const pending = Promise.allSettled([operations.revise()])
    try { await waitFor('%share_links%for update%') } finally { await blocker.query('commit') }
    const revised = (await pending)[0]; assert.equal(revised.status, 'fulfilled')
    if (revised.status === 'fulfilled') {
      const secret = (await db.query('select encrypted_secret from secret_revelations where id=$1', [revised.value.id])).rows[0].encrypted_secret
      assert(decryptSecret(secret).includes(`/r/${token}?edition=`), 'Revision must reveal the credential read after the lock')
    }
    // An expired delivery lease must be evaluated after the schedule row wait.
    await restore(); const scheduleId = randomUUID(), beforeClock = new Date()
    await db.query("insert into report_schedules(id,workspace_id,client_id,share_id,created_by,name,cadence,schedule_weekday,recipient_emails,encrypted_report_token,delivery_lease_owner,delivery_lease_until) values($1,$2,$3,$4,$5,'Fixture leased report','weekly',1,ARRAY['fixture@example.test'],$6,$1,clock_timestamp()+interval '1 second')", [scheduleId, workspaceId, clientId, shareId, actor, encryptSecret('fixture-report-token')])
    await blocker.query('begin'); await blocker.query('select id from report_schedules where id=$1 for update', [scheduleId])
    const revoked = Promise.allSettled([revokeWorkspacePublicReport({ ...context, shareId, now: beforeClock })])
    try {
      await waitFor('%report_schedules%for update%')
      while (!(await db.query('select delivery_lease_until<=clock_timestamp() as expired from report_schedules where id=$1', [scheduleId])).rows[0].expired) await setTimeout(20)
    } finally { await blocker.query('commit') }
    assert.equal((await revoked)[0].status, 'fulfilled'); assert.equal((await snapshot()).links[0].active, false); assert.equal((await snapshot()).schedules[0].enabled, false)
    console.log(JSON.stringify({ ok: true, verified: ['three_actor_role_and_lifecycle_denials', 'three_membership_waits', 'three_trial_waits_rollback_editions_links_revelations_audits', 'analyst_retains_publication_revision_revocation', 'current_plan_quota', 'revision_reveals_current_rotated_credential_after_wait', 'revocation_uses_post_wait_delivery_clock'], providerCalls: 0 }))
  } finally {
    await blocker.query('rollback').catch(() => {}); await blocker.end()
    await db.query('delete from workspaces where id=$1', [workspaceId]); await db.query('delete from auth_organizations where id=$1', [organizationId]); await db.query('delete from auth_users where id=$1', [actor]); await db.end()
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
