import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { setTimeout } from 'node:timers/promises'
import { Client } from 'pg'
import { createTenantWorkspaceTask, updateTenantWorkspaceTask, addTenantWorkspaceTaskComment } from '../src/lib/workspace-task-actions'

const url = new URL(process.env.DATABASE_SYSTEM_URL ?? '')
assert(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && url.pathname.startsWith('/yodev_test'), 'Disposable local database required')
globalThis.fetch = async () => { throw new Error('Provider calls forbidden') }
const db = new Client({ connectionString: url.href }), blocker = new Client({ connectionString: url.href })
const [workspaceId, organization, owner, actorUserId, taskId] = Array.from({ length: 5 }, () => randomUUID())
const actor = { workspaceId, actorUserId }, timezone = 'Europe/Paris'
const operations = {
  create: () => createTenantWorkspaceTask({ ...actor, timezone, sourceType: 'manual', title: 'Task actor fixture', priority: 'normal', assignSelf: true }),
  update: () => updateTenantWorkspaceTask({ ...actor, timezone, taskId, operation: 'assign_self' }),
  comment: () => addTenantWorkspaceTaskComment({ ...actor, taskId, body: 'Task actor @recipient', notificationsEnabled: true }),
}
async function snapshot() {
  return (await db.query("select (select count(*) from workspace_tasks where workspace_id=$1) as tasks,(select count(*) from task_comments where workspace_id=$1) as comments,(select count(*) from audit_events where workspace_id=$1) as audits,(select count(*) from jobs where workspace_id=$1) as jobs,(select row_to_json(t) from workspace_tasks t where id=$2) as task", [workspaceId, taskId])).rows[0]
}
async function denied(label: string) {
  const before = await snapshot(), results = await Promise.allSettled(Object.values(operations).map((run) => run()))
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 0, `${label}: all three task mutations must refuse`)
  assert.deepEqual(await snapshot(), before, `${label}: denied transactions must leave no writes`)
}
async function waitFor(query: string, values: unknown[] = []) {
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    if ((await db.query(query, values)).rowCount! > 0) return
    await setTimeout(20)
  }
  assert.fail('Expected a real PostgreSQL lock wait')
}
async function main() {
  await db.connect(); await blocker.connect()
  try {
    for (const user of [owner, actorUserId]) await db.query('insert into auth_users(id,name,email,email_verified) values($1,$1,$2,true)', [user, `task-${user}@example.test`])
    await db.query('insert into auth_organizations(id,name,slug) values($1::text,$1::text,$1::text)', [organization])
    await db.query("insert into workspaces(id,name,slug,auth_organization_id,owner_user_id,auth_owner_user_id,plan,access_state) values($1,$2::text,$2::text,$2::text,$3::text,$3::text,'agency','active')", [workspaceId, organization, owner])
    await db.query("insert into auth_members(id,organization_id,user_id,role) values($1,$2,$3,'client')", [randomUUID(), organization, actorUserId])
    await db.query("insert into workspace_tasks(id,workspace_id,created_by,title,description) values($1,$2,$3,'Task fixture','Fixture')", [taskId, workspaceId, owner])
    await db.query("insert into member_notification_preferences(workspace_id,auth_user_id,mention_handle,display_name,encrypted_email) values($1,$2,'recipient','Recipient','fixture-not-deliverable')", [workspaceId, owner])
    await denied('Role revoked after action precheck')
    await db.query('delete from auth_members where organization_id=$1', [organization]); await denied('Removed membership')
    await db.query("insert into auth_members(id,organization_id,user_id,role) values($1,$2,$3,'strategist')", [randomUUID(), organization, actorUserId])
    for (const state of ['grace', 'suspended', 'deletion_pending', 'deleted']) {
      await db.query('update workspaces set access_state=$1 where id=$2', [state, workspaceId]); await denied(state)
    }
    await db.query("update workspaces set access_state='trial',plan='internal',trial_ends_at=now()-interval '1 second' where id=$1", [workspaceId]); await denied('Expired trial with internal plan')
    await db.query("update workspaces set access_state='active',plan='agency' where id=$1", [workspaceId])
    for (const [name, run] of Object.entries(operations)) {
      const before = await snapshot()
      await blocker.query('begin')
      await blocker.query('select pg_advisory_xact_lock(hashtext($1))', [`${workspaceId}:workspace-access`])
      await blocker.query("update auth_members set role='client' where organization_id=$1", [organization])
      const pending = Promise.allSettled([run()])
      try {
        await waitFor("select 1 from pg_locks where locktype='advisory' and not granted and objid=(hashtext($1)::bigint & 4294967295)::oid", [`${workspaceId}:workspace-access`])
      } finally { await blocker.query('commit') }
      assert.equal((await pending)[0].status, 'rejected', `${name} must observe revoked role`)
      assert.deepEqual(await snapshot(), before)
      await db.query("update auth_members set role='strategist' where organization_id=$1", [organization])
    }
    // A concurrent completion outside the access lock must not be overwritten from an old 'todo' read.
    await blocker.query('begin')
    await blocker.query("update workspace_tasks set status='done',completed_at=clock_timestamp() where id=$1", [taskId])
    const transition = Promise.allSettled([updateTenantWorkspaceTask({ ...actor, timezone, taskId, operation: 'start' })])
    try {
      await waitFor("select 1 from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and query like '%workspace_tasks%'")
    } finally { await blocker.query('commit') }
    assert.equal((await transition)[0].status, 'rejected', 'A completed task cannot be started from its stale todo status')
    assert.equal((await snapshot()).task.status, 'done')
    assert.equal((await snapshot()).audits, '0')
    await db.query("update workspace_tasks set status='todo',completed_at=null where id=$1", [taskId])
    // Each mutation reaches a business lock after authorization, then crosses the trial deadline.
    for (const [name, run] of Object.entries(operations)) {
      await db.query("update workspaces set access_state='trial',plan='agency',trial_ends_at=clock_timestamp()+interval '1 second' where id=$1", [workspaceId])
      const before = await snapshot()
      await blocker.query('begin')
      if (name === 'create') await blocker.query('lock table workspace_tasks in share mode')
      else await blocker.query('select id from workspace_tasks where id=$1 for update', [taskId])
      const pending = Promise.allSettled([run()])
      try {
        await waitFor("select 1 from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and (query like '%workspace_tasks%' or query like '%task_comments%')")
        while (!(await db.query('select trial_ends_at<=clock_timestamp() as expired from workspaces where id=$1', [workspaceId])).rows[0].expired) await setTimeout(20)
      } finally { await blocker.query('commit') }
      assert.equal((await pending)[0].status, 'rejected', `${name} must roll back after trial expiry`)
      assert.deepEqual(await snapshot(), before, 'Task, comment, mention job and audit must all roll back')
    }
    await db.query("update workspaces set access_state='active',plan='agency' where id=$1", [workspaceId])
    // Analyst retains discussion rights while management remains denied.
    await db.query("update auth_members set role='analyst' where organization_id=$1", [organization])
    await assert.rejects(operations.create, /non autorisée/); await assert.rejects(operations.update, /non autorisée/)
    const comment = await operations.comment(); assert.equal(comment.notificationCount, 1)
    await db.query("update auth_members set role='strategist' where organization_id=$1", [organization])
    await operations.create(); await operations.update()
    const after = await snapshot()
    assert.equal(after.tasks, '2'); assert.equal(after.comments, '1'); assert.equal(after.jobs, '1'); assert.equal(after.audits, '3'); assert.equal(after.task.assigned_to, actorUserId)
    console.log(JSON.stringify({ ok: true, verified: ['three_mutations_deny_revoked_removed_inactive_actor', 'three_observed_access_lock_waits', 'concurrent_task_transition_uses_current_status', 'three_post_authorization_trial_waits_roll_back_all_writes', 'analyst_can_comment_but_cannot_manage', 'strategist_can_create_and_assign', 'mention_job_atomic_with_comment'], providerCalls: 0 }))
  } finally {
    await blocker.query('rollback').catch(() => {}); await blocker.end()
    await db.query('delete from workspaces where id=$1', [workspaceId])
    await db.query('delete from auth_organizations where id=$1', [organization])
    await db.query('delete from auth_users where id=any($1::text[])', [[owner, actorUserId]])
    await db.end()
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
