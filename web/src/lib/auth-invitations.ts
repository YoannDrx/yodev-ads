import 'server-only'

import { and, eq, gt } from 'drizzle-orm'
import { authInvitations, authOrganizations, workspaces } from '@/db/schema'
import { withSystemTransaction } from '@/db/transactions'
import { sendAuthEmail } from '@/lib/auth-emails'
import { NonRetryableJobError } from '@/lib/jobs'

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
