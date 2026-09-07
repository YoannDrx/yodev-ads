import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { requireCapability } from '@/lib/entitlements'
import { requireFeature } from '@/lib/feature-flags'
import { createTeamsOAuthSession } from '@/lib/notification-oauth-management'
import { oauthCallbackUrl, openOAuthState, sealOAuthState } from '@/lib/oauth-state'
import { teamsAuthorizationCookieName, teamsConnectionError, teamsSessionCookieName } from '@/lib/teams-session-context'
import { exchangeTeamsAuthorizationCode } from '@/lib/teams-oauth'
import { requireWorkspacePermission } from '@/lib/workspace'


export async function GET(request: Request) {
  const url = new URL(request.url)
  let english = false
  try {
    requireFeature('notifications', 'Les notifications sont temporairement désactivées.')
    requireFeature('teamsConnector', 'Le connecteur Microsoft Teams est temporairement désactivé.')
    const { workspace, session, entitlements } = await requireWorkspacePermission('workspace:admin')
    english = workspace.locale === 'en'
    requireCapability(entitlements, 'notifications.webhook')
    const code = url.searchParams.get('code')
    const returnedState = url.searchParams.get('state')
    const oauthError = url.searchParams.get('error')
    const cookieStore = await cookies()
    const sealed = cookieStore.get(teamsAuthorizationCookieName(returnedState ?? ''))?.value
    // Do not clear a newer authorization cookie from a delayed response.
    if (oauthError) throw new Error(`Microsoft a interrompu l’autorisation : ${oauthError}`)
    if (!code || !returnedState) throw new Error('Réponse OAuth Microsoft Teams incomplète.')
    if (!sealed) throw new Error('La session OAuth a expiré. Relancez la connexion.')
    const state = openOAuthState(sealed, 'teams')
    if (state.state !== returnedState || state.workspaceId !== workspace.id || state.userId !== session.userId) {
      throw new Error('La vérification de sécurité OAuth a échoué.')
    }
    const codeVerifier = state.payload.codeVerifier
    if (!state.payload.authorizationId || !/^[0-9a-f-]{36}$/i.test(state.payload.authorizationId)) throw new Error('La session OAuth Teams a changé. Relancez la connexion.')
    if (!codeVerifier) throw new Error('La preuve PKCE OAuth est absente.')

    const redirectUri = oauthCallbackUrl('teams', url)
    const tokens = await exchangeTeamsAuthorizationCode({ code, redirectUri, codeVerifier })
    const oauthSession = await createTeamsOAuthSession({
      workspaceId: workspace.id,
      actorUserId: session.userId,
      authorizationId: state.payload.authorizationId,
      refreshToken: tokens.refreshToken,
      scopes: tokens.scopes,
      authorizationExpiresAt: new Date(state.expiresAt),
    })
    cookieStore.set(teamsSessionCookieName(oauthSession.id), sealOAuthState({
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
    return NextResponse.redirect(new URL(`/settings/teams?sessionId=${oauthSession.id}&workspaceId=${workspace.id}`, url.origin))
  } catch (error) {
    const destination = new URL('/settings', url.origin)
    destination.searchParams.set('error', teamsConnectionError(error, english))
    return NextResponse.redirect(destination)
  }
}
