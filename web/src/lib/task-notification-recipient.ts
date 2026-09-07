import 'server-only'

import { and, eq, sql } from 'drizzle-orm'
import { authMembers, authUsers, jobs, memberNotificationPreferences, workspaces } from '@/db/schema'
import type { DatabaseTransaction } from '@/db/transactions'
import { entitlementContext, isPlan, isWorkspaceAccessState } from '@/lib/entitlements'
import { authRoleToWorkspaceRole } from '@/lib/permissions'
import { workspaceDecision } from '@/lib/workspace-decision'
import { NonRetryableJobError, type ClaimedJob } from '@/lib/jobs'

export async function taskNotificationRecipient(db: DatabaseTransaction, preferenceId: string, job?: ClaimedJob) {
  const [context] = await db.select({ preference: memberNotificationPreferences, workspace: workspaces,
    user: { id: authUsers.id, email: authUsers.email, emailVerified: authUsers.emailVerified, name: authUsers.name }, memberRole: authMembers.role,
  }).from(memberNotificationPreferences)
    .innerJoin(workspaces, eq(workspaces.id, memberNotificationPreferences.workspaceId))
    .innerJoin(authMembers, and(eq(authMembers.organizationId, workspaces.authOrganizationId), eq(authMembers.userId, memberNotificationPreferences.authUserId)))
    .innerJoin(authUsers, eq(authUsers.id, authMembers.userId))
    .where(eq(memberNotificationPreferences.id, preferenceId)).limit(1).for('share', { of: [memberNotificationPreferences, workspaces, authMembers] })
  if (!context) return null
  const { workspace } = context
  if (job) {
    if (job.workspaceId !== workspace.id || job.payload.preferenceId !== preferenceId || !job.leaseOwner) throw new NonRetryableJobError('Task notification job context mismatch')
    const [current] = await db.select({ id: jobs.id, payload: jobs.payload }).from(jobs).where(and(eq(jobs.id, job.id), eq(jobs.workspaceId, workspace.id),
      eq(jobs.status, 'running'), eq(jobs.type, job.type), eq(jobs.leaseOwner, job.leaseOwner), eq(jobs.attemptCount, job.attemptCount),
      sql`${jobs.leaseExpiresAt} > clock_timestamp()`)).limit(1)
    if (!current) throw new Error('Task notification job lease lost')
    if (current.payload.preferenceId !== preferenceId || current.payload.commentId !== job.payload.commentId || current.payload.runKey !== job.payload.runKey) throw new NonRetryableJobError('Task notification stored payload mismatch')
  }
  // Use a fresh statement after row-lock waits. The system role deliberately has
  // read-only access to auth_users; do not grant UPDATE merely to lock identities.
  const [identity] = await db.select({ user: { id: authUsers.id, email: authUsers.email, emailVerified: authUsers.emailVerified, name: authUsers.name },
    expired: sql<boolean>`${workspaces.trialEndsAt} is not null and ${workspaces.trialEndsAt} <= clock_timestamp()`,
  }).from(authUsers).innerJoin(workspaces, eq(workspaces.id, workspace.id)).where(eq(authUsers.id, context.preference.authUserId)).limit(1)
  if (!identity || !identity.user.emailVerified || !identity.user.email.trim() || !isWorkspaceAccessState(workspace.accessState) || !isPlan(workspace.plan)) return null
  const { user } = identity
  const state = workspace.accessState === 'trial' && identity.expired ? 'suspended' : workspace.accessState
  const role = authRoleToWorkspaceRole(context.memberRole, workspace.ownerUserId === user.id)
  if (!workspaceDecision({ role, state, permission: 'portfolio:read', entitlements: entitlementContext(state, workspace.plan), capability: 'monitoring', features: ['notifications'] }).allowed) return null
  return { ...context, user, email: user.email.trim().toLowerCase() }
}
