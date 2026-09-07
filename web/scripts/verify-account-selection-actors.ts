import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { setTimeout } from 'node:timers/promises'
import { Client } from 'pg'
import { getWorkspaceAccountSelection, saveManagedAccountSelection } from '../src/lib/account-selection'

const url = new URL(process.env.DATABASE_SYSTEM_URL ?? '')
assert(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && url.pathname.startsWith('/yodev_test'), 'Disposable local database required')
globalThis.fetch = async () => { throw new Error('Provider calls forbidden') }
const db = new Client({ connectionString: url.href }), blocker = new Client({ connectionString: url.href })
const [workspaceId, organizationId, actorUserId, first, second] = Array.from({ length: 5 }, () => randomUUID())
async function snapshot() {
  return (await db.query('select (select json_agg(c order by id) from clients c where workspace_id=$1) as clients,(select json_agg(a order by id) from audit_events a where workspace_id=$1) as audits,(select json_agg(m order by id) from activation_milestones m where workspace_id=$1) as milestones,(select json_agg(j order by id) from jobs j where workspace_id=$1) as jobs', [workspaceId])).rows[0]
}
async function restore() {
  await db.query("update workspaces set access_state='active',plan='agency',trial_ends_at=null where id=$1", [workspaceId])
  await db.query("insert into auth_members(id,organization_id,user_id,role) values($1,$2,$1,'admin') on conflict(id) do update set role='admin'", [actorUserId, organizationId])
}
async function operation(priorityOnly: boolean) {
  const { version } = await getWorkspaceAccountSelection(workspaceId)
  return () => saveManagedAccountSelection({ workspaceId, actorUserId, clientIds: [second, first], version, priorityOnly })
}
async function deniedBoth(label: string) {
  for (const mode of [false, true]) {
    const before = await snapshot()
    await assert.rejects(await operation(mode), `${label}: ${mode ? 'priorities' : 'selection'} must refuse`)
    assert.deepEqual(await snapshot(), before)
  }
}
async function waitFor(query: string) {
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    if ((await db.query(query)).rowCount) return
    await setTimeout(20)
  }
  assert.fail('Expected a real PostgreSQL lock wait')
}
async function main() {
  await db.connect(); await blocker.connect()
  try {
    await db.query('insert into auth_users(id,name,email,email_verified) values($1,$1,$2,true)', [actorUserId, `${actorUserId}@example.test`])
    await db.query('insert into auth_organizations(id,name,slug) values($1::text,$1::text,$1::text)', [organizationId])
    await db.query("insert into workspaces(id,name,slug,auth_organization_id,owner_user_id,plan,access_state) values($1,$2::text,$2::text,$2::text,'different-owner','agency','active')", [workspaceId, organizationId])
    await db.query("insert into clients(id,workspace_id,google_customer_id,name,managed_selected,management_priority,google_accessible,active) values($1,$3,'7420000001','First',true,0,true,true),($2,$3,'7420000002','Second',true,1,true,true)", [first, second, workspaceId])
    for (const role of ['analyst', 'strategist', 'client']) {
      await restore(); await db.query('update auth_members set role=$1 where id=$2', [role, actorUserId]); await deniedBoth(role)
    }
    await db.query('delete from auth_members where id=$1', [actorUserId]); await deniedBoth('removed')
    for (const state of ['grace', 'suspended', 'deletion_pending', 'deleted']) {
      await restore(); await db.query('update workspaces set access_state=$1 where id=$2', [state, workspaceId]); await deniedBoth(state)
    }
    await restore(); await db.query("update workspaces set access_state='trial',trial_ends_at=clock_timestamp()-interval '1 second' where id=$1", [workspaceId]); await deniedBoth('expired trial')
    for (const mode of [false, true]) {
      await restore(); const run = await operation(mode), before = await snapshot()
      await blocker.query('begin'); await blocker.query("update auth_members set role='client' where id=$1", [actorUserId])
      const pending = Promise.allSettled([run()])
      try { await waitFor("select 1 from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and query like '%select * from public.lock_workspace_actor%'") }
      finally { await blocker.query('commit') }
      assert.equal((await pending)[0].status, 'rejected'); assert.deepEqual(await snapshot(), before)
    }
    for (const mode of [false, true]) {
      await restore(); await db.query("update workspaces set access_state='trial',trial_ends_at=clock_timestamp()+interval '1 second' where id=$1", [workspaceId])
      const run = await operation(mode), before = await snapshot()
      await blocker.query('begin'); await blocker.query('lock table audit_events in share mode')
      const pending = Promise.allSettled([run()])
      try {
        await waitFor("select 1 from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and query like 'insert into%audit_events%'")
        while (!(await db.query('select trial_ends_at<=clock_timestamp() as expired from workspaces where id=$1', [workspaceId])).rows[0].expired) await setTimeout(20)
      } finally { await blocker.query('commit') }
      assert.equal((await pending)[0].status, 'rejected'); assert.deepEqual(await snapshot(), before)
    }
    await restore(); const old = await operation(false), before = await snapshot()
    await db.query("update workspaces set plan='solo' where id=$1", [workspaceId])
    await assert.rejects(old, /changed/); assert.deepEqual(await snapshot(), before)
    await restore(); await (await operation(true))(); await (await operation(false))()
    assert.deepEqual((await getWorkspaceAccountSelection(workspaceId)).accounts.filter((account) => account.managedSelected).sort((a, b) => a.managementPriority - b.managementPriority).map((account) => account.id), [second, first])
    assert.equal((await db.query('select count(*) from activation_milestones where workspace_id=$1', [workspaceId])).rows[0].count, '1')
    assert.equal((await db.query("select count(*) from audit_events where workspace_id=$1 and action in ('google_ads.account_priorities_saved','google_ads.account_selection_saved')", [workspaceId])).rows[0].count, '2')
    console.log(JSON.stringify({ ok: true, verified: ['both_modes_refuse_removed_demoted_inactive_actor', 'two_membership_row_waits_outside_advisory', 'two_post_authorization_trial_rollbacks', 'selection_priority_activation_audit_atomic', 'stale_plan_version_rejected', 'authorized_admin_selection_and_priority'], providerCalls: 0 }))
  } finally {
    await blocker.query('rollback').catch(() => {}); await blocker.end()
    await db.query('delete from workspaces where id=$1', [workspaceId]); await db.query('delete from auth_organizations where id=$1', [organizationId])
    await db.query('delete from auth_users where id=$1', [actorUserId]); await db.end()
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
