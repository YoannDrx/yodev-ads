import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { requireCapability } from '@/lib/entitlements'
import { requireFeature } from '@/lib/feature-flags'
import { createTeamsOAuthSession } from '@/lib/notification-oauth-management'
import { oauthCallbackUrl, openOAuthState, sealOAuthState } from '@/lib/oauth-state'
import { exchangeTeamsAuthorizationCode } from '@/lib/teams-oauth'
import { requireWorkspacePermission } from '@/lib/workspace'

const OAUTH_COOKIE_NAME = 'yodev_ads_teams_oauth'
const TEAMS_SESSION_COOKIE_NAME = 'yodev_ads_teams_session'

export async function GET(request: Request) {
  const url = new URL(request.url)
  try {
    requireFeature('notifications', 'Les notifications sont temporairement désactivées.')
    requireFeature('teamsConnector', 'Le connecteur Microsoft Teams est temporairement désactivé.')
    const { workspace, session, entitlements } = await requireWorkspacePermission('workspace:admin')
    requireCapability(entitlements, 'notifications.webhook')
    const code = url.searchParams.get('code')
    const returnedState = url.searchParams.get('state')
    const oauthError = url.searchParams.get('error')
    const cookieStore = await cookies()
    const sealed = cookieStore.get(OAUTH_COOKIE_NAME)?.value
    cookieStore.set(OAUTH_COOKIE_NAME, '', {
      httpOnly: true,
      secure: url.protocol === 'https:',
      sameSite: 'lax',
      path: '/api/connectors/teams',
      expires: new Date(0),
    })
    if (oauthError) throw new Error(`Microsoft a interrompu l’autorisation : ${oauthError}`)
    if (!code || !returnedState) throw new Error('Réponse OAuth Microsoft Teams incomplète.')
    if (!sealed) throw new Error('La session OAuth a expiré. Relancez la connexion.')
    const state = openOAuthState(sealed, 'teams')
    if (state.state !== returnedState || state.workspaceId !== workspace.id || state.userId !== session.userId) {
      throw new Error('La vérification de sécurité OAuth a échoué.')
    }
    const codeVerifier = state.payload.codeVerifier
    if (!codeVerifier) throw new Error('La preuve PKCE OAuth est absente.')

    const redirectUri = oauthCallbackUrl('teams', url)
    const tokens = await exchangeTeamsAuthorizationCode({ code, redirectUri, codeVerifier })
    const oauthSession = await createTeamsOAuthSession({
      workspaceId: workspace.id,
      actorUserId: session.userId,
      refreshToken: tokens.refreshToken,
      scopes: tokens.scopes,
    })
    cookieStore.set(TEAMS_SESSION_COOKIE_NAME, sealOAuthState({
      provider: 'teams',
      state: state.state,
      workspaceId: workspace.id,
      userId: session.userId,
      expiresAt: oauthSession.expiresAt.getTime(),
      payload: { sessionId: oauthSession.id },
    }), {
      httpOnly: true,
      secure: url.protocol === 'https:',
      sameSite: 'lax',
      path: '/settings/teams',
      expires: oauthSession.expiresAt,
    })
    return NextResponse.redirect(new URL('/settings/teams', url.origin))
  } catch (error) {
    const destination = new URL('/settings', url.origin)
    destination.searchParams.set('error', error instanceof Error ? error.message : 'Connexion Microsoft Teams impossible.')
    return NextResponse.redirect(destination)
  }
}
