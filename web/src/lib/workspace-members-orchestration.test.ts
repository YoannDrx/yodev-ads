import { beforeEach, describe, expect, it, vi } from 'vitest'
import { databaseDouble } from '../../test/fluent-db'

const mocks = vi.hoisted(() => ({
  databases: [] as unknown[],
  tenantContexts: [] as unknown[],
  tenantTransaction: vi.fn(async (context: unknown, callback: (db: unknown) => unknown) => {
    mocks.tenantContexts.push(context)
    return callback(mocks.databases.shift())
  }),
  systemTransaction: vi.fn(async (callback: (db: unknown) => unknown) => callback(mocks.databases.shift())),
  encrypt: vi.fn((value: string) => `encrypted:${value}`),
}))

vi.mock('@/db/transactions', () => ({
  withTenantTransaction: mocks.tenantTransaction,
  withSystemTransaction: mocks.systemTransaction,
}))
vi.mock('@/lib/crypto', () => ({ encryptSecret: mocks.encrypt }))

import { entitlementContext } from './entitlements'
import {
  inviteWorkspaceMemberWithQuota,
  removeWorkspaceMemberWithAudit,
  revokeWorkspaceInvitationWithAudit,
  saveMemberTaskNotificationPreferences,
  transferWorkspaceOwnershipWithAudit,
  updateWorkspaceMemberRoleWithAudit,
  workspaceMemberRoster,
} from './workspace-members'

const workspaceId = '00000000-0000-4000-8000-000000000001'

function memberDatabase(input: { statementResults?: unknown[]; workspace?: unknown; member?: unknown; organization?: unknown } = {}) {
  return databaseDouble({
    statementResults: input.statementResults,
    query: {
      workspaces: { findFirst: vi.fn(async () => input.workspace ?? { accessState: 'active', plan: 'studio' }) },
      authMembers: { findFirst: vi.fn(async () => input.member) },
      authOrganizations: { findFirst: vi.fn(async () => input.organization ?? { id: 'org-1', name: 'Agency' }) },
    },
  })
}

