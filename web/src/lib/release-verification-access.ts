import 'server-only'

import { timingSafeEqual } from 'node:crypto'

export function releaseVerificationAuthorized(request: Request, env: Record<string, string | undefined> = process.env) {
  const expected = env.RELEASE_VERIFICATION_TOKEN
  const authorization = request.headers.get('authorization')
  const provided = authorization?.startsWith('Bearer ') ? authorization.slice(7) : ''
  if (!expected || !provided) return false
  const left = Buffer.from(expected)
  const right = Buffer.from(provided)
  return left.length === right.length && timingSafeEqual(left, right)
}

export function releaseIdentityIssue(request: Request, required: boolean, env: Record<string, string | undefined> = process.env) {
  const expectedSha = request.headers.get('x-expected-release-sha')
  const expectedTarget = request.headers.get('x-expected-release-target')
  if (!expectedSha && !expectedTarget && !required) return null
  if (!expectedSha || !expectedTarget) return 'release.expected_identity_missing'
  if (!/^[a-f0-9]{40}$/.test(expectedSha)) return 'release.invalid_expected_sha'
  const actualSha = env.VERCEL_GIT_COMMIT_SHA ?? env.NEXT_PUBLIC_RELEASE_SHA
  if (expectedSha !== actualSha) return 'release.sha_mismatch'
  if (expectedTarget !== env.RELEASE_TARGET) return 'release.target_mismatch'
  return null
}
