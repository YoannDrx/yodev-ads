import { fetchReleaseEvidence } from './lib/release-verification.mjs'

try {
  const { body } = await fetchReleaseEvidence('/api/internal/release-readiness')
  console.log(JSON.stringify(body, null, 2))
  if (body.ready !== true) process.exitCode = 1
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Configuration verification failed')
  process.exitCode = 1
}
