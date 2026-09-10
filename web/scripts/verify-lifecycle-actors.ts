import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { setTimeout } from 'node:timers/promises'
import { Client } from 'pg'
import { claimWorkspaceDeletionCancellation, createWorkspaceExportRequest, finalizeWorkspaceDeletionCancellation, markWorkspaceDeletionPending } from '../src/lib/workspace-lifecycle-management'
import { purgeWorkspace } from '../src/lib/workspace-deletion'

const url = new URL(process.env.DATABASE_SYSTEM_URL ?? '')
assert(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && url.pathname.startsWith('/yodev_test'), 'Disposable local database required')
const db = new Client({ connectionString: url.href }), blocker = new Client({ connectionString: url.href })
const [workspaceId, organizationId, actorUserId, requestId] = Array.from({ length: 4 }, () => randomUUID())
const context = { workspaceId, actorUserId }
const operations = {
  export: () => createWorkspaceExportRequest(context),
  delete: () => markWorkspaceDeletionPending({ ...context, previousAccessState: 'active', googleRevocationConfirmed: false, stripeCancellationQueued: false }),
  claim: () => claimWorkspaceDeletionCancellation(context),
  finalize: () => finalizeWorkspaceDeletionCancellation({ ...context, requestId, previousAccessState: 'active' }),
}
type Operation = keyof typeof operations
async function restore(operation: Operation) {
  await db.query("update workspaces set owner_user_id=$2,access_state='active',plan='agency',trial_ends_at=null,deletion_requested_at=null,purge_at=null where id=$1", [workspaceId, actorUserId])
  await db.query("insert into auth_members(id,organization_id,user_id,role) values($1,$2,$1,'client') on conflict(id) do update set role='client'", [actorUserId, organizationId])
  if (['claim', 'finalize'].includes(operation)) await db.query("update workspaces set access_state='deletion_pending' where id=$1", [workspaceId])
  for (const table of ['deletion_requests', 'export_jobs', 'audit_events']) await db.query(`delete from ${table} where workspace_id=$1`, [workspaceId])
  if (['claim', 'finalize'].includes(operation)) await db.query("insert into deletion_requests(id,workspace_id,requested_by,previous_access_state,status,purge_at) values($1,$2,$3,'active',$4,clock_timestamp()+interval '1 day')", [requestId, workspaceId, actorUserId, operation === 'claim' ? 'pending' : 'cancelling'])
}
async function snapshot() { return (await db.query('select (select row_to_json(w) from workspaces w where id=$1) as workspace,(select json_agg(d order by id) from deletion_requests d where workspace_id=$1) as requests,(select json_agg(e order by id) from export_jobs e where workspace_id=$1) as exports,(select json_agg(a order by id) from audit_events a where workspace_id=$1) as audits', [workspaceId])).rows[0] }
async function waitFor(pattern: string) {
  const end = Date.now() + 5_000
  while (Date.now() < end) {
    if ((await db.query("select 1 from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and query like $1", [pattern])).rowCount) return
    await setTimeout(20)
  }
  assert.fail(`Expected database lock wait: ${pattern}`)
}
async function waitDeadline() {
  while (!(await db.query('select purge_at<=clock_timestamp() as expired from deletion_requests where id=$1', [requestId])).rows[0].expired) await setTimeout(20)
}
async function unchangedRejection(operation: Operation, pattern: RegExp) {
  const before = await snapshot()
  await assert.rejects(operations[operation], pattern)
  assert.deepEqual(await snapshot(), before)
}
async function main() {
  await db.connect(); await blocker.connect()
  try {
    await db.query('insert into auth_users(id,name,email,email_verified) values($1,$1,$2,true)', [actorUserId, `${actorUserId}@example.test`])
    await db.query('insert into auth_organizations(id,name,slug) values($1::text,$1::text,$1::text)', [organizationId])
    await db.query("insert into workspaces(id,name,slug,auth_organization_id,owner_user_id,plan,access_state) values($1,$2::text,$2::text,$2::text,$3,'agency','active')", [workspaceId, organizationId, actorUserId])
    for (const operation of Object.keys(operations) as Operation[]) {
      for (const role of ['admin', 'strategist', 'analyst', 'client']) {
        await restore(operation)
        await db.query("update workspaces set owner_user_id='different-owner' where id=$1", [workspaceId])
        await db.query('update auth_members set role=$2 where id=$1', [actorUserId, role])
        await unchangedRejection(operation, /non autorisée/)
      }
      await restore(operation); await db.query('delete from auth_members where id=$1', [actorUserId]); await unchangedRejection(operation, /non autorisée/)
      await restore(operation); await db.query("update workspaces set access_state='deleted' where id=$1", [workspaceId]); await unchangedRejection(operation, /indisponible/)
      // Owner transfer committed while the service waits must be observed before any write.
      await restore(operation)
      await blocker.query('begin'); await blocker.query("update workspaces set owner_user_id='different-owner' where id=$1", [workspaceId])
      const pending = Promise.allSettled([operations[operation]()])
      try { await waitFor('%select * from public.lock_workspace_actor%') } finally { await blocker.query('commit') }
      assert.equal((await pending)[0].status, 'rejected')
      const result = await snapshot(); assert.equal(result.audits, null); assert.equal(result.exports, null)
      if (result.requests) assert.equal(result.requests[0].status, operation === 'claim' ? 'pending' : 'cancelling')
      // Removal of the owner's membership is independently effective.
      await restore(operation)
      await blocker.query('begin'); await blocker.query('delete from auth_members where id=$1', [actorUserId])
      const removed = Promise.allSettled([operations[operation]()])
      try { await waitFor('%select * from public.lock_workspace_actor%') } finally { await blocker.query('commit') }
      assert.equal((await removed)[0].status, 'rejected'); assert.equal((await snapshot()).audits, null)
    }
    for (const state of ['internal', 'deletion_pending']) {
      await restore('delete'); await db.query('update workspaces set access_state=$2 where id=$1', [workspaceId, state]); await unchangedRejection('delete', /nouvelle demande/)
    }
    // Export remains an owner right after a downgrade, suspension, expired trial or during deletion.
    for (const state of ['internal', 'trial', 'active', 'grace', 'suspended', 'deletion_pending']) {
      await restore('export'); await db.query("update workspaces set plan='solo',access_state=$2,trial_ends_at=clock_timestamp()-interval '1 second' where id=$1", [workspaceId, state])
      await operations.export(); assert.equal((await snapshot()).exports.length, 1)
    }
    for (const operation of ['claim', 'finalize'] as const) {
      await restore(operation); await db.query("update workspaces set access_state='active' where id=$1", [workspaceId]); await unchangedRejection(operation, /ne peut plus/)
      for (const status of ['purging', 'cancelled', 'completed']) {
        await restore(operation); await db.query('update deletion_requests set status=$2 where id=$1', [requestId, status]); await unchangedRejection(operation, /ne peut plus/)
      }
    }
    for (const operation of ['claim'] as const) {
      await restore(operation); await db.query("update deletion_requests set purge_at=clock_timestamp()-interval '1 second' where id=$1", [requestId]); await unchangedRejection(operation, /ne peut plus/)
      // The deadline must be checked after an actual row wait, irrespective of the caller's timestamp.
      await restore(operation); await db.query("update deletion_requests set purge_at=clock_timestamp()+interval '1 second' where id=$1", [requestId])
      const before = await snapshot()
      await blocker.query('begin'); await blocker.query('select id from deletion_requests where id=$1 for update', [requestId])
      const pending = Promise.allSettled([operations[operation]()])
      try { await waitFor('select id from%deletion_requests%for update'); await waitDeadline() } finally { await blocker.query('commit') }
      assert.equal((await pending)[0].status, 'rejected'); assert.deepEqual(await snapshot(), before)
    }
    await restore('finalize')
    for (const previousAccessState of ['internal', 'suspended', 'deleted'] as const) {
      const before = await snapshot()
      await assert.rejects(() => finalizeWorkspaceDeletionCancellation({ ...context, requestId, previousAccessState }), /restauration/)
      assert.deepEqual(await snapshot(), before)
    }
    await assert.rejects(() => finalizeWorkspaceDeletionCancellation({ ...context, requestId: randomUUID(), previousAccessState: 'active' }), /en cours d’annulation/)
    // Acceptance itself crossing the deadline rolls back the claim even after its UPDATE.
    await restore('claim'); await db.query("update deletion_requests set purge_at=clock_timestamp()+interval '1 second' where id=$1", [requestId])
    await db.query(`create function public.lifecycle_fixture_delay() returns trigger language plpgsql as $$ begin if new.workspace_id='${workspaceId}'::uuid and new.status='cancelling' then perform pg_sleep(1.1); end if; return new; end $$`)
    await db.query('create trigger lifecycle_fixture_delay after update on deletion_requests for each row execute function public.lifecycle_fixture_delay()')
    try { await unchangedRejection('claim', /ne peut plus/) }
    finally { await db.query('drop trigger lifecycle_fixture_delay on deletion_requests'); await db.query('drop function public.lifecycle_fixture_delay()') }
    // A cancellation accepted on time remains resumable after J+30 and excludes purge.
    await restore('claim'); await db.query("update deletion_requests set purge_at=clock_timestamp()+interval '1 second' where id=$1", [requestId])
    await operations.claim(); await waitDeadline(); assert.equal(await purgeWorkspace(workspaceId), 'not_due')
    assert.equal((await operations.claim()).status, 'cancelling')
    await operations.finalize(); assert.equal((await snapshot()).workspace.access_state, 'active')
    await restore('delete'); const deleted = await operations.delete()
    assert.equal(deleted.purgeAt.getTime() - deleted.requestedAt.getTime(), 30 * 24 * 60 * 60_000)
    assert.equal((await snapshot()).workspace.access_state, 'deletion_pending')
    await operations.claim(); const retry = await operations.claim(); assert.equal(retry.status, 'cancelling')
    await finalizeWorkspaceDeletionCancellation({ ...context, requestId: retry.id, previousAccessState: 'active' })
    assert.equal((await snapshot()).workspace.access_state, 'active')
    console.log(JSON.stringify({ ok: true, verified: ['four_owner_only_service_matrices', 'eight_observed_owner_and_membership_waits', 'deleted_workspace_denied', 'owner_export_survives_downgrade_and_lifecycle', 'internal_and_duplicate_deletion_denied', 'pending_cancellation_deadline_after_row_wait', 'stored_restoration_state_and_request_identity', 'post_update_deadline_rolls_back_acceptance', 'accepted_cancellation_excludes_purge_and_resumes_after_deadline', 'owner_deletion_cancellation_and_retry'], realProviderCalls: 0 }))
  } finally {
    await blocker.query('rollback').catch(() => {}); await blocker.end()
    await db.query('delete from workspaces where id=$1', [workspaceId]); await db.query('delete from auth_organizations where id=$1', [organizationId]); await db.query('delete from auth_users where id=$1', [actorUserId]); await db.end()
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
