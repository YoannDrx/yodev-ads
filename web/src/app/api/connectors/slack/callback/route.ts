import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { requireCapability } from '@/lib/entitlements'
import { requireFeature } from '@/lib/feature-flags'
import { oauthCallbackUrl, openOAuthState } from '@/lib/oauth-state'
import { exchangeSlackAuthorizationCode } from '@/lib/slack-oauth'
import { assertSafeWebhookUrl } from '@/lib/webhook-security'
import { requireWorkspacePermission } from '@/lib/workspace'
import { createWorkspaceNotificationChannel } from '@/lib/workspace-security-resources'

const COOKIE_NAME = 'yodev_ads_slack_oauth'

export async function GET(request: Request) {
  const url = new URL(request.url)
  try {
    requireFeature('notifications', 'Les notifications sont temporairement désactivées.')
    const { workspace, session, entitlements } = await requireWorkspacePermission('workspace:admin')
    requireCapability(entitlements, 'notifications.webhook')
    const code = url.searchParams.get('code')
    const returnedState = url.searchParams.get('state')
    const oauthError = url.searchParams.get('error')
    const cookieStore = await cookies()
    const sealed = cookieStore.get(COOKIE_NAME)?.value
    cookieStore.set(COOKIE_NAME, '', {
      httpOnly: true,
      secure: url.protocol === 'https:',
      sameSite: 'lax',
      path: '/api/connectors/slack',
      expires: new Date(0),
    })
    if (oauthError) throw new Error(`Slack a interrompu l’autorisation : ${oauthError}`)
    if (!code || !returnedState) throw new Error('Réponse OAuth Slack incomplète.')
    if (!sealed) throw new Error('La session OAuth a expiré. Relancez la connexion.')
    const state = openOAuthState(sealed, 'slack')
    if (state.state !== returnedState || state.workspaceId !== workspace.id || state.userId !== session.userId) {
      throw new Error('La vérification de sécurité OAuth a échoué.')
    }

    const redirectUri = oauthCallbackUrl('slack', url)
    const installation = await exchangeSlackAuthorizationCode({ code, redirectUri })
    await assertSafeWebhookUrl(installation.webhookUrl)
    await createWorkspaceNotificationChannel({
      workspaceId: workspace.id,
      actorUserId: session.userId,
      kind: 'slack',
      label: `Slack · ${installation.teamName} · ${installation.channelName}`.slice(0, 120),
      destination: installation.webhookUrl,
      minimumSeverity: 'warning',
      entitlements,
    })

    const destination = new URL('/settings', url.origin)
    destination.searchParams.set('notice', 'Slack est connecté au canal sélectionné.')
    return NextResponse.redirect(destination)
  } catch (error) {
    const destination = new URL('/settings', url.origin)
    destination.searchParams.set('error', error instanceof Error ? error.message : 'Connexion Slack impossible.')
    return NextResponse.redirect(destination)
  }
}