describe('Better Auth workspace member orchestration', () => {
  beforeEach(() => {
    mocks.databases = []
    mocks.tenantContexts = []
    vi.clearAllMocks()
  })

  it('persists encrypted task preferences and a count-only audit in one tenant transaction', async () => {
    const database = memberDatabase({ statementResults: [[], [{ id: 'preference-1' }]] })
    mocks.databases.push(database.db)
    await saveMemberTaskNotificationPreferences({
      workspaceId, userId: 'user-1', mentionHandle: 'yoann', displayName: 'Yoann',
      emailAddress: 'Yoann@Example.test', mentionNotifications: true, digestCadence: 'daily', digestHour: 8, timezone: 'Europe/Paris',
    })
    expect(mocks.encrypt).toHaveBeenCalledWith('yoann@example.test')
    expect(database.capture.values[0]).toMatchObject({ authUserId: 'user-1', encryptedEmail: 'encrypted:yoann@example.test' })
    expect(database.capture.values[1]).toMatchObject({ action: 'member.task_notification_preferences_updated', workspaceId })
    expect(mocks.tenantContexts).toEqual([{ workspaceId, userId: 'user-1' }])
  })

  it('reads the Better Auth roster and fails unknown roles closed to viewer', async () => {
    const database = memberDatabase({ statementResults: [[
      { id: 'membership-owner', userId: 'owner-1', email: 'owner@example.test', name: 'Owner One', role: 'admin', createdAt: new Date() },
      { id: 'membership-2', userId: 'user-2', email: 'analyst@example.test', name: '', role: 'analyst', createdAt: new Date() },
    ], [{ id: 'invite-1', email: 'guest@example.test', role: 'custom', expiresAt: new Date() }]] })
    mocks.databases.push(database.db)
    const roster = await workspaceMemberRoster('org-1', 'owner-1')
    expect(roster.members).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'owner', displayName: 'Owner One' }),
      expect.objectContaining({ role: 'analyst', displayName: 'analyst@example.test' }),
    ]))
    expect(roster.invitations[0].role).toBe('viewer')
    expect(roster.usage).toBe(3)
  })

  it('serializes quota and duplicates before atomically creating and auditing an invitation', async () => {
    const database = memberDatabase({ statementResults: [[], [], [{ count: 1 }], [{ count: 0 }], [], []] })
    mocks.databases.push(database.db)
    await inviteWorkspaceMemberWithQuota({
      workspaceId, organizationId: 'org-1', ownerUserId: 'owner-1', actorUserId: 'owner-1',
      emailAddress: 'member@example.test', role: 'analyst', entitlements: entitlementContext('active', 'studio'),
    })
    expect(database.capture.values).toEqual(expect.arrayContaining([
      expect.objectContaining({ organizationId: 'org-1', email: 'member@example.test', role: 'analyst', status: 'pending' }),
      expect.objectContaining({ action: 'workspace.member_invited', entityType: 'auth_organization_invitation', metadata: { role: 'analyst', emailDomain: 'example.test' } }),
      expect.objectContaining({ type: 'auth.invitation_deliver', workspaceId, deduplicationKey: expect.stringMatching(/^auth:invitation:/) }),
    ]))
  })

  it('blocks quota exhaustion and duplicate identities before email delivery', async () => {
    mocks.databases.push(memberDatabase({ statementResults: [[], [], [{ count: 5 }], [{ count: 0 }], [], []] }).db)
    await expect(inviteWorkspaceMemberWithQuota({
      workspaceId, organizationId: 'org-1', ownerUserId: 'owner-1', actorUserId: 'owner-1',
      emailAddress: 'member@example.test', role: 'viewer', entitlements: entitlementContext('active', 'studio'),
    })).rejects.toThrow('Quota exceeded')
    mocks.databases.push(memberDatabase({ statementResults: [[], [], [{ count: 1 }], [{ count: 0 }], [{ id: 'duplicate' }], []] }).db)
    await expect(inviteWorkspaceMemberWithQuota({
      workspaceId, organizationId: 'org-1', ownerUserId: 'owner-1', actorUserId: 'owner-1',
      emailAddress: 'member@example.test', role: 'viewer', entitlements: entitlementContext('active', 'studio'),
    })).rejects.toThrow('déjà membre ou invitée')
    expect(mocks.databases).toEqual([])
  })

  it('audits role changes, removals and invitation cancellation inside system transactions', async () => {
    const role = memberDatabase({ statementResults: [[], [{ id: 'membership-2' }]] })
    const removal = memberDatabase({ statementResults: [[], [{ id: 'membership-2' }]] })
    const revocation = memberDatabase({ statementResults: [[], [{ id: 'invite-1' }]] })
    mocks.databases.push(role.db, removal.db, revocation.db)
    await updateWorkspaceMemberRoleWithAudit({ workspaceId, organizationId: 'org-1', actorUserId: 'owner-1', targetUserId: 'user-2', role: 'operator' })
    await removeWorkspaceMemberWithAudit({ workspaceId, organizationId: 'org-1', actorUserId: 'owner-1', targetUserId: 'user-2' })
    await revokeWorkspaceInvitationWithAudit({ workspaceId, organizationId: 'org-1', actorUserId: 'owner-1', invitationId: 'invite-1' })
    expect(role.capture.values[0]).toMatchObject({ action: 'workspace.member_role_updated' })
    expect(removal.capture.values[0]).toMatchObject({ action: 'workspace.member_removed' })
    expect(revocation.capture.sets[0]).toMatchObject({ status: 'canceled' })
    expect(revocation.capture.values[0]).toMatchObject({ action: 'workspace.invitation_revoked' })
  })

  it('transfers both Better Auth membership ownership and workspace ownership atomically', async () => {
    const database = memberDatabase({ member: { id: 'membership-2' }, statementResults: [[], [], [], [{ id: workspaceId }]] })
    mocks.databases.push(database.db)
    await transferWorkspaceOwnershipWithAudit({ workspaceId, organizationId: 'org-1', actorUserId: 'owner-1', newOwnerUserId: 'user-2' })
    expect(database.capture.sets).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'admin' }), expect.objectContaining({ role: 'owner' }),
      expect.objectContaining({ ownerUserId: 'user-2', authOwnerUserId: 'user-2' }),
    ]))
    expect(database.capture.values[0]).toMatchObject({ action: 'workspace.ownership_transferred' })
  })

  it('blocks collaboration mutations after suspension before touching memberships', async () => {
    const database = memberDatabase({ workspace: { accessState: 'suspended', plan: 'agency' } })
    mocks.databases.push(database.db)
    await expect(updateWorkspaceMemberRoleWithAudit({
      workspaceId, organizationId: 'org-1', actorUserId: 'owner-1', targetUserId: 'user-2', role: 'viewer',
    })).rejects.toThrow('Capability required: collaboration')
    expect(database.capture.sets).toEqual([])
  })
})
