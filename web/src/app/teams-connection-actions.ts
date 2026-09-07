'use server'

import { cookies } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { requireWorkspacePermission } from '@/lib/workspace'
import { requireCapability } from '@/lib/entitlements'
import { requireFeature } from '@/lib/feature-flags'
import { requireTeamsSessionContext, teamsConnectionError, teamsSessionCookieName } from '@/lib/teams-session-context'
import { accessTeamsOAuthSession, completeTeamsOAuthSession } from '@/lib/notification-oauth-management'
import { resolveTeamsDestination } from '@/lib/teams-oauth'

function toUrl(path: string, kind: string, text: string) { return `${path}?${new URLSearchParams({ [kind]: text })}` }

export async function completeTeamsNotificationConnection(formData: FormData) {
  let target: string
  let english = false
  try {
    requireFeature('notifications', 'Les notifications sont temporairement désactivées.')
    requireFeature('teamsConnector', 'Le connecteur Microsoft Teams est temporairement désactivé.')
    const { workspace, session, entitlements } = await requireWorkspacePermission('workspace:admin')
    english = workspace.locale === 'en'
    requireCapability(entitlements, 'notifications.webhook')
    const input = z.object({
      workspaceId: z.string().uuid(),
      sessionId: z.string().uuid(),
      teamId: z.string().trim().min(1).max(128),
      channelId: z.string().trim().min(1).max(256),
    }).parse(Object.fromEntries(formData))
    const cookieStore = await cookies()
    const sessionId = input.sessionId
    requireTeamsSessionContext({ workspaceId: workspace.id, userId: session.userId, sessionId,
      displayedWorkspaceId: input.workspaceId, sealed: cookieStore.get(teamsSessionCookieName(sessionId))?.value })
    const { accessToken } = await accessTeamsOAuthSession({
      workspaceId: workspace.id,
      actorUserId: session.userId,
      sessionId,
    })
    const destination = await resolveTeamsDestination({ accessToken, ...input })
    await completeTeamsOAuthSession({
      workspaceId: workspace.id,
      actorUserId: session.userId,
      sessionId,
      entitlements,
      ...destination,
    })
    target = toUrl('/settings', 'notice', english ? 'Microsoft Teams is connected to the selected channel.' : 'Microsoft Teams est connecté au canal sélectionné.')
  } catch (error) {
    target = toUrl('/settings', 'error', teamsConnectionError(error, english))
  }
  revalidatePath('/settings')
  redirect(target)
}

