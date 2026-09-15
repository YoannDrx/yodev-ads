import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ run: vi.fn() }))
vi.mock('@/lib/sentry-read-probe', () => ({ runSentryReadProbe: mocks.run }))
import { GET } from './route'

const sha = 'a'.repeat(40)
function request(overrides: Record<string, string> = {}) {
  return new Request('https://ads.example.test/api/internal/sentry-read-probe', { headers: {
    authorization: 'Bearer fixture-token', 'x-expected-release-sha': sha,
    'x-expected-release-target': process.env.RELEASE_TARGET!, ...overrides,
  } })
}
describe('Sentry read probe access', () => {
  beforeEach(() => {
    vi.stubEnv('RELEASE_VERIFICATION_TOKEN', 'fixture-token')
    vi.stubEnv('VERCEL_GIT_COMMIT_SHA', sha)
    vi.stubEnv('RELEASE_TARGET', 'public')
    mocks.run.mockReset().mockResolvedValue({ verified: true, mode: 'read_only', redactionVerified: true })
  })
  afterEach(() => vi.unstubAllEnvs())
  it.each(['staging', 'private_beta', 'public'])('verifies existing evidence on %s', async (target) => {
    vi.stubEnv('RELEASE_TARGET', target)
    const response = await GET(request())
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toContain('no-store')
    expect(await response.json()).toMatchObject({ target, release: sha, mode: 'read_only', verified: true })
    expect(mocks.run).toHaveBeenCalledOnce()
  })
  it('checks credentials and exact identity before reading provider evidence', async () => {
    for (const [headers, status] of [
      [{ authorization: 'Bearer wrong' }, 401], [{ 'x-expected-release-sha': 'b'.repeat(40) }, 412],
      [{ 'x-expected-release-target': 'staging' }, 412], [{ 'x-expected-release-sha': '' }, 412],
    ] as const) expect((await GET(request(headers))).status).toBe(status)
    expect(mocks.run).not.toHaveBeenCalled()
  })
  it('rejects unknown environments and hides provider secrets on failure', async () => {
    vi.stubEnv('RELEASE_TARGET', 'preview')
    expect((await GET(request())).status).toBe(409)
    expect(mocks.run).not.toHaveBeenCalled()
    vi.stubEnv('RELEASE_TARGET', 'public')
    mocks.run.mockRejectedValue(new Error('private-token'))
    const response = await GET(request())
    expect(response.status).toBe(502)
    expect(await response.text()).not.toContain('private-token')
  })
})
