import assert from 'node:assert/strict'
import { setTimeout } from 'node:timers/promises'
import { Client } from 'pg'
import { entitlementContext } from '../src/lib/entitlements'
import { inviteWorkspaceMemberWithQuota, removeWorkspaceMemberWithAudit, transferWorkspaceOwnershipWithAudit, updateWorkspaceMemberRoleWithAudit, workspaceMemberRoster } from '../src/lib/workspace-members'
import { resolveWorkspaceSelection } from '../src/lib/workspace-selection'

const url = new URL(process.env.DATABASE_SYSTEM_URL ?? '')
assert(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && url.pathname.startsWith('/yodev_test'), 'Disposable local database required')
globalThis.fetch = async () => { throw new Error('Provider calls forbidden') }
const db = new Client({ connectionString: url.href }), blocker = new Client({ connectionString: url.href })
const workspaceId = '86000000-0000-4000-8000-000000000001', foreignId = '86000000-0000-4000-8000-000000000002'
const organizationId = 'membership-boundary-main', foreignOrg = 'membership-boundary-other'
const owner = 'membership-boundary-owner', admin = 'membership-boundary-admin', member = 'membership-boundary-member'
const input = { workspaceId, organizationId, actorUserId: owner }
async function cleanup() {
  await db.query('delete from workspaces where id=any($1::uuid[])', [[workspaceId, foreignId]])
  await db.query('delete from auth_organizations where id=any($1::text[])', [[organizationId, foreignOrg]])
  await db.query('delete from auth_users where id=any($1::text[])', [[owner, admin, member]])
}

// Wait for evidence of an actual blocked application transaction, not a timer
// guessing that the operation probably started before the change committed.
async function changeWhileWaiting(change: () => Promise<unknown>, operation: () => Promise<unknown>) {
  await blocker.query('begin')
  await blocker.query('select pg_advisory_xact_lock(hashtext($1))', [`${workspaceId}:workspace-access`])
  let pending: Promise<PromiseSettledResult<unknown>[]> | undefined
  try {
    await change()
    pending = Promise.allSettled([operation()])
    const deadline = Date.now() + 5_000
    let waiting = false
    while (Date.now() < deadline) {
      waiting = (await db.query("select 1 from pg_locks where locktype='advisory' and not granted and objid=(hashtext($1)::bigint & 4294967295)::oid", [`${workspaceId}:workspace-access`])).rowCount! > 0
      if (waiting) break
      await setTimeout(20)
    }
    assert(waiting, 'Application mutation must wait for the workspace access lock')
    await blocker.query('commit')
    const [result] = await pending
    assert.equal(result.status, 'rejected', 'Stale authority must be rejected after lock acquisition')
  } finally {
    await blocker.query('rollback')
    if (pending) await pending
  }
}

