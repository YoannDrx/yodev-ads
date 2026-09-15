import { fetchReleaseEvidence, releaseVerificationContext } from './lib/release-verification.mjs'

try {
  const staging = releaseVerificationContext().target === 'staging'
  const { body } = await fetchReleaseEvidence(staging ? '/api/internal/sentry-drill' : '/api/internal/sentry-read-probe', { method: staging ? 'POST' : 'GET', timeoutMs: staging ? 55_000 : 18_000 })
  console.log(JSON.stringify(body, null, 2))
  if (body.verified !== true || (!staging && (body.mode !== 'read_only' || body.redactionVerified !== true))) process.exitCode = 1
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Sentry verification failed')
  process.exitCode = 1
}
