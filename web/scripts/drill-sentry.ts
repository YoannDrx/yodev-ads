import * as Sentry from '@sentry/nextjs'
import { redactSentryEvent } from '../src/lib/sentry-redaction'

function required(name: string) {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is required`)
  return value
}

const dsn = required('SENTRY_DSN')
const authToken = required('SENTRY_AUTH_TOKEN')
const organization = required('SENTRY_ORG')
const project = required('SENTRY_PROJECT')
const environment = required('SENTRY_DRILL_ENVIRONMENT')
const release = process.env.SENTRY_DRILL_RELEASE ?? process.env.VERCEL_GIT_COMMIT_SHA ?? 'local-drill'
const apiBaseUrl = process.env.SENTRY_API_BASE_URL ?? 'https://sentry.io'

if (environment === 'production' && process.env.SENTRY_DRILL_ALLOW_PRODUCTION !== '1') {
  throw new Error('Refusing to run the synthetic Sentry drill in production without explicit opt-in')
}

const syntheticEmail = 'sentry-drill-person@example.invalid'
const syntheticToken = 'ya_live_syntheticredactionmarker'

async function main() {
  const marker = `ads-by-yodev-sentry-drill-${Date.now()}`
  Sentry.init({
    dsn,
    environment,
    release,
    sendDefaultPii: false,
    tracesSampleRate: 0,
    beforeSend: (event) => redactSentryEvent(event),
  })

  const eventId = Sentry.withScope((scope) => {
    scope.setTag('ads_by_yodev_drill', marker)
    scope.setUser({ email: syntheticEmail })
    scope.setContext('synthetic_request', {
      authorization: `Bearer ${syntheticToken}`,
      callbackUrl: `https://example.invalid/callback?token=${syntheticToken}`,
    })
    return Sentry.captureException(new Error(`${marker}: ${syntheticToken}`))
  })

  if (!await Sentry.flush(10_000)) throw new Error('Sentry did not flush the synthetic event')

  const eventUrl = new URL(
    `/api/0/projects/${encodeURIComponent(organization)}/${encodeURIComponent(project)}/events/${eventId}/`,
    apiBaseUrl,
  )
  eventUrl.searchParams.append('environment', environment)

  let indexedEvent: unknown
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const response = await fetch(eventUrl, {
      headers: { authorization: `Bearer ${authToken}` },
      signal: AbortSignal.timeout(10_000),
    })
    if (response.ok) {
      indexedEvent = await response.json()
      break
    }
    if (response.status !== 404) throw new Error(`Sentry event lookup failed with HTTP ${response.status}`)
    await new Promise((resolve) => setTimeout(resolve, 3_000))
  }

  if (!indexedEvent) throw new Error(`Sentry did not index synthetic event ${eventId}`)
  const serializedEvent = JSON.stringify(indexedEvent)
  if (serializedEvent.includes(syntheticEmail) || serializedEvent.includes(syntheticToken)) {
    throw new Error('Sentry indexed unredacted synthetic data')
  }
  if (!serializedEvent.includes('[REDACTED_API_KEY]')) {
    throw new Error('Sentry event does not contain the expected redaction marker')
  }

  process.stdout.write(`${JSON.stringify({
    mode: 'synthetic',
    environment,
    release,
    eventId,
    marker,
    accepted: true,
    indexed: true,
    redactionVerified: true,
  }, null, 2)}\n`)
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
