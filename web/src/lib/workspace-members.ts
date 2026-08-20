import 'server-only'

import { randomUUID } from 'node:crypto'
import { and, eq, sql } from 'drizzle-orm'
import {
  auditEvents,
  authInvitations,
  authMembers,
  authOrganizations,
  authUsers,
  jobs,
  memberNotificationPreferences,
  workspaces,
} from '@/db/schema'
import { withSystemTransaction, withTenantTransaction } from '@/db/transactions'
import { encryptSecret } from '@/lib/crypto'
import { requireQuota, type EntitlementContext } from '@/lib/entitlements'
import type { WorkspaceRole } from '@/lib/permissions'
import { lockWorkspaceEntitlements } from '@/lib/workspace-transaction-guard'

export type ManageableWorkspaceRole = Exclude<WorkspaceRole, 'owner'>

export const manageableWorkspaceRoles = ['admin', 'strategist', 'analyst', 'client'] as const satisfies readonly ManageableWorkspaceRole[]

export function workspaceRoleFromAuth(role: string): ManageableWorkspaceRole {
  const value = role.replace(/^org:/, '')
  if (value === 'operator') return 'strategist'
  if (value === 'viewer') return 'client'
  return manageableWorkspaceRoles.includes(value as ManageableWorkspaceRole) ? value as ManageableWorkspaceRole : 'client'
}

export async function workspaceMemberRoster(organizationId: string, ownerUserId: string) {
  return withSystemTransaction(async (db) => {
    const members = await db.select({
      id: authMembers.id,
      userId: authMembers.userId,
      email: authUsers.email,
      name: authUsers.name,
      role: authMembers.role,
      createdAt: authMembers.createdAt,
    }).from(authMembers).innerJoin(authUsers, eq(authUsers.id, authMembers.userId))
      .where(eq(authMembers.organizationId, organizationId))
    const invitations = await db.select({
      id: authInvitations.id,
      email: authInvitations.email,
      role: authInvitations.role,
      expiresAt: authInvitations.expiresAt,
    }).from(authInvitations).where(and(
      eq(authInvitations.organizationId, organizationId),
      eq(authInvitations.status, 'pending'),
    ))
    return {
      members: members.map((membership) => ({
        id: membership.id,
        userId: membership.userId,
        identifier: membership.email,
        displayName: membership.name || membership.email,
        role: membership.userId === ownerUserId ? 'owner' as const : workspaceRoleFromAuth(membership.role),
        createdAt: membership.createdAt,
      })),
      invitations: invitations.map((invitation) => ({
        id: invitation.id,
        emailAddress: invitation.email,
        role: workspaceRoleFromAuth(invitation.role),
        expiresAt: invitation.expiresAt,
      })),
      usage: members.length + invitations.length,
    }
  })
}

export function saveMemberTaskNotificationPreferences(input: {
  workspaceId: string
  userId: string
  mentionHandle: string
  displayName: string
  emailAddress: string
  mentionNotifications: boolean
  digestCadence: 'none' | 'daily' | 'weekly'
  digestHour: number
  timezone: string
}) {
  return withTenantTransaction({ workspaceId: input.workspaceId, userId: input.userId }, async (db) => {
    await lockWorkspaceEntitlements(db, input.workspaceId, 'monitoring')
    const [preference] = await db.insert(memberNotificationPreferences).values({
      workspaceId: input.workspaceId,
      authUserId: input.userId,
      mentionHandle: input.mentionHandle,
      displayName: input.displayName,
      encryptedEmail: encryptSecret(input.emailAddress.toLowerCase()),
      mentionNotifications: input.mentionNotifications,
      digestCadence: input.digestCadence,
      digestHour: input.digestHour,
      timezone: input.timezone,
    }).onConflictDoUpdate({
      target: [memberNotificationPreferences.workspaceId, memberNotificationPreferences.authUserId],
      set: {
        mentionHandle: input.mentionHandle,
        displayName: input.displayName,
        encryptedEmail: encryptSecret(input.emailAddress.toLowerCase()),
        mentionNotifications: input.mentionNotifications,
        digestCadence: input.digestCadence,
        digestHour: input.digestHour,
        timezone: input.timezone,
        lastError: null,
        updatedAt: new Date(),
      },
    }).returning({ id: memberNotificationPreferences.id })
    await db.insert(auditEvents).values({
      workspaceId: input.workspaceId,
      actorUserId: input.userId,
      action: 'member.task_notification_preferences_updated',
      entityType: 'member_notification_preference',
      entityId: preference.id,
      metadata: {
        mentionHandle: input.mentionHandle,
        mentionNotifications: input.mentionNotifications,
        digestCadence: input.digestCadence,
        digestHour: input.digestHour,
        timezone: input.timezone,
      },
    })
    return preference
  })
}

