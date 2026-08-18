import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  health: vi.fn(),
}))

vi.mock('@/lib/system-health', () => ({ systemHealthSnapshot: mocks.health }))

import { GET } from './route'

const previousEnvironment = { ...process.env }

function request(token?: string) {
  return GET(new Request('https://ads.example.test/api/internal/release-readiness', {
    headers: token ? { authorization: `Bearer ${token}` } : undefined,
  }))
}

beforeEach(() => {
  process.env.RELEASE_TARGET = 'staging'
  process.env.RELEASE_VERIFICATION_TOKEN = 'release-token-that-is-at-least-32-characters'
  mocks.health.mockReset()
  mocks.health.mockResolvedValue({
    status: 'ok',
    database: 'connected',
    scheduler: { status: 'completed', overdue: false },
    retention: { status: 'completed', overdue: false },
  })
})

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in previousEnvironment)) delete process.env[key]
  }
  Object.assign(process.env, previousEnvironment)
})

describe('runtime release readiness route', () => {
  it('rejects missing and incorrect bearer tokens without disclosing readiness', async () => {
    for (const token of [undefined, 'wrong-token']) {
      const response = await request(token)
      expect(response.status).toBe(401)
      expect(response.headers.get('cache-control')).toContain('no-store')
      await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
    }
  })

  it('audits the environment in the deployed runtime without returning secret values', async () => {
    const response = await request(process.env.RELEASE_VERIFICATION_TOKEN)
    const body = await response.json()
    expect(response.status).toBe(503)
    expect(body).toMatchObject({ ready: false, target: 'staging' })
    expect(body.issues).toContainEqual({
      code: 'missing.DATABASE_AUTHENTICATED_URL',
      message: 'DATABASE_AUTHENTICATED_URL is required',
    })
    expect(JSON.stringify(body)).not.toContain(process.env.RELEASE_VERIFICATION_TOKEN)
  })

  it('fails closed when the deployed release target is absent', async () => {
    delete process.env.RELEASE_TARGET
    const response = await request(process.env.RELEASE_VERIFICATION_TOKEN)
    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({
      ready: false,
      target: 'unknown',
      issues: [{ code: 'invalid.RELEASE_TARGET' }],
    })
  })

  it('fails closed when scheduler or retention evidence is not operational', async () => {
    mocks.health.mockResolvedValue({
      status: 'degraded',
      database: 'connected',
      scheduler: { status: 'missing', overdue: true },
      retention: { status: 'failed', overdue: true },
    })
    const response = await request(process.env.RELEASE_VERIFICATION_TOKEN)
    const body = await response.json()
    expect(response.status).toBe(503)
    expect(body.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'health.scheduler_unhealthy' }),
      expect.objectContaining({ code: 'health.retention_unhealthy' }),
    ]))
  })

  it('does not disclose infrastructure errors when health evidence is unreachable', async () => {
    mocks.health.mockRejectedValue(new Error('sensitive database diagnostic'))
    const response = await request(process.env.RELEASE_VERIFICATION_TOKEN)
    const body = await response.json()
    expect(response.status).toBe(503)
    expect(body.issues).toContainEqual({
      code: 'health.database_unavailable',
      message: 'Database and operational health evidence must be reachable',
    })
    expect(JSON.stringify(body)).not.toContain('sensitive database diagnostic')
  })
})