async function main() {
  await db.connect(); await blocker.connect(); await cleanup()
  try {
    for (const user of [owner, admin, member]) await db.query('insert into auth_users(id,name,email,email_verified) values($1,$1,$2,true)', [user, `${user}@example.test`])
    for (const org of [organizationId, foreignOrg]) await db.query('insert into auth_organizations(id,name,slug) values($1::text,$1::text,$1::text)', [org])
    for (const [id, org] of [[workspaceId, organizationId], [foreignId, foreignOrg]]) await db.query("insert into workspaces(id,name,slug,auth_organization_id,owner_user_id,auth_owner_user_id,plan,access_state) values($1,$2::text,$2::text,$2::text,$3::text,$3::text,'studio','active')", [id, org, owner])
    for (const [user, role] of [[owner, 'owner'], [admin, 'admin'], [member, 'analyst']]) await db.query('insert into auth_members(id,organization_id,user_id,role) values($1,$2,$1,$3)', [user, organizationId, role])
    await db.query("insert into auth_members(id,organization_id,user_id,role) values('membership-boundary-foreign',$1,$2,'analyst')", [foreignOrg, member])
    for (const [id, user, org] of [['membership-session', member, organizationId], ['membership-other-session', member, foreignOrg], ['membership-owner-session', owner, organizationId]]) await db.query("insert into auth_sessions(id,token,user_id,active_organization_id,expires_at) values($1,$1,$2,$3,now()+interval '1 day')", [id, user, org])

    await changeWhileWaiting(() => blocker.query("update auth_members set role='analyst' where id=$1", [admin]), () => updateWorkspaceMemberRoleWithAudit({ ...input, actorUserId: admin, targetUserId: member, role: 'client' }))
    assert.equal((await db.query('select role from auth_members where id=$1', [member])).rows[0].role, 'analyst')
    assert.equal(Number((await db.query('select count(*) from audit_events where workspace_id=$1', [workspaceId])).rows[0].count), 0)
    await db.query("update auth_members set role='admin' where id=$1", [admin])
    await changeWhileWaiting(async () => {
      await blocker.query('update workspaces set owner_user_id=$1::text,auth_owner_user_id=$1::text where id=$2', [admin, workspaceId])
      await blocker.query("update auth_members set role=case when user_id=$1 then 'owner' else 'admin' end where organization_id=$2 and user_id=any($3::text[])", [admin, organizationId, [owner, admin]])
    }, () => removeWorkspaceMemberWithAudit({ ...input, targetUserId: admin }))
    await assert.rejects(transferWorkspaceOwnershipWithAudit({ ...input, newOwnerUserId: member }), /Seul le propriétaire/)
    assert.equal((await db.query('select owner_user_id from workspaces where id=$1', [workspaceId])).rows[0].owner_user_id, admin)

    // Expired reservations do not consume the two remaining studio seats.
    for (let index = 0; index < 5; index++) await db.query("insert into auth_invitations(id,organization_id,email,role,status,expires_at,inviter_id) values($1,$2,$3,'analyst','pending',now()-interval '1 day',$4)", [`membership-expired-${index}`, organizationId, index === 0 ? 'reinvite@example.test' : `expired-${index}@example.test`, owner])
    assert.equal((await workspaceMemberRoster(organizationId, admin)).usage, 3)
    const invited = await inviteWorkspaceMemberWithQuota({ ...input, ownerUserId: owner, emailAddress: 'reinvite@example.test', role: 'analyst', entitlements: entitlementContext('internal', 'internal') })
    assert.equal((await workspaceMemberRoster(organizationId, admin)).usage, 4)
    assert.equal(Number((await db.query("select count(*) from jobs where workspace_id=$1 and type='auth.invitation_deliver'", [workspaceId])).rows[0].count), 1)
    assert(invited.id)

    await removeWorkspaceMemberWithAudit({ ...input, targetUserId: member })
    assert.equal((await db.query("select active_organization_id from auth_sessions where id='membership-session'")).rows[0].active_organization_id, null)
    assert.equal((await db.query("select active_organization_id from auth_sessions where id='membership-other-session'")).rows[0].active_organization_id, foreignOrg)
    assert.equal((await db.query("select active_organization_id from auth_sessions where id='membership-owner-session'")).rows[0].active_organization_id, organizationId)
    assert.equal(await resolveWorkspaceSelection({ sessionId: 'membership-session', userId: member }), foreignOrg)
    assert.equal(await resolveWorkspaceSelection({ sessionId: 'membership-session', userId: owner }), null, 'Foreign session cannot be repaired')
    // Historical stale selection, with no remaining membership, clears safely.
    await db.query('delete from auth_members where user_id=$1', [member])
    assert.equal(await resolveWorkspaceSelection({ sessionId: 'membership-session', userId: member }), null)
    assert.equal((await db.query("select active_organization_id from auth_sessions where id='membership-session'")).rows[0].active_organization_id, null)
    await db.query("update auth_sessions set expires_at=now()-interval '1 day' where id='membership-owner-session'")
    assert.equal(await resolveWorkspaceSelection({ sessionId: 'membership-owner-session', userId: owner }), null)
    console.log(JSON.stringify({ ok: true, verified: ['real_lock_wait_role_reauthorization', 'current_owner_protected_after_transfer', 'former_owner_cannot_transfer', 'expired_invitation_reusable_without_quota_reservation', 'durable_invitation_job', 'removed_member_sessions_scoped', 'valid_remaining_membership_selected', 'stale_selection_cleared', 'foreign_and_expired_sessions_refused'], providerCalls: 0 }))
  } finally { await cleanup(); await blocker.end(); await db.end() }
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
