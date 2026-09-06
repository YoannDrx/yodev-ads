import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ run: vi.fn() }))
vi.mock('@/lib/google-ads-read-drill', () => ({
  runGoogleAdsReadProbe: mocks.run,
  GoogleAdsReadDrillError: class extends Error {},
}))
import { GET } from './route'

const sha = 'a'.repeat(40)
function request(overrides: Record<string, string> = {}) {
  return new Request('https://ads.example.test/api/internal/google-ads-read-probe', { headers: {
    authorization: 'Bearer fixture-token', 'x-expected-release-sha': sha, 'x-expected-release-target': process.env.RELEASE_TARGET!, ...overrides,
  } })
}
describe('commercial Google read probe', () => {
  beforeEach(() => {
    vi.stubEnv('RELEASE_VERIFICATION_TOKEN', 'fixture-token')
    vi.stubEnv('VERCEL_GIT_COMMIT_SHA', sha)
    vi.stubEnv('RELEASE_TARGET', 'public')
    vi.stubEnv('GOOGLE_READS_ENABLED', '1')
    mocks.run.mockReset().mockResolvedValue({ verified: true, mode: 'read_only' })
  })
  afterEach(() => vi.unstubAllEnvs())
  it.each(['staging', 'private_beta', 'public'])('reads on %s even when product mutation families are enabled', async (target) => {
    vi.stubEnv('RELEASE_TARGET', target)
    vi.stubEnv('GOOGLE_MUTATIONS_ENABLED', '1')
    vi.stubEnv('FORCE_READ_ONLY', '0')
    const response = await GET(request())
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toContain('no-store')
    expect(await response.json()).toMatchObject({ target, release: sha, mode: 'read_only', verified: true })
    expect(mocks.run).toHaveBeenCalledOnce()
  })
  it('rejects wrong credentials, SHA, target and missing identity before provider access', async () => {
    for (const [headers, status] of [
      [{ authorization: 'Bearer wrong' }, 401], [{ 'x-expected-release-sha': 'b'.repeat(40) }, 412],
      [{ 'x-expected-release-target': 'staging' }, 412], [{ 'x-expected-release-sha': '' }, 412],
    ] as const) expect((await GET(request(headers))).status).toBe(status)
    expect(mocks.run).not.toHaveBeenCalled()
  })
  it('honors the Google read switch and reports provider failure safely', async () => {
    vi.stubEnv('GOOGLE_READS_ENABLED', '0')
    expect((await GET(request())).status).toBe(409)
    expect(mocks.run).not.toHaveBeenCalled()
    vi.stubEnv('GOOGLE_READS_ENABLED', '1')
    mocks.run.mockRejectedValue(new Error('sensitive-token'))
    const response = await GET(request())
    expect(response.status).toBe(502)
    expect(await response.text()).not.toContain('sensitive-token')
  })
})
