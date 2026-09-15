'use server'

import { acceptedInvitationOrganization } from '@/lib/auth-invitations'
import { currentAuthSession } from '@/lib/workspace'

export async function recoverAcceptedInvitation(invitationId: string) {
  if (typeof invitationId !== 'string') return null
  const session = await currentAuthSession()
  if (!session) return null
  return acceptedInvitationOrganization({ invitationId, userId: session.userId,
    email: session.user.email, emailVerified: session.user.emailVerified })
}
