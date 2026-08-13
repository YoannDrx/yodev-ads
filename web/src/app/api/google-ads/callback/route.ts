import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { encryptSecret } from '@/lib/crypto'
import { exchangeAuthorizationCode, revokeGoogleOAuthToken } from '@/lib/google-ads'
import { oauthCallbackUrl, openOAuthState } from '@/lib/oauth-state'
import { requireAdminWorkspace } from '@/lib/workspace'
import { saveWorkspaceGoogleConnection } from '@/lib/data'

export async function GET(request: Request) {
  const url = new URL(request.url)
  let unpersistedRefreshToken: string | null = null
  try {
    const { workspace, session } = await requireAdminWorkspace()
    const code = url.searchParams.get('code')
    const returnedState = url.searchParams.get('state')
    const oauthError = url.searchParams.get('error')
    if (oauthError) throw new Error(`Google a interrompu l’autorisation : ${oauthError}`)
    if (!code || !returnedState) throw new Error('Réponse OAuth incomplète.')

    const cookieStore = await cookies()
    const encoded = cookieStore.get('yodev_ads_google_oauth')?.value
    cookieStore.delete('yodev_ads_google_oauth')
    if (!encoded) throw new Error('La session OAuth a expiré. Relancez la connexion.')
    const state = openOAuthState(encoded, 'google_ads')
    const managerCustomerId = state.payload.managerCustomerId ?? ''
    if (
      state.state !== returnedState ||
      state.workspaceId !== workspace.id ||
      state.userId !== session.userId ||
      managerCustomerId.length !== 10
    ) {
      throw new Error('La vérification de sécurité OAuth a échoué.')
    }

    const redirectUri = oauthCallbackUrl('google_ads', url)
    const tokens = await exchangeAuthorizationCode(code, redirectUri)
    unpersistedRefreshToken = tokens.refreshToken
    await saveWorkspaceGoogleConnection({
      workspaceId: workspace.id,
      userId: session.userId,
      managerCustomerId,
      googleEmail: tokens.email,
      encryptedRefreshToken: encryptSecret(tokens.refreshToken),
      scopes: tokens.scopes,
    })
    unpersistedRefreshToken = null

    const destination = new URL('/settings', url.origin)
    destination.searchParams.set('notice', 'Google Ads est connecté. Synchronisez maintenant les comptes clients.')
    return NextResponse.redirect(destination)
  } catch (error) {
    if (unpersistedRefreshToken) {
      try {
        await revokeGoogleOAuthToken(unpersistedRefreshToken)
      } catch {
        // Best effort: preserve the original lifecycle/tenant failure shown to the actor.
      }
    }
    const destination = new URL('/settings', url.origin)
    destination.searchParams.set('error', error instanceof Error ? error.message : 'Connexion Google impossible.')
    return NextResponse.redirect(destination)
  }
}
