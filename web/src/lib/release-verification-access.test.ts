import { describe, expect, it } from 'vitest'
import { releaseIdentityIssue, releaseVerificationAuthorized } from './release-verification-access'

const env = { RELEASE_TARGET: 'public', VERCEL_GIT_COMMIT_SHA: 'a'.repeat(40), RELEASE_VERIFICATION_TOKEN: 'local-token' }
const request = (headers: Record<string, string> = {}) => new Request('https://example.test/probe', { headers })
describe('release verification admission', () => {
  it('compares bearer tokens without accepting missing, truncated or unrelated values', () => {
    for (const authorization of ['', 'Bearer wrong', 'Basic local-token']) expect(releaseVerificationAuthorized(request({ authorization }), env)).toBe(false)
    expect(releaseVerificationAuthorized(request({ authorization: 'Bearer local-token' }), env)).toBe(true)
  })
  it('requires exact identity on commercial probes while preserving old staging callers', () => {
    expect(releaseIdentityIssue(request(), true, env)).toBe('release.expected_identity_missing')
    expect(releaseIdentityIssue(request(), false, env)).toBeNull()
    const headers = { 'x-expected-release-sha': env.VERCEL_GIT_COMMIT_SHA, 'x-expected-release-target': env.RELEASE_TARGET }
    expect(releaseIdentityIssue(request(headers), true, env)).toBeNull()
    expect(releaseIdentityIssue(request({ ...headers, 'x-expected-release-sha': 'b'.repeat(40) }), true, env)).toBe('release.sha_mismatch')
    expect(releaseIdentityIssue(request({ ...headers, 'x-expected-release-target': 'staging' }), true, env)).toBe('release.target_mismatch')
  })
})