export async function inviteWorkspaceMemberWithQuota(input: {
  workspaceId: string
  organizationId: string
  ownerUserId: string
  actorUserId: string
  emailAddress: string
  role: ManageableWorkspaceRole
  entitlements: EntitlementContext
}) {
  const invitation = await withSystemTransaction(async (db) => {
    const entitlements = await lockWorkspaceEntitlements(db, input.workspaceId, 'collaboration')
    await db.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`members:${input.workspaceId}`}, 0))`)
    const memberCount = await db.select({ count: sql<number>`count(*)::int` }).from(authMembers)
      .where(eq(authMembers.organizationId, input.organizationId))
    const pendingInvitations = await db.select({ count: sql<number>`count(*)::int` }).from(authInvitations)
      .where(and(eq(authInvitations.organizationId, input.organizationId), eq(authInvitations.status, 'pending')))
    const duplicateMember = await db.select({ id: authMembers.id }).from(authMembers)
      .innerJoin(authUsers, eq(authUsers.id, authMembers.userId)).where(and(
        eq(authMembers.organizationId, input.organizationId),
        sql`lower(${authUsers.email}) = ${input.emailAddress}`,
      )).limit(1)
    const duplicateInvite = await db.select({ id: authInvitations.id }).from(authInvitations).where(and(
      eq(authInvitations.organizationId, input.organizationId),
      eq(authInvitations.status, 'pending'),
      sql`lower(${authInvitations.email}) = ${input.emailAddress}`,
    )).limit(1)
    const organization = await db.query.authOrganizations.findFirst({
      where: eq(authOrganizations.id, input.organizationId),
    })
    if (!organization) throw new Error('Organisation Better Auth introuvable.')
    requireQuota(entitlements, 'members', (memberCount[0]?.count ?? 0) + (pendingInvitations[0]?.count ?? 0))
    if (duplicateMember.length || duplicateInvite.length) throw new Error('Cette adresse est déjà membre ou invitée.')
    const created = {
      id: randomUUID(),
      organizationId: input.organizationId,
      email: input.emailAddress,
      role: input.role,
      status: 'pending',
      expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
      inviterId: input.actorUserId,
      createdAt: new Date(),
    }
    await db.insert(authInvitations).values(created)
    await db.insert(auditEvents).values({
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      action: 'workspace.member_invited',
      entityType: 'auth_organization_invitation',
      entityId: created.id,
      metadata: { role: input.role, emailDomain: input.emailAddress.split('@')[1] },
    })
    await db.insert(jobs).values({
      workspaceId: input.workspaceId,
      type: 'auth.invitation_deliver',
      payload: { invitationId: created.id, workspaceId: input.workspaceId },
      priority: 20,
      deduplicationKey: `auth:invitation:${created.id}`,
      maximumAttempts: 5,
    })
    return { ...created, organizationName: organization.name }
  })
  return invitation
}

export function updateWorkspaceMemberRoleWithAudit(input: {
  workspaceId: string
  organizationId: string
  actorUserId: string
  targetUserId: string
  role: ManageableWorkspaceRole
}) {
  return withSystemTransaction(async (db) => {
    await lockWorkspaceEntitlements(db, input.workspaceId, 'collaboration')
    const [membership] = await db.update(authMembers).set({ role: input.role })
      .where(and(eq(authMembers.organizationId, input.organizationId), eq(authMembers.userId, input.targetUserId)))
      .returning()
    if (!membership) throw new Error('Membre Better Auth introuvable.')
    await db.insert(auditEvents).values({
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      action: 'workspace.member_role_updated',
      entityType: 'auth_organization_membership',
      entityId: membership.id,
      metadata: { userId: input.targetUserId, role: input.role },
    })
    return membership
  })
}

export function removeWorkspaceMemberWithAudit(input: {
  workspaceId: string
  organizationId: string
  actorUserId: string
  targetUserId: string
}) {
  return withSystemTransaction(async (db) => {
    await lockWorkspaceEntitlements(db, input.workspaceId, 'collaboration')
    const [membership] = await db.delete(authMembers)
      .where(and(eq(authMembers.organizationId, input.organizationId), eq(authMembers.userId, input.targetUserId)))
      .returning()
    if (!membership) throw new Error('Membre Better Auth introuvable.')
    await db.insert(auditEvents).values({
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      action: 'workspace.member_removed',
      entityType: 'auth_organization_membership',
      entityId: membership.id,
      metadata: { userId: input.targetUserId },
    })
    return membership
  })
}

export function revokeWorkspaceInvitationWithAudit(input: {
  workspaceId: string
  organizationId: string
  actorUserId: string
  invitationId: string
}) {
  return withSystemTransaction(async (db) => {
    await lockWorkspaceEntitlements(db, input.workspaceId, 'collaboration')
    const [invitation] = await db.update(authInvitations).set({ status: 'canceled' })
      .where(and(
        eq(authInvitations.organizationId, input.organizationId),
        eq(authInvitations.id, input.invitationId),
        eq(authInvitations.status, 'pending'),
      )).returning()
    if (!invitation) throw new Error('Invitation Better Auth introuvable ou déjà traitée.')
    await db.insert(auditEvents).values({
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      action: 'workspace.invitation_revoked',
      entityType: 'auth_organization_invitation',
      entityId: invitation.id,
      metadata: {},
    })
    return invitation
  })
}

export function transferWorkspaceOwnershipWithAudit(input: {
  workspaceId: string
  organizationId: string
  actorUserId: string
  newOwnerUserId: string
}) {
  return withSystemTransaction(async (db) => {
    await lockWorkspaceEntitlements(db, input.workspaceId, 'collaboration')
    const newOwner = await db.query.authMembers.findFirst({ where: and(
      eq(authMembers.organizationId, input.organizationId),
      eq(authMembers.userId, input.newOwnerUserId),
    ) })
    if (!newOwner) throw new Error('Le nouveau propriétaire doit déjà être membre actif.')
    await db.update(authMembers).set({ role: 'admin' }).where(and(
      eq(authMembers.organizationId, input.organizationId),
      eq(authMembers.userId, input.actorUserId),
    ))
    await db.update(authMembers).set({ role: 'owner' }).where(eq(authMembers.id, newOwner.id))
    const [updated] = await db.update(workspaces)
      .set({ ownerUserId: input.newOwnerUserId, authOwnerUserId: input.newOwnerUserId, updatedAt: new Date() })
      .where(and(eq(workspaces.id, input.workspaceId), eq(workspaces.ownerUserId, input.actorUserId)))
      .returning({ id: workspaces.id })
    if (!updated) throw new Error('La propriété a déjà changé. Rechargez la page.')
    await db.insert(auditEvents).values({
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      action: 'workspace.ownership_transferred',
      entityType: 'workspace',
      entityId: input.workspaceId,
      metadata: { previousOwnerUserId: input.actorUserId, newOwnerUserId: input.newOwnerUserId },
    })
    return updated
  })
}
