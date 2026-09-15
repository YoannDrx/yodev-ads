import * as Sentry from '@sentry/nextjs'
import { verifySentryProbeEvent } from '@/lib/sentry-read-probe'
import { pauseWithinWorkDeadline, remainingWorkMs, withWorkDeadline, workSignal } from '@/lib/work-deadline'
import { releaseIdentityIssue, releaseVerificationAuthorized } from '@/lib/release-verification-access'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const noStoreHeaders = { 'Cache-Control': 'no-store, max-age=0' }
const syntheticEmail = 'sentry-drill-person@example.invalid'
const syntheticToken = 'ya_live_syntheticredactionmarker'

async function indexedEvent(eventId: string) {
  const organization = process.env.SENTRY_ORG
  const project = process.env.SENTRY_PROJECT
  const authToken = process.env.SENTRY_EVENT_READ_AUTH_TOKEN
  if (!organization || !project || !authToken) return null
  const eventUrl = new URL(
    `/api/0/projects/${encodeURIComponent(organization)}/${encodeURIComponent(project)}/events/${eventId}/`,
    process.env.SENTRY_API_BASE_URL ?? 'https://de.sentry.io',
  )
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const response = await fetch(eventUrl, {
      headers: { authorization: `Bearer ${authToken}` },
      signal: workSignal(8_000), redirect: 'error', cache: 'no-store',
    })
    if (response.ok) return response.json()
    if (response.status !== 404) return null
    await pauseWithinWorkDeadline(2_000)
  }
  return null
}

export async function POST(request: Request) {
  if (!releaseVerificationAuthorized(request)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401, headers: noStoreHeaders })
  }
  const identityIssue = releaseIdentityIssue(request, process.env.RELEASE_TARGET !== 'staging')
  if (identityIssue) return Response.json({ verified: false, code: identityIssue }, { status: 412, headers: noStoreHeaders })
  if (process.env.RELEASE_TARGET !== 'staging' &&
    (!['private_beta', 'public'].includes(process.env.RELEASE_TARGET ?? '') || process.env.SENTRY_SYNTHETIC_VERIFICATION_ENABLED !== '1')) {
    return Response.json({ verified: false, code: 'staging_only' }, { status: 409, headers: noStoreHeaders })
  }
  if (process.env.SENTRY_API_BASE_URL !== 'https://de.sentry.io' || !(process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.NEXT_PUBLIC_RELEASE_SHA) || !process.env.SENTRY_DSN || !process.env.SENTRY_EVENT_READ_AUTH_TOKEN || !process.env.SENTRY_ORG || !process.env.SENTRY_PROJECT) {
    return Response.json({ verified: false, code: 'configuration_missing' }, { status: 503, headers: noStoreHeaders })
  }

  try {
    return await withWorkDeadline(Date.now() + 50_000, async () => {
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

      if (!await Sentry.flush(remainingWorkMs(10_000))) {
        return Response.json({ verified: false, code: 'delivery_failed' }, { status: 502, headers: noStoreHeaders })
      }
      const event = await indexedEvent(eventId)
      if (!event) {
        return Response.json({ verified: false, code: 'indexing_failed' }, { status: 502, headers: noStoreHeaders })
      }
      try {
        const projectId = new URL(process.env.SENTRY_DSN!).pathname.split('/').filter(Boolean).at(-1)!
        verifySentryProbeEvent(event, { eventId, projectId, target: process.env.RELEASE_TARGET!,
          release: (process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.NEXT_PUBLIC_RELEASE_SHA)!,
    })
  } catch {
    return Response.json({ verified: false, code: 'event_verification_failed' }, { status: 502, headers: noStoreHeaders })
  }

  return Response.json({
    verified: true,
    environment: process.env.RELEASE_TARGET,
    target: process.env.RELEASE_TARGET,
    eventId,
    marker,
    release: process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.NEXT_PUBLIC_RELEASE_SHA ?? null,
    checkedAt: new Date().toISOString(),
  }, { headers: noStoreHeaders })
    })
  } catch {
    return Response.json({ verified: false, code: 'indexing_failed' }, { status: 502, headers: noStoreHeaders })
  }
}
