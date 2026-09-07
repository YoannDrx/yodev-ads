import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { setTimeout } from 'node:timers/promises'
import { Client } from 'pg'
import { saveClientGoal, saveWorkspaceLocale, saveWorkspaceApprovalPolicy, saveWorkspaceBranding, saveWorkspaceLogo } from '../src/lib/workspace-settings'
import { savePortfolioView, deletePortfolioView } from '../src/lib/portfolio-views'

const url = new URL(process.env.DATABASE_SYSTEM_URL ?? '')
assert(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && url.pathname.startsWith('/yodev_test'), 'Disposable local database required')
globalThis.fetch = async () => { throw new Error('Provider calls forbidden') }
const db = new Client({ connectionString: url.href }), blocker = new Client({ connectionString: url.href })
const [workspaceId, organization, owner, actorUserId, clientId, viewId, version] = Array.from({ length: 7 }, () => randomUUID())
const actor = { workspaceId, actorUserId }, criteria = { q: '', currency: '', attention: 'all' as const, assignee: '' }
const goal = { ...actor, clientId, currencyCode: 'USD', primaryKpi: 'cpa' as const, monthlyBudget: 123.45, targetCpa: '' as const, targetRoas: '' as const, targetConversions: '' as const, targetConversionValue: '' as const, conversionValue: '' as const, marginPercent: '' as const }
const operations = {
  goal: () => saveClientGoal(goal),
  locale: () => saveWorkspaceLocale({ ...actor, previousLocale: 'en', locale: 'en' }),
  policy: () => saveWorkspaceApprovalPolicy({ ...actor, previousRequiredApprovals: 2, previousAllowSelfApproval: true, requiredApprovals: 2, allowSelfApproval: false, approvalMode: 'single' }),
  branding: () => saveWorkspaceBranding({ ...actor, brandName: 'Settings fixture', brandTagline: 'Controlled brand', accentColor: '#123456' }),
  logo: () => saveWorkspaceLogo({ ...actor, logoUrl: null }),
  view_create: () => savePortfolioView({ ...actor, name: 'Fixture new view', criteria }),
  view_update: () => savePortfolioView({ ...actor, id: viewId, version, name: 'Fixture updated view', criteria }),
  view_delete: () => deletePortfolioView({ ...actor, id: viewId, version }),
}
async function snapshot() {
  return (await db.query("select (select json_build_object('locale',locale,'required',required_approvals,'self',allow_self_approval,'mode',approval_mode,'brand',brand_name,'tagline',brand_tagline,'color',accent_color,'logo',logo_url) from workspaces where id=$1) as settings,(select json_agg(g order by id) from client_goals g where workspace_id=$1) as goals,(select json_agg(v order by id) from portfolio_views v where workspace_id=$1) as views,(select count(*) from audit_events where workspace_id=$1) as audits", [workspaceId])).rows[0]
}
async function denied(label: string) {
  const before = await snapshot(), results = await Promise.allSettled(Object.values(operations).map((run) => run()))
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 0, `${label}: all eight mutations must refuse`)
  assert.deepEqual(await snapshot(), before)
}
async function waitFor(query: string, values: unknown[] = []) {
  const end = Date.now() + 5_000
  while (Date.now() < end) { if ((await db.query(query, values)).rowCount! > 0) return; await setTimeout(20) }
  assert.fail('Expected a real PostgreSQL lock wait')
}
async function main() {
  await db.connect(); await blocker.connect()
  try {
    for (const user of [owner, actorUserId]) await db.query('insert into auth_users(id,name,email,email_verified) values($1,$1,$2,true)', [user, `settings-${user}@example.test`])
    await db.query('insert into auth_organizations(id,name,slug) values($1::text,$1::text,$1::text)', [organization])
    await db.query("insert into workspaces(id,name,slug,auth_organization_id,owner_user_id,auth_owner_user_id,plan,access_state) values($1,$2::text,$2::text,$2::text,$3::text,$3::text,'agency','active')", [workspaceId, organization, owner])
    await db.query("insert into auth_members(id,organization_id,user_id,role) values($1,$2,$3,'client')", [randomUUID(), organization, actorUserId])
    await db.query("insert into clients(id,workspace_id,google_customer_id,name,currency_code) values($1,$2,'9100000037','Settings fixture','EUR')", [clientId, workspaceId])
    await db.query("insert into portfolio_views(id,workspace_id,user_id,name,version,criteria) values($1,$2,$3,'Original view',$4,$5)", [viewId, workspaceId, actorUserId, version, criteria])
    await denied('Revoked role')
    await db.query('delete from auth_members where organization_id=$1', [organization]); await denied('Removed membership')
    await db.query("insert into auth_members(id,organization_id,user_id,role) values($1,$2,$3,'admin')", [randomUUID(), organization, actorUserId])
    for (const state of ['grace', 'suspended', 'deletion_pending', 'deleted']) { await db.query('update workspaces set access_state=$1 where id=$2', [state, workspaceId]); await denied(state) }
    await db.query("update workspaces set access_state='trial',plan='internal',trial_ends_at=now()-interval '1 second' where id=$1", [workspaceId]); await denied('Expired trial')
    await db.query("update workspaces set access_state='active',plan='agency' where id=$1", [workspaceId])
    for (const [name, run] of Object.entries(operations)) {
      const before = await snapshot()
      await blocker.query('begin'); await blocker.query('select pg_advisory_xact_lock(hashtext($1))', [`${workspaceId}:workspace-access`])
      await blocker.query("update auth_members set role='client' where organization_id=$1", [organization])
      const pending = Promise.allSettled([run()])
      try { await waitFor("select 1 from pg_locks where locktype='advisory' and not granted and objid=(hashtext($1)::bigint & 4294967295)::oid", [`${workspaceId}:workspace-access`]) }
      finally { await blocker.query('commit') }
      assert.equal((await pending)[0].status, 'rejected', `${name} must reauthorize after waiting`); assert.deepEqual(await snapshot(), before)
      await db.query("update auth_members set role='admin' where organization_id=$1", [organization])
    }
    // A downgrade while waiting must remove white-label and dual-approval capabilities.
    for (const name of ['policy', 'branding', 'logo'] as const) {
      await db.query("update workspaces set plan='agency' where id=$1", [workspaceId])
      const before = await snapshot()
      await blocker.query('begin'); await blocker.query('select pg_advisory_xact_lock(hashtext($1))', [`${workspaceId}:workspace-access`])
      await blocker.query("update workspaces set plan='solo' where id=$1", [workspaceId])
      const pending = Promise.allSettled([operations[name]()])
      try { await waitFor("select 1 from pg_locks where locktype='advisory' and not granted and objid=(hashtext($1)::bigint & 4294967295)::oid", [`${workspaceId}:workspace-access`]) }
      finally { await blocker.query('commit') }
      assert.equal((await pending)[0].status, 'rejected'); assert.deepEqual(await snapshot(), before)
    }
    await db.query("update workspaces set plan='agency' where id=$1", [workspaceId])
    await assert.rejects(() => saveWorkspaceApprovalPolicy({ ...actor, previousRequiredApprovals: 1, previousAllowSelfApproval: false, requiredApprovals: 1, allowSelfApproval: true, approvalMode: 'single' }), /désactivée/)
    await db.query('update clients set is_manager=true where id=$1', [clientId]); await assert.rejects(operations.goal, /introuvable/)
    await db.query('update clients set is_manager=false where id=$1', [clientId])
    // Business-row waits after authorization: goal upsert, view insert/update/delete, and workspace audit insertion.
    for (const [name, run] of Object.entries(operations)) {
      await db.query("update workspaces set access_state='trial',plan='agency',trial_ends_at=clock_timestamp()+interval '1 second' where id=$1", [workspaceId])
      const before = await snapshot()
      await blocker.query('begin')
      if (name === 'goal') await blocker.query('lock table client_goals in share mode')
      else if (name.startsWith('view_')) await blocker.query('lock table portfolio_views in share mode')
      else await blocker.query('lock table audit_events in share mode')
      const pending = Promise.allSettled([run()])
      try {
        await waitFor("select 1 from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and (query like '%client_goals%' or query like '%portfolio_views%' or query like '%audit_events%')")
        while (!(await db.query('select trial_ends_at<=clock_timestamp() as expired from workspaces where id=$1', [workspaceId])).rows[0].expired) await setTimeout(20)
      } finally { await blocker.query('commit') }
      assert.equal((await pending)[0].status, 'rejected', `${name} must roll back after expiry`); assert.deepEqual(await snapshot(), before)
    }
    await db.query("update workspaces set access_state='active',plan='agency',locale='fr',required_approvals=1,allow_self_approval=false,approval_mode='single',logo_url='https://example.test/previous.png' where id=$1", [workspaceId])
    await operations.goal(); await operations.locale(); await operations.policy(); await operations.branding()
    const logo = await operations.logo()
    assert.deepEqual(logo, { previousLogoUrl: 'https://example.test/previous.png' })
    const events = (await db.query('select action,metadata from audit_events where workspace_id=$1', [workspaceId])).rows
    assert.equal(events.find((event) => event.action === 'client.goal_updated').metadata.currencyCode, 'EUR')
    assert.equal(events.find((event) => event.action === 'workspace.locale_updated').metadata.previousLocale, 'fr')
    const policy = events.find((event) => event.action === 'workspace.approval_policy_updated').metadata
    assert.equal(policy.previousRequiredApprovals, 1); assert.equal(policy.previousAllowSelfApproval, false); assert.equal(policy.approvalMode, 'dual')
    await db.query("update auth_members set role='analyst' where organization_id=$1", [organization])
    await assert.rejects(operations.locale, /non autorisée/)
    await operations.view_create(); await operations.view_update()
    const updated = (await db.query('select version from portfolio_views where id=$1', [viewId])).rows[0]
    await deletePortfolioView({ ...actor, id: viewId, version: updated.version })
    console.log(JSON.stringify({ ok: true, verified: ['eight_mutations_deny_revoked_removed_inactive_actor', 'eight_observed_access_waits', 'downgrade_rechecks_dual_and_branding', 'eight_post_authorization_trial_waits_roll_back', 'manager_goal_denied_and_current_currency_audited', 'current_previous_settings_audited', 'current_replaced_logo_returned', 'analyst_retains_personal_views_not_settings'], providerCalls: 0 }))
  } finally {
    await blocker.query('rollback').catch(() => {}); await blocker.end()
    await db.query('delete from workspaces where id=$1', [workspaceId]); await db.query('delete from auth_organizations where id=$1', [organization])
    await db.query('delete from auth_users where id=any($1::text[])', [[owner, actorUserId]]); await db.end()
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
