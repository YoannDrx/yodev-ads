import { timingSafeEqual } from 'node:crypto'
import * as Sentry from '@sentry/nextjs'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const noStoreHeaders = { 'Cache-Control': 'no-store, max-age=0' }
const syntheticEmail = 'sentry-drill-person@example.invalid'
const syntheticToken = 'ya_live_syntheticredactionmarker'

function authorized(request: Request) {
  const expected = process.env.RELEASE_VERIFICATION_TOKEN
  const authorization = request.headers.get('authorization')
  const provided = authorization?.startsWith('Bearer ') ? authorization.slice(7) : ''
  if (!expected || !provided) return false
  const expectedBytes = Buffer.from(expected)
  const providedBytes = Buffer.from(provided)
  return expectedBytes.length === providedBytes.length && timingSafeEqual(expectedBytes, providedBytes)
}

async function indexedEvent(eventId: string) {
  const organization = process.env.SENTRY_ORG
  const project = process.env.SENTRY_PROJECT
  const authToken = process.env.SENTRY_AUTH_TOKEN
  if (!organization || !project || !authToken) return null
  const eventUrl = new URL(
    `/api/0/projects/${encodeURIComponent(organization)}/${encodeURIComponent(project)}/events/${eventId}/`,
    process.env.SENTRY_API_BASE_URL ?? 'https://sentry.io',
  )
  eventUrl.searchParams.append('environment', 'staging')
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const response = await fetch(eventUrl, {
      headers: { authorization: `Bearer ${authToken}` },
      signal: AbortSignal.timeout(8_000),
    })
    if (response.ok) return response.json()
    if (response.status !== 404) return null
    await new Promise((resolve) => setTimeout(resolve, 2_000))
  }
  return null
}

export async function POST(request: Request) {
  if (!authorized(request)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401, headers: noStoreHeaders })
  }
  if (process.env.RELEASE_TARGET !== 'staging') {
    return Response.json({ verified: false, code: 'staging_only' }, { status: 409, headers: noStoreHeaders })
  }
  if (!process.env.SENTRY_DSN || !process.env.SENTRY_AUTH_TOKEN || !process.env.SENTRY_ORG || !process.env.SENTRY_PROJECT) {
    return Response.json({ verified: false, code: 'configuration_missing' }, { status: 503, headers: noStoreHeaders })
  }

  const marker = `ads-by-yodev-sentry-drill-${Date.now()}`
  const eventId = Sentry.withScope((scope) => {
    scope.setTag('ads_by_yodev_drill', marker)
    scope.setUser({ email: syntheticEmail })
    scope.setContext('synthetic_request', {
      authorization: `Bearer ${syntheticToken}`,
      callbackUrl: `https://example.invalid/callback?token=${syntheticToken}`,
    })
    return Sentry.captureException(new Error(`${marker}: ${syntheticToken}`))
  })

  if (!await Sentry.flush(10_000)) {
    return Response.json({ verified: false, code: 'delivery_failed' }, { status: 502, headers: noStoreHeaders })
  }
  const event = await indexedEvent(eventId)
  if (!event) {
    return Response.json({ verified: false, code: 'indexing_failed' }, { status: 502, headers: noStoreHeaders })
  }
  const serialized = JSON.stringify(event)
  if (
    serialized.includes(syntheticEmail)
    || serialized.includes(syntheticToken)
    || !serialized.includes('[REDACTED_API_KEY]')
  ) {
    return Response.json({ verified: false, code: 'redaction_failed' }, { status: 502, headers: noStoreHeaders })
  }

  return Response.json({
    verified: true,
    environment: 'staging',
    eventId,
    marker,
    release: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
    checkedAt: new Date().toISOString(),
  }, { headers: noStoreHeaders })
}
