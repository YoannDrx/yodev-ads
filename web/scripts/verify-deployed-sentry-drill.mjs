import { fetchReleaseEvidence } from './lib/release-verification.mjs'

try {
  const { body } = await fetchReleaseEvidence('/api/internal/sentry-drill', { method: 'POST', timeoutMs: 60_000 })
  if (body.verified !== true || !/^[a-f0-9]{32}$/i.test(body.eventId ?? '')) throw new Error('The synthetic Sentry exercise did not return verified indexed evidence')
  console.log(JSON.stringify({ verified: true, eventId: body.eventId, release: body.release, target: body.target, checkedAt: body.checkedAt }))
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Synthetic Sentry exercise failed')
  process.exitCode = 1
}
