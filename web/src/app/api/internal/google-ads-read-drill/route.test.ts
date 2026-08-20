import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ run: vi.fn() }))

vi.mock('@/lib/google-ads-read-drill', () => ({
  GoogleAdsReadDrillError: class GoogleAdsReadDrillError extends Error {
    constructor(readonly code: string, readonly stage: string, readonly requestId: string | null = null) {
      super(code)
    }
  },
  runGoogleAdsReadDrill: mocks.run,
}))

import { GoogleAdsReadDrillError } from '@/lib/google-ads-read-drill'
import { POST } from './route'

const previousEnvironment = { ...process.env }
const token = 'release-token-that-is-at-least-32-characters'

function request(providedToken = token) {
  return POST(new Request('https://ads.example.test/api/internal/google-ads-read-drill', {
    method: 'POST',
    headers: { authorization: `Bearer ${providedToken}` },
  }))
}

beforeEach(() => {
  process.env.RELEASE_TARGET = 'staging'
  process.env.RELEASE_VERIFICATION_TOKEN = token
  process.env.GOOGLE_READS_ENABLED = '1'
  process.env.GOOGLE_MUTATIONS_ENABLED = '0'
  process.env.FORCE_READ_ONLY = '1'
  process.env.VERCEL_GIT_COMMIT_SHA = 'release-sha'
  mocks.run.mockReset().mockResolvedValue({
    verified: true,
    mode: 'read_only',
    refreshTokenRenewed: true,
    managedAccounts: 2,
    requestIds: { oauth_and_mcc: ['request-1'] },
  })
})

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in previousEnvironment)) delete process.env[key]
  }
  Object.assign(process.env, previousEnvironment)
})

describe('deployed Google Ads read drill route', () => {
  it('rejects unauthorized requests and refuses non-staging targets', async () => {
    expect((await request('wrong-token')).status).toBe(401)
    process.env.RELEASE_TARGET = 'public'
    expect((await request()).status).toBe(409)
    expect(mocks.run).not.toHaveBeenCalled()
  })

  it('refuses to run unless every read-only guard is active', async () => {
    for (const [name, value] of [
      ['GOOGLE_READS_ENABLED', '0'],
      ['GOOGLE_MUTATIONS_ENABLED', '1'],
      ['FORCE_READ_ONLY', '0'],
    ] as const) {
      process.env[name] = value
      const response = await request()
      expect(response.status).toBe(409)
      await expect(response.json()).resolves.toMatchObject({ code: 'read_only_guard_not_satisfied' })
      process.env.GOOGLE_READS_ENABLED = '1'
      process.env.GOOGLE_MUTATIONS_ENABLED = '0'
      process.env.FORCE_READ_ONLY = '1'
    }
    expect(mocks.run).not.toHaveBeenCalled()
  })

  it('returns timestamped, uncached evidence without account identifiers', async () => {
    const response = await request()
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toContain('no-store')
    expect(body).toMatchObject({ verified: true, mode: 'read_only', release: 'release-sha' })
    expect(body.checkedAt).toEqual(expect.any(String))
    expect(JSON.stringify(body)).not.toContain('2222222222')
  })

  it('returns only safe provider diagnostics when the drill fails', async () => {
    mocks.run.mockRejectedValueOnce(new GoogleAdsReadDrillError('google_ads_request_failed', 'shopping', 'request-failed'))
    const response = await request()
    expect(response.status).toBe(502)
    await expect(response.json()).resolves.toEqual({
      verified: false,
      code: 'google_ads_request_failed',
      stage: 'shopping',
      requestId: 'request-failed',
    })

    mocks.run.mockRejectedValueOnce(new Error('sensitive local details'))
    expect(await (await request()).json()).toEqual({
      verified: false,
      code: 'read_drill_failed',
      stage: 'unknown',
      requestId: null,
    })
  })
})
