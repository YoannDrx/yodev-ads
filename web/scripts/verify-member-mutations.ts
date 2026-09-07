import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { setTimeout } from 'node:timers/promises'
import { Client } from 'pg'
import { inviteWorkspaceMemberWithQuota, removeWorkspaceMemberWithAudit, revokeWorkspaceInvitationWithAudit, saveMemberTaskNotificationPreferences, transferWorkspaceOwnershipWithAudit, updateWorkspaceMemberRoleWithAudit } from '../src/lib/workspace-members'
import { entitlementContext } from '../src/lib/entitlements'

const url = new URL(process.env.DATABASE_SYSTEM_URL ?? '')
assert(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && url.pathname.startsWith('/yodev_test'), 'Disposable local database required')
globalThis.fetch = async () => { throw new Error('Provider calls forbidden') }
const db = new Client({ connectionString: url.href }), blocker = new Client({ connectionString: url.href })
const [workspaceId, organizationId, actorUserId, targetUserId, otherOwner, invitationId] = Array.from({ length: 6 }, () => randomUUID())
const actor = { workspaceId, organizationId, actorUserId }
const preferences = { workspaceId, userId: actorUserId, mentionHandle: 'fixture', displayName: 'Fixture', emailAddress: 'fixture@example.test', mentionNotifications: true, digestCadence: 'daily' as const, digestHour: 8, timezone: 'Europe/Paris' }
const management = {
  invite: () => inviteWorkspaceMemberWithQuota({ ...actor, ownerUserId: actorUserId, emailAddress: 'invited@example.test', role: 'analyst', entitlements: entitlementContext('active', 'agency') }),
  role: () => updateWorkspaceMemberRoleWithAudit({ ...actor, targetUserId, role: 'client' }),
  remove: () => removeWorkspaceMemberWithAudit({ ...actor, targetUserId }),
  revoke: () => revokeWorkspaceInvitationWithAudit({ ...actor, invitationId }),
  transfer: () => transferWorkspaceOwnershipWithAudit({ ...actor, newOwnerUserId: targetUserId }),
}
const operations = { ...management, preferences: () => saveMemberTaskNotificationPreferences(preferences) }
async function snapshot() {
  return (await db.query("select (select json_agg(m order by id) from auth_members m where organization_id=$2 and user_id<>$3) as members,(select json_agg(i order by id) from auth_invitations i where organization_id=$2) as invitations,(select json_agg(j order by id) from jobs j where workspace_id=$1) as jobs,(select json_agg(p order by id) from member_notification_preferences p where workspace_id=$1) as preferences,(select json_agg(s order by id) from auth_sessions s where active_organization_id=$2) as sessions,(select count(*) from audit_events where workspace_id=$1) as audits,(select owner_user_id from workspaces where id=$1) as owner", [workspaceId, organizationId, actorUserId])).rows[0]
}
async function restoreActor() {
  await db.query("update workspaces set owner_user_id=$2::text,auth_owner_user_id=$2::text,access_state='active',plan='agency' where id=$1", [workspaceId, actorUserId])
  await db.query("insert into auth_members(id,organization_id,user_id,role) values($1,$2,$1,'owner') on conflict(id) do update set role='owner'", [actorUserId, organizationId])
}
async function waitFor(query: string, values: unknown[] = []) {
  const end = Date.now() + 5_000
  while (Date.now() < end) { if ((await db.query(query, values)).rowCount! > 0) return; await setTimeout(20) }
  assert.fail('Expected real PostgreSQL lock wait')
}
async function denyAll(label: string) {
  const before = await snapshot(), results = await Promise.allSettled(Object.values(operations).map((run) => run()))
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 0, `${label}: all six operations must refuse`); assert.deepEqual(await snapshot(), before)
}
async function main() {
  await db.connect(); await blocker.connect()
  try {
    for (const user of [actorUserId, targetUserId, otherOwner]) await db.query('insert into auth_users(id,name,email,email_verified) values($1,$1,$2,true)', [user, `${user}@example.test`])
    await db.query('insert into auth_organizations(id,name,slug) values($1::text,$1::text,$1::text)', [organizationId])
    await db.query("insert into workspaces(id,name,slug,auth_organization_id,owner_user_id,auth_owner_user_id,plan,access_state) values($1,$2::text,$2::text,$2::text,$3::text,$3::text,'agency','active')", [workspaceId, organizationId, actorUserId])
    for (const user of [actorUserId, targetUserId, otherOwner]) await db.query("insert into auth_members(id,organization_id,user_id,role) values($1,$2,$1,'analyst')", [user, organizationId])
    await db.query("insert into auth_invitations(id,organization_id,email,role,status,expires_at,inviter_id) values($1,$2,'existing@example.test','analyst','pending',now()+interval '1 day',$3)", [invitationId, organizationId, actorUserId])
    await db.query("insert into auth_sessions(id,token,user_id,active_organization_id,expires_at) values($1,$1,$1,$2,now()+interval '1 day')", [targetUserId, organizationId])
    await db.query('delete from auth_members where id=$1', [actorUserId]); await denyAll('Removed actor')
    await restoreActor()
    for (const state of ['grace', 'suspended', 'deletion_pending', 'deleted']) { await db.query('update workspaces set access_state=$1 where id=$2', [state, workspaceId]); await denyAll(state) }
    await db.query("update workspaces set access_state='trial',trial_ends_at=clock_timestamp()-interval '1 second' where id=$1", [workspaceId]); await denyAll('Expired trial')
    // A Better Auth leave/delete does not acquire the application's workspace advisory lock.
    for (const [name, run] of Object.entries(management)) {
      await restoreActor(); const before = await snapshot()
      await blocker.query('begin'); await blocker.query('delete from auth_members where id=$1', [actorUserId])
      const pending = Promise.allSettled([run()])
      try { await waitFor("select 1 from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and query like 'select%auth_members%'") }
      finally { await blocker.query('commit') }
      assert.equal((await pending)[0].status, 'rejected', `${name} must observe the committed actor deletion`); assert.deepEqual(await snapshot(), before)
    }
    await restoreActor()
    // The target can leave after the original membership read as well.
    await blocker.query('begin'); await blocker.query('delete from auth_members where id=$1', [targetUserId])
    const transfer = Promise.allSettled([management.transfer()])
    try { await waitFor("select 1 from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and query like 'select%auth_members%'") }
    finally { await blocker.query('commit') }
    assert.equal((await transfer)[0].status, 'rejected', 'A removed target cannot become owner')
    assert.equal((await db.query('select owner_user_id from workspaces where id=$1', [workspaceId])).rows[0].owner_user_id, actorUserId)
    assert.equal((await db.query('select role from auth_members where id=$1', [actorUserId])).rows[0].role, 'owner')
    await db.query("insert into auth_members(id,organization_id,user_id,role) values($1,$2,$1,'analyst')", [targetUserId, organizationId])
    for (const [name, run] of Object.entries(operations)) {
      await restoreActor(); await db.query("update workspaces set access_state='trial',trial_ends_at=clock_timestamp()+interval '1 second' where id=$1", [workspaceId])
      const before = await snapshot()
      await blocker.query('begin'); await blocker.query('lock table audit_events in share mode')
      const pending = Promise.allSettled([run()])
      try {
        await waitFor("select 1 from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and query like '%insert into%audit_events%'")
        while (!(await db.query('select trial_ends_at<=clock_timestamp() as expired from workspaces where id=$1', [workspaceId])).rows[0].expired) await setTimeout(20)
      } finally { await blocker.query('commit') }
      assert.equal((await pending)[0].status, 'rejected', `${name} must roll back after expiry`); assert.deepEqual(await snapshot(), before)
      assert.equal((await db.query('select role from auth_members where id=$1', [actorUserId])).rows[0].role, 'owner')
    }
    // Intentional relinquishing of one's own permission remains valid during an unexpired trial.
    await restoreActor(); await db.query("update workspaces set access_state='trial',trial_ends_at=clock_timestamp()+interval '1 hour' where id=$1", [workspaceId])
    await management.invite(); await management.revoke(); await operations.preferences(); await management.transfer()
    await updateWorkspaceMemberRoleWithAudit({ ...actor, targetUserId: actorUserId, role: 'client' })
    await assert.rejects(management.invite, /Permission required/)
    await operations.preferences() // A current client member can manage their own preferences.
    await db.query("update auth_members set role='admin' where id=$1", [actorUserId])
    await removeWorkspaceMemberWithAudit({ ...actor, targetUserId: actorUserId })
    assert.equal((await db.query('select count(*) from auth_members where id=$1', [actorUserId])).rows[0].count, '0')
    console.log(JSON.stringify({ ok: true, verified: ['removed_inactive_expired_denials', 'five_actor_row_waits_outside_advisory', 'removed_transfer_target_denied', 'six_post_authorization_trial_rollbacks', 'valid_transfer_self_demotion_self_removal', 'client_personal_preferences_allowed', 'invitation_job_atomic'], providerCalls: 0 }))
  } finally {
    await blocker.query('rollback').catch(() => {}); await blocker.end()
    await db.query('delete from workspaces where id=$1', [workspaceId]); await db.query('delete from auth_organizations where id=$1', [organizationId])
    await db.query('delete from auth_users where id=any($1::text[])', [[actorUserId, targetUserId, otherOwner]]); await db.end()
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
