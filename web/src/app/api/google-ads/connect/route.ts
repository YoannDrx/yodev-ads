import { randomBytes } from 'node:crypto'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { hasGoogleConfiguration } from '@/lib/env'
import { googleAuthorizationUrl } from '@/lib/google-ads'
import { normalizeCustomerId } from '@/lib/ids'
import { requireAdminWorkspace } from '@/lib/workspace'

export async function GET(request: Request) {
  try {
    if (!hasGoogleConfiguration()) throw new Error('La configuration OAuth Google n’est pas encore terminée.')
    const { workspace, session } = await requireAdminWorkspace()
    const url = new URL(request.url)
    const managerCustomerId = normalizeCustomerId(url.searchParams.get('managerCustomerId') ?? '')
    const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI ?? new URL('/api/google-ads/callback', url.origin).toString()
    const state = randomBytes(32).toString('base64url')
    const cookieStore = await cookies()
    cookieStore.set(
      'vigieads_google_oauth',
      Buffer.from(JSON.stringify({ state, workspaceId: workspace.id, userId: session.userId, managerCustomerId })).toString(
        'base64url',
      ),
      { httpOnly: true, secure: url.protocol === 'https:', sameSite: 'lax', path: '/', maxAge: 600 },
    )
    return NextResponse.redirect(googleAuthorizationUrl(state, redirectUri))
  } catch (error) {
    const url = new URL('/settings', request.url)
    url.searchParams.set('error', error instanceof Error ? error.message : 'Connexion Google impossible.')
    return NextResponse.redirect(url)
  }
}
