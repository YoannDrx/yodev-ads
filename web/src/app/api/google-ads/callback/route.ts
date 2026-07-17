import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { getDb } from '@/db'
import { auditEvents, googleAdsConnections } from '@/db/schema'
import { encryptSecret } from '@/lib/crypto'
import { exchangeAuthorizationCode } from '@/lib/google-ads'
import { requireAdminWorkspace } from '@/lib/workspace'

type OAuthState = { state: string; workspaceId: string; userId: string; managerCustomerId: string }

export async function GET(request: Request) {
  const url = new URL(request.url)
  try {
    const { workspace, session } = await requireAdminWorkspace()
    const code = url.searchParams.get('code')
    const returnedState = url.searchParams.get('state')
    const oauthError = url.searchParams.get('error')
    if (oauthError) throw new Error(`Google a interrompu l’autorisation : ${oauthError}`)
    if (!code || !returnedState) throw new Error('Réponse OAuth incomplète.')

    const cookieStore = await cookies()
    const encoded = cookieStore.get('vigieads_google_oauth')?.value
    cookieStore.delete('vigieads_google_oauth')
    if (!encoded) throw new Error('La session OAuth a expiré. Relancez la connexion.')
    const state = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as OAuthState
    if (
      state.state !== returnedState ||
      state.workspaceId !== workspace.id ||
      state.userId !== session.userId ||
      state.managerCustomerId.length !== 10
    ) {
      throw new Error('La vérification de sécurité OAuth a échoué.')
    }

    const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI ?? new URL('/api/google-ads/callback', url.origin).toString()
    const tokens = await exchangeAuthorizationCode(code, redirectUri)
    const db = getDb()
    const [connection] = await db
      .insert(googleAdsConnections)
      .values({
        workspaceId: workspace.id,
        managerCustomerId: state.managerCustomerId,
        googleEmail: tokens.email,
        encryptedRefreshToken: encryptSecret(tokens.refreshToken),
        scopes: tokens.scopes,
        connectedBy: session.userId,
      })
      .onConflictDoUpdate({
        target: googleAdsConnections.workspaceId,
        set: {
          managerCustomerId: state.managerCustomerId,
          googleEmail: tokens.email,
          encryptedRefreshToken: encryptSecret(tokens.refreshToken),
          scopes: tokens.scopes,
          connectedBy: session.userId,
          status: 'active',
          updatedAt: new Date(),
        },
      })
      .returning()
    await db.insert(auditEvents).values({
      workspaceId: workspace.id,
      actorUserId: session.userId,
      action: 'google_ads.connected',
      entityType: 'google_ads_connection',
      entityId: connection.id,
      metadata: { managerCustomerId: state.managerCustomerId, googleEmail: tokens.email },
    })

    const destination = new URL('/settings', url.origin)
    destination.searchParams.set('notice', 'Google Ads est connecté. Synchronisez maintenant les comptes clients.')
    return NextResponse.redirect(destination)
  } catch (error) {
    const destination = new URL('/settings', url.origin)
    destination.searchParams.set('error', error instanceof Error ? error.message : 'Connexion Google impossible.')
    return NextResponse.redirect(destination)
  }
}
