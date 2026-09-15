import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fetchReleaseEvidence, releaseVerificationContext, verifyReleaseIdentity } from './release-verification.mjs'

const env = { RELEASE_TARGET: 'staging', RELEASE_VERIFICATION_EXPECTED_SHA: 'a'.repeat(40), RELEASE_VERIFICATION_BASE_URL: 'https://staging.example.test', RELEASE_VERIFICATION_ALLOWED_ORIGIN: 'https://staging.example.test', RELEASE_VERIFICATION_TOKEN: 'test-only' }
const now = new Date('2026-09-07T00:00:00Z')
const evidence = { target: 'staging', release: env.RELEASE_VERIFICATION_EXPECTED_SHA, checkedAt: now.toISOString() }

test('each release target verifies the exact candidate and fresh evidence', () => {
  for (const target of ['staging', 'private_beta', 'public']) {
    const context = releaseVerificationContext({ ...env, RELEASE_TARGET: target })
    assert.doesNotThrow(() => verifyReleaseIdentity({ ...evidence, target }, context, now))
  }
})
test('refuses wrong or incomplete identity before accepting evidence', () => {
  const context = releaseVerificationContext(env)
  for (const mutation of [{ target: 'public' }, { release: 'b'.repeat(40) }, { checkedAt: 'invalid' }, { checkedAt: '2026-09-06T23:00:00Z' }, { checkedAt: '2026-09-07T01:00:00Z' }]) assert.throws(() => verifyReleaseIdentity({ ...evidence, ...mutation }, context, now))
  assert.throws(() => releaseVerificationContext({ ...env, RELEASE_VERIFICATION_EXPECTED_SHA: '' }))
  assert.throws(() => releaseVerificationContext({ ...env, RELEASE_TARGET: 'production' }))
})
test('never sends a secret to an origin supplied only by a workflow input', async () => {
  let called = false
  for (const url of ['https://untrusted.example.test', 'http://staging.example.test', 'https://user:password@staging.example.test', 'https://staging.example.test/path']) {
    await assert.rejects(fetchReleaseEvidence('/api/internal/release-readiness', {}, { env: { ...env, RELEASE_VERIFICATION_BASE_URL: url }, fetch: async () => { called = true } }))
  }
  assert.equal(called, false)
  await assert.rejects(fetchReleaseEvidence('https://untrusted.example.test/check', {}, { env, fetch: async () => { called = true } }))
  assert.equal(called, false)
})
test('sends identity guards and rejects redirects or non-success evidence', async () => {
  await fetchReleaseEvidence('/api/internal/release-readiness', {}, { env, now, fetch: async (url, options) => {
    assert.equal(url.origin, env.RELEASE_VERIFICATION_ALLOWED_ORIGIN)
    assert.equal(options.redirect, 'error')
    assert.equal(options.headers['x-expected-release-sha'], env.RELEASE_VERIFICATION_EXPECTED_SHA)
    return Response.json(evidence)
  } })
  await assert.rejects(fetchReleaseEvidence('/api/internal/release-readiness', {}, { env, now, fetch: async () => Response.json(evidence, { status: 503 }) }))
})
test('reports actionable issue codes without dumping provider messages or credential fields', async () => {
  await assert.rejects(fetchReleaseEvidence('/api/internal/release-readiness', {}, { env, now, fetch: async () => Response.json({
    issues: [{ code: 'flags.slack_connector', message: 'private detail' }], token: 'sensitive-secret',
  }, { status: 503 }) }), (error) => {
    assert.match(error.message, /flags.slack_connector/)
    assert.doesNotMatch(error.message, /private detail|sensitive-secret/)
    return true
  })
})
