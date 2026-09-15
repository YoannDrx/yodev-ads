import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { encryptSecret } from '@/lib/crypto'
import { exchangeAuthorizationCode, GOOGLE_ADS_SCOPE } from '@/lib/google-ads'
import { oauthCallbackUrl, openOAuthState } from '@/lib/oauth-state'
import { requireWorkspacePermission } from '@/lib/workspace'
import { saveWorkspaceGoogleConnection } from '@/lib/data'
import { requireCapability } from '@/lib/entitlements'

export async function GET(request: Request) {
  const url = new URL(request.url)
  try {
    const { workspace, session, entitlements } = await requireWorkspacePermission('google:connect')
    requireCapability(entitlements, 'google.read')
    const code = url.searchParams.get('code')
    const returnedState = url.searchParams.get('state')
    const oauthError = url.searchParams.get('error')
    if (oauthError) throw new Error(`Google a interrompu l’autorisation : ${oauthError}`)
    if (!code || !returnedState) throw new Error('Réponse OAuth incomplète.')

    const cookieStore = await cookies()
    const encoded = cookieStore.get('yodev_ads_google_oauth')?.value
    // Keep the expiring state cookie: a delayed callback must not clear the
    // newer cookie issued by another authorization. Google's code is single-use.
    if (!encoded) throw new Error('La session OAuth a expiré. Relancez la connexion.')
    const state = openOAuthState(encoded, 'google_ads')
    const managerCustomerId = state.payload.managerCustomerId ?? ''
    if (
      state.state !== returnedState ||
      state.workspaceId !== workspace.id ||
      state.userId !== session.userId ||
      !/^\d{10}$/.test(managerCustomerId) ||
      !state.payload.connectionVersion
    ) {
      throw new Error('La vérification de sécurité OAuth a échoué.')
    }

    const redirectUri = oauthCallbackUrl('google_ads', url)
    const tokens = await exchangeAuthorizationCode(code, redirectUri)
    if (!tokens.scopes.includes(GOOGLE_ADS_SCOPE)) throw new Error(workspace.locale === 'en' ? 'Google Ads access was not granted. Restart the connection and allow this access.' : 'L’accès Google Ads n’a pas été accordé. Relancez la connexion et autorisez cet accès.')
    await saveWorkspaceGoogleConnection({
      workspaceId: workspace.id,
      userId: session.userId,
      managerCustomerId,
      googleEmail: tokens.email,
      encryptedRefreshToken: encryptSecret(tokens.refreshToken),
      scopes: tokens.scopes,
      expectedConnectionVersion: state.payload.connectionVersion,
      authorizationExpiresAt: new Date(state.expiresAt),
    })

    const destination = new URL('/settings', url.origin)
    destination.searchParams.set('notice', workspace.locale === 'en' ? 'Google Ads is connected. Synchronize your client accounts now.' : 'Google Ads est connecté. Synchronisez maintenant les comptes clients.')
    return NextResponse.redirect(destination)
  } catch (error) {
    // Discard an unpersisted token. Google revocation invalidates the account's
    // combined project grant, including tokens used by other live connections:
    // https://developers.google.com/identity/protocols/oauth2/web-server#tokenrevoke
    const destination = new URL('/settings', url.origin)
    destination.searchParams.set('error', error instanceof Error ? error.message : 'Connexion Google impossible.')
    return NextResponse.redirect(destination)
  }
}
