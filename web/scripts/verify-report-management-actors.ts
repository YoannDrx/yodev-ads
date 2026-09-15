import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { setTimeout } from 'node:timers/promises'
import { Client } from 'pg'
import * as reports from '../src/lib/report-management'
import { entitlementContext } from '../src/lib/entitlements'
import { encryptSecret } from '../src/lib/crypto'
import { hashToken } from '../src/lib/tokens'

const url = new URL(process.env.DATABASE_SYSTEM_URL ?? '')
assert(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && url.pathname.startsWith('/yodev_test'), 'Disposable local database required')
globalThis.fetch = async () => { throw new Error('Provider calls forbidden') }
const db = new Client({ connectionString: url.href }), blocker = new Client({ connectionString: url.href })
const [workspaceId, organizationId, actor, clientId, templateId, shareId, scheduleId] = Array.from({ length: 7 }, () => randomUUID())
const workerOwner = randomUUID()
const context = { workspaceId, actorUserId: actor }, oldContext = entitlementContext('active', 'agency')
const template = { ...context, name: 'Fixture new template', locale: 'fr' as const, periodDays: 30 }
const operations = {
  template_create: () => reports.createWorkspaceReportTemplate(template),
  template_update: () => reports.updateWorkspaceReportTemplate({ ...template, templateId, expectedVersion: 1 }),
  template_deactivate: () => reports.deactivateWorkspaceReportTemplate({ ...context, templateId }),
  schedule_create: () => reports.createWorkspaceReportSchedule({ ...context, workspaceLocale: 'fr', name: 'Fixture new schedule', clientId, templateId, cadence: 'weekly', scheduleWeekday: 1, scheduleMonthday: 1, sendHour: 8, timezone: 'Europe/Paris', recipientEmails: ['fixture@example.test'], token: randomUUID(), entitlements: oldContext }),
  schedule_enable: () => reports.setWorkspaceReportScheduleEnabled({ ...context, scheduleId, enabled: true, replacementToken: randomUUID(), entitlements: oldContext }),
  schedule_rotate: () => reports.rotateWorkspaceScheduledReportToken({ ...context, scheduleId, token: randomUUID() }),
}
async function snapshot() { return (await db.query('select (select json_agg(t order by id) from report_templates t where workspace_id=$1) as templates,(select json_agg(v order by id) from report_template_versions v where workspace_id=$1) as versions,(select json_agg(s order by id) from report_schedules s where workspace_id=$1) as schedules,(select json_agg(l order by id) from share_links l where workspace_id=$1) as links,(select json_agg(a order by id) from audit_events a where workspace_id=$1) as audits', [workspaceId])).rows[0] }
async function restore() {
  await db.query("update workspaces set access_state='active',plan='agency',trial_ends_at=null where id=$1", [workspaceId])
  await db.query("insert into auth_members(id,organization_id,user_id,role) values($1,$2,$1,'admin') on conflict(id) do update set role='admin'", [actor, organizationId])
  await db.query('delete from share_links where workspace_id=$1', [workspaceId]); await db.query('delete from report_templates where workspace_id=$1', [workspaceId]); await db.query('delete from audit_events where workspace_id=$1', [workspaceId])
  await db.query("insert into report_templates(id,workspace_id,created_by,name) values($1,$2,$3,'Fixture original')", [templateId, workspaceId, actor])
  await db.query("insert into report_template_versions(workspace_id,template_id,version,edited_by,snapshot) values($1,$2,1,$3,'{\"name\":\"Fixture original\",\"locale\":\"fr\",\"periodDays\":30}')", [workspaceId, templateId, actor])
  const token = randomUUID()
  await db.query("insert into share_links(id,workspace_id,client_id,created_by,label,token_hash,token_prefix,encrypted_report_token,active) values($1,$2,$3,$4,'Fixture report',$5,$6,$7,false)", [shareId, workspaceId, clientId, actor, hashToken(token), token.slice(0, 12), encryptSecret(token)])
  await db.query("insert into report_schedules(id,workspace_id,client_id,template_id,share_id,created_by,name,cadence,schedule_weekday,recipient_emails,encrypted_report_token,enabled) values($1,$2,$3,$4,$5,$6,'Fixture schedule','weekly',1,ARRAY['fixture@example.test'],$7,false)", [scheduleId, workspaceId, clientId, templateId, shareId, actor, encryptSecret(token)])
}
async function denied(operation: () => Promise<unknown>, label: string) { const before = await snapshot(); await assert.rejects(operation(), /non autorisée|Quota/, label); assert.deepEqual(await snapshot(), before) }
async function waitFor(pattern: string) {
  const end = Date.now() + 5_000
  while (Date.now() < end) { if ((await db.query("select 1 from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and query like $1", [pattern])).rowCount) return; await setTimeout(20) }
  assert.fail(`Expected lock wait: ${pattern}`)
}
async function blocked(operation: () => Promise<unknown>, trial = false) {
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
    await db.query("insert into clients(id,workspace_id,google_customer_id,name,active) values($1,$2,'8480000001','Fixture advertiser',true)", [clientId, workspaceId])
    for (const [name, operation] of Object.entries(operations)) {
      for (const role of ['client', 'strategist']) { await restore(); await db.query('update auth_members set role=$1 where id=$2', [role, actor]); await denied(operation, `${name}:${role}`) }
      await db.query('delete from auth_members where id=$1', [actor]); await denied(operation, `${name}:removed`)
      for (const state of ['grace', 'suspended', 'deletion_pending', 'deleted']) { await restore(); await db.query('update workspaces set access_state=$1 where id=$2', [state, workspaceId]); await denied(operation, `${name}:${state}`) }
      await restore(); await blocked(operation)
      await restore(); await db.query("update workspaces set access_state='trial',trial_ends_at=clock_timestamp()+interval '1 second' where id=$1", [workspaceId]); await blocked(operation, true)
      await restore(); await db.query("update auth_members set role='analyst' where id=$1", [actor]); await operation()
      assert.equal((await snapshot()).audits.length, 1, `${name}: analyst retains report management`)
    }
    for (const operation of [operations.schedule_create, operations.schedule_enable]) {
      await restore(); await db.query("update workspaces set plan='solo' where id=$1", [workspaceId])
      for (let index = 0; index < 3; index++) await db.query("insert into share_links(workspace_id,client_id,created_by,label,token_hash,token_prefix) values($1,$2,$3,'Quota fixture',$4,'fixture')", [workspaceId, clientId, actor, hashToken(randomUUID())])
      await denied(operation, 'Current plan quota')
    }
    for (const operation of [operations.schedule_enable, operations.schedule_rotate]) {
      await restore()
      const before = await snapshot()
      await blocker.query('begin')
      await blocker.query("update report_schedules set delivery_lease_owner=$2,delivery_lease_until=clock_timestamp()+interval '1 hour' where id=$1", [scheduleId, workerOwner])
      const pending = Promise.allSettled([operation()])
      try { await waitFor('%"report_schedules"%') } finally { await blocker.query('commit') }
      assert.equal((await pending)[0].status, 'rejected', 'A lease acquired during a schedule row wait blocks the mutation')
      const after = await snapshot()
      assert.deepEqual(after.links, before.links)
      assert.deepEqual(after.audits, before.audits)
      assert.equal(after.schedules[0].encrypted_report_token, before.schedules[0].encrypted_report_token)
      assert.equal(after.schedules[0].enabled, false)
      assert.equal(after.schedules[0].delivery_lease_owner, workerOwner)

      await restore()
      await db.query("update report_schedules set delivery_lease_owner=$2,delivery_lease_until=clock_timestamp()+interval '250 milliseconds' where id=$1", [scheduleId, workerOwner])
      await blocker.query('begin'); await blocker.query('select id from auth_members where id=$1 for update', [actor])
      const waiting = Promise.allSettled([operation()])
      try {
        await waitFor('%select * from public.lock_workspace_actor%')
        while (!(await db.query('select delivery_lease_until<=clock_timestamp() as expired from report_schedules where id=$1', [scheduleId])).rows[0].expired) await setTimeout(20)
      } finally { await blocker.query('commit') }
      assert.equal((await waiting)[0].status, 'fulfilled', 'A lease expired during authorization does not falsely block a mutation')
      assert.equal((await snapshot()).audits.length, 1)
    }
    await restore(); const concurrent = await Promise.allSettled([operations.template_update(), operations.template_update()]); assert.equal(concurrent.filter((r) => r.status === 'fulfilled').length, 1)
    const final = await snapshot(); assert.equal(final.templates[0].current_version, 2); assert.equal(final.versions.length, 2); assert.equal(final.audits.length, 1)
    console.log(JSON.stringify({ ok: true, verified: ['six_actor_role_and_lifecycle_denials', 'six_observed_membership_waits', 'six_post_authorization_trial_rollbacks', 'analyst_retains_all_six_operations', 'current_quota_despite_old_agency_context', 'concurrent_template_version_preserves_one_revision', 'two_schedule_row_waits_observe_new_worker_lease', 'two_lease_expiries_during_actor_wait_allow_mutation'], providerCalls: 0 }))
  } finally {
    await blocker.query('rollback').catch(() => {}); await blocker.end()
    await db.query('delete from workspaces where id=$1', [workspaceId]); await db.query('delete from auth_organizations where id=$1', [organizationId]); await db.query('delete from auth_users where id=$1', [actor]); await db.end()
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
