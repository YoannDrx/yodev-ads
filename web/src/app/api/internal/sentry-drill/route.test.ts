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

function request(providedToken = token, identity = false) {
  return POST(new Request('https://ads.example.test/api/internal/sentry-drill', {
    method: 'POST',
    headers: { authorization: `Bearer ${providedToken}`, ...(identity ? { 'x-expected-release-sha': 'b'.repeat(40), 'x-expected-release-target': process.env.RELEASE_TARGET! } : {}) },
  }))
}

beforeEach(() => {
  process.env.RELEASE_TARGET = 'staging'
  process.env.VERCEL_GIT_COMMIT_SHA = 'b'.repeat(40)
  process.env.SENTRY_SYNTHETIC_VERIFICATION_ENABLED = '0'
  process.env.RELEASE_VERIFICATION_TOKEN = token
  process.env.SENTRY_DSN = 'https://public@example.invalid/1'
  process.env.SENTRY_EVENT_READ_AUTH_TOKEN = 'sentry-read-token'
  process.env.SENTRY_API_BASE_URL = 'https://de.sentry.io'
  process.env.SENTRY_ORG = 'yodev'
  process.env.SENTRY_PROJECT = 'ads-by-yodev'
  mocks.flush.mockReset().mockResolvedValue(true)
  mocks.captureException.mockClear()
  mocks.scope.setTag.mockClear()
  mocks.scope.setUser.mockClear()
  mocks.scope.setContext.mockClear()
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({
    eventID: 'a'.repeat(32), projectID: '1', release: { version: 'b'.repeat(40) }, dateCreated: new Date().toISOString(),
    tags: [{ key: 'environment', value: 'staging' }, { key: 'ads_by_yodev_drill', value: 'ads-by-yodev-sentry-drill-fixture' }],
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
    expect((await request(token, true)).status).toBe(409)
    expect(mocks.captureException).not.toHaveBeenCalled()
  })

  it('requires explicit opt-in and candidate identity to produce commercial telemetry evidence', async () => {
    process.env.RELEASE_TARGET = 'public'
    process.env.SENTRY_SYNTHETIC_VERIFICATION_ENABLED = '1'
    expect((await request()).status).toBe(412)
    expect(mocks.captureException).not.toHaveBeenCalled()
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({
      eventID: 'a'.repeat(32), projectID: '1', release: 'b'.repeat(40), dateCreated: new Date().toISOString(),
      tags: [{ key: 'environment', value: 'public' }, { key: 'ads_by_yodev_drill', value: 'ads-by-yodev-sentry-drill-fixture' }],
      title: '[REDACTED_API_KEY]',
    }))
    expect((await request(token, true)).status).toBe(200)
  })

  it('rejects an indexed event from a different release', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({
      eventID: 'a'.repeat(32), projectID: '1', release: 'c'.repeat(40), dateCreated: new Date().toISOString(),
      tags: [{ key: 'environment', value: 'staging' }, { key: 'ads_by_yodev_drill', value: 'ads-by-yodev-sentry-drill-fixture' }],
      title: '[REDACTED_API_KEY]',
    }))
    expect(await (await request()).json()).toMatchObject({ code: 'event_verification_failed' })
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
    expect(fetch).toHaveBeenCalledWith(
      new URL(`https://de.sentry.io/api/0/projects/yodev/ads-by-yodev/events/${'a'.repeat(32)}/`),
      expect.any(Object),
    )
    expect(response.headers.get('cache-control')).toContain('no-store')
  })

  it('fails closed when delivery, indexing or redaction cannot be proved', async () => {
    mocks.flush.mockResolvedValueOnce(false)
    expect((await request()).status).toBe(502)

    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 500 }))
    expect(await (await request()).json()).toMatchObject({ code: 'indexing_failed' })

    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ environment: 'staging', title: 'ya_live_syntheticredactionmarker' }))
    expect(await (await request()).json()).toMatchObject({ code: 'event_verification_failed' })

    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ environment: 'production', title: '[REDACTED_API_KEY]' }))
    expect(await (await request()).json()).toMatchObject({ code: 'event_verification_failed' })
  })
})
