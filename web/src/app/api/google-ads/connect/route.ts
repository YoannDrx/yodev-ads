import { randomBytes } from 'node:crypto'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { hasGoogleConfiguration } from '@/lib/env'
import { googleAuthorizationUrl } from '@/lib/google-ads'
import { normalizeCustomerId } from '@/lib/ids'
import { oauthCallbackUrl, sealOAuthState } from '@/lib/oauth-state'
import { consumeRateLimit } from '@/lib/rate-limit'
import { requireAdminWorkspace } from '@/lib/workspace'

export async function GET(request: Request) {
  try {
    if (!hasGoogleConfiguration()) throw new Error('La configuration OAuth Google n’est pas encore terminée.')
    const { workspace, session } = await requireAdminWorkspace()
    const limit = await consumeRateLimit({
      workspaceId: workspace.id,
      namespace: 'oauth-google-ads',
      identity: session.userId,
      limit: 10,
      windowMs: 60 * 60_000,
    })
    if (!limit.allowed) throw new Error(`Trop de tentatives OAuth. Réessayez dans ${limit.retryAfterSeconds} secondes.`)
    const url = new URL(request.url)
    const managerCustomerId = normalizeCustomerId(url.searchParams.get('managerCustomerId') ?? '')
    const redirectUri = oauthCallbackUrl('google_ads', url)
    const state = randomBytes(32).toString('base64url')
    const cookieStore = await cookies()
    cookieStore.set(
      'yodev_ads_google_oauth',
      sealOAuthState({
        provider: 'google_ads',
        state,
        workspaceId: workspace.id,
        userId: session.userId,
        payload: { managerCustomerId },
      }),
      { httpOnly: true, secure: url.protocol === 'https:', sameSite: 'lax', path: '/', maxAge: 600 },
    )
    return NextResponse.redirect(googleAuthorizationUrl(state, redirectUri))
  } catch (error) {
    const url = new URL('/settings', request.url)
    url.searchParams.set('error', error instanceof Error ? error.message : 'Connexion Google impossible.')
    return NextResponse.redirect(url)
  }
}
