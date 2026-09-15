import 'server-only'

import { and, eq, gt, sql } from 'drizzle-orm'
import { authInvitations, authMembers, authOrganizations, workspaces } from '@/db/schema'
import { withSystemTransaction } from '@/db/transactions'
import { sendAuthEmail } from '@/lib/auth-emails'
import { NonRetryableJobError } from '@/lib/jobs'

/** Read an already acquired membership after a lost acceptance response; never create one. */
export async function acceptedInvitationOrganization(input: { invitationId: string; userId: string; email: string; emailVerified: boolean }) {
  if (!input.emailVerified || !/^[a-zA-Z0-9_-]{1,128}$/.test(input.invitationId)) return null
  return withSystemTransaction(async (db) => {
    const [row] = await db.select({ organizationId: authInvitations.organizationId })
      .from(authInvitations)
      .innerJoin(authMembers, and(eq(authMembers.organizationId, authInvitations.organizationId), eq(authMembers.userId, input.userId)))
      .where(and(eq(authInvitations.id, input.invitationId), eq(authInvitations.status, 'accepted'),
        sql`lower(${authInvitations.email}) = ${input.email.trim().toLowerCase()}`))
      .limit(1)
    return row?.organizationId ?? null
  })
}

export async function deliverAuthInvitation(input: { invitationId: string; workspaceId: string }) {
  const invitation = await withSystemTransaction(async (db) => {
    const [row] = await db.select({
      id: authInvitations.id,
      email: authInvitations.email,
      organizationName: authOrganizations.name,
      locale: workspaces.locale,
    }).from(authInvitations)
      .innerJoin(authOrganizations, eq(authOrganizations.id, authInvitations.organizationId))
      .innerJoin(workspaces, and(
        eq(workspaces.authOrganizationId, authOrganizations.id),
        eq(workspaces.id, input.workspaceId),
      ))
      .where(and(
        eq(authInvitations.id, input.invitationId),
        eq(authInvitations.status, 'pending'),
        gt(authInvitations.expiresAt, new Date()),
      ))
      .limit(1)
    return row
  })
  if (!invitation) throw new NonRetryableJobError('Better Auth invitation is unavailable, revoked or expired')
  return sendAuthEmail({
    to: invitation.email,
    actionUrl: `${(process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000').replace(/\/$/, '')}/invitation?id=${encodeURIComponent(invitation.id)}`,
    kind: 'organization_invitation',
    locale: invitation.locale,
    organizationName: invitation.organizationName,
    idempotencyKey: `auth:invitation:${invitation.id}`,
  })
}
