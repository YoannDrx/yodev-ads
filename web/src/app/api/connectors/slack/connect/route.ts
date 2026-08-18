import { randomBytes } from 'node:crypto'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { requireCapability } from '@/lib/entitlements'
import { oauthCallbackUrl, sealOAuthState } from '@/lib/oauth-state'
import { consumeRateLimit } from '@/lib/rate-limit'
import { hasSlackOAuthConfiguration, slackAuthorizationUrl } from '@/lib/slack-oauth'
import { requireWorkspacePermission } from '@/lib/workspace'
import { requireFeature } from '@/lib/feature-flags'

const COOKIE_NAME = 'yodev_ads_slack_oauth'

export async function GET(request: Request) {
  try {
    requireFeature('notifications', 'Les notifications sont temporairement désactivées.')
    if (!hasSlackOAuthConfiguration()) throw new Error('La configuration OAuth Slack est incomplète.')
    const { workspace, session, entitlements } = await requireWorkspacePermission('workspace:admin')
    requireCapability(entitlements, 'notifications.webhook')
    const limit = await consumeRateLimit({
      workspaceId: workspace.id,
      namespace: 'oauth-slack',
      identity: session.userId,
      limit: 10,
      windowMs: 60 * 60_000,
    })
    if (!limit.allowed) throw new Error(`Trop de tentatives OAuth. Réessayez dans ${limit.retryAfterSeconds} secondes.`)
    const url = new URL(request.url)
    const state = randomBytes(32).toString('base64url')
    const redirectUri = oauthCallbackUrl('slack', url)
    const sealed = sealOAuthState({ provider: 'slack', state, workspaceId: workspace.id, userId: session.userId })
    const cookieStore = await cookies()
    cookieStore.set(COOKIE_NAME, sealed, {
      httpOnly: true,
      secure: url.protocol === 'https:',
      sameSite: 'lax',
      path: '/api/connectors/slack',
      maxAge: 600,
    })
    return NextResponse.redirect(slackAuthorizationUrl({ state, redirectUri }))
  } catch (error) {
    const url = new URL('/settings', request.url)
    url.searchParams.set('error', error instanceof Error ? error.message : 'Connexion Slack impossible.')
    return NextResponse.redirect(url)
  }
}
