import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  captureException: vi.fn(() => 'a'.repeat(32)),
  flush: vi.fn(),
  scope: { setTag: vi.fn(), setUser: vi.fn(), setContext: vi.fn() },
}))

vi.mock('@sentry/nextjs', () => ({
  captureException: mocks.captureException,
  flush: mocks.flush,
  withScope: (callback: (scope: typeof mocks.scope) => unknown) => callback(mocks.scope),
}))

import { POST } from './route'

const previousEnvironment = { ...process.env }
const token = 'release-token-that-is-at-least-32-characters'

function request(providedToken = token) {
  return POST(new Request('https://ads.example.test/api/internal/sentry-drill', {
    method: 'POST',
    headers: { authorization: `Bearer ${providedToken}` },
  }))
}

beforeEach(() => {
  process.env.RELEASE_TARGET = 'staging'
  process.env.RELEASE_VERIFICATION_TOKEN = token
  process.env.SENTRY_DSN = 'https://public@example.invalid/1'
  process.env.SENTRY_EVENT_READ_AUTH_TOKEN = 'sentry-read-token'
  process.env.SENTRY_ORG = 'yodev'
  process.env.SENTRY_PROJECT = 'ads-by-yodev'
  mocks.flush.mockReset().mockResolvedValue(true)
  mocks.captureException.mockClear()
  mocks.scope.setTag.mockClear()
  mocks.scope.setUser.mockClear()
  mocks.scope.setContext.mockClear()
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({
    title: 'ads-by-yodev-sentry-drill: [REDACTED_API_KEY]',
  })))
})

afterEach(() => {
  vi.unstubAllGlobals()
  for (const key of Object.keys(process.env)) {
    if (!(key in previousEnvironment)) delete process.env[key]
  }
  Object.assign(process.env, previousEnvironment)
})

describe('deployed Sentry drill route', () => {
  it('rejects unauthorized requests and refuses non-staging targets', async () => {
    expect((await request('wrong-token')).status).toBe(401)
    process.env.RELEASE_TARGET = 'public'
    expect((await request()).status).toBe(409)
    expect(mocks.captureException).not.toHaveBeenCalled()
  })

  it('captures, indexes and proves redaction of synthetic data', async () => {
    const response = await request()
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      verified: true,
      environment: 'staging',
      eventId: 'a'.repeat(32),
    })
    expect(mocks.scope.setUser).toHaveBeenCalledWith({ email: 'sentry-drill-person@example.invalid' })
    expect(response.headers.get('cache-control')).toContain('no-store')
  })

  it('fails closed when delivery, indexing or redaction cannot be proved', async () => {
    mocks.flush.mockResolvedValueOnce(false)
    expect((await request()).status).toBe(502)

    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 500 }))
    expect(await (await request()).json()).toMatchObject({ code: 'indexing_failed' })

    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ title: 'ya_live_syntheticredactionmarker' }))
    expect(await (await request()).json()).toMatchObject({ code: 'redaction_failed' })
  })
})
