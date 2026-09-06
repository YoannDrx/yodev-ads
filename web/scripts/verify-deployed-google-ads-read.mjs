import { fetchReleaseEvidence, releaseVerificationContext } from './lib/release-verification.mjs'

try {
  const context = releaseVerificationContext()
  const staging = context.target === 'staging'
  const { body } = await fetchReleaseEvidence(staging ? '/api/internal/google-ads-read-drill' : '/api/internal/google-ads-read-probe', { method: staging ? 'POST' : 'GET', timeoutMs: 55_000 })
  console.log(JSON.stringify(body, null, 2))
  const requestIds = body.requestIds && typeof body.requestIds === 'object' ? Object.values(body.requestIds).flat().filter((value) => typeof value === 'string' && value.length > 0) : []
  if (body.verified !== true || body.mode !== 'read_only' || body.refreshTokenRenewed !== true || requestIds.length < 7) process.exitCode = 1
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Google verification failed')
  process.exitCode = 1
}
