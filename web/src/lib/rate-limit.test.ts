import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { databaseDouble } from '../../test/fluent-db'

const mocks = vi.hoisted(() => ({
  databases: [] as unknown[],
  transaction: vi.fn(async (callback: (db: unknown) => unknown) => callback(mocks.databases.shift())),
}))

vi.mock('@/db/transactions', () => ({ withSystemTransaction: mocks.transaction }))

import { consumePublicReportRateLimits, consumeRateLimit, fixedWindow, requestIp } from './rate-limit'

describe('rate limiting primitives', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.databases = []
    process.env.RATE_LIMIT_HASH_KEY = 'test-rate-limit-key'
  })

  afterEach(() => delete process.env.RATE_LIMIT_HASH_KEY)

  it('uses the first trusted proxy address', () => {
    expect(requestIp(new Headers({ 'x-forwarded-for': '198.51.100.2, 10.0.0.1' }))).toBe('198.51.100.2')
    expect(requestIp(new Headers({ 'x-real-ip': '198.51.100.3' }))).toBe('198.51.100.3')
    expect(requestIp(new Headers())).toBe('unknown')
  })

  it('computes stable fixed windows and retry time', () => {
    const result = fixedWindow({ now: new Date('2026-08-12T10:15:30.000Z'), windowMs: 60 * 60_000 })
    expect(result.windowStart.toISOString()).toBe('2026-08-12T10:00:00.000Z')
    expect(result.retryAfterSeconds).toBe(2670)
    expect(() => fixedWindow({ now: new Date(), windowMs: 0 })).toThrow('positive')
    expect(() => fixedWindow({ now: new Date(), windowMs: 1.5 })).toThrow('positive')
  })

  it('atomically consumes a pseudonymized bucket and reports exhaustion', async () => {
    const database = databaseDouble({ statementResults: [[{ count: 3 }]] })
    mocks.databases.push(database.db)
    await expect(consumeRateLimit({
      workspaceId: 'workspace-1', namespace: 'api', identity: 'secret-token', limit: 2,
      windowMs: 60_000, now: new Date('2026-08-12T10:15:30.000Z'),
    })).resolves.toEqual({ allowed: false, count: 3, limit: 2, retryAfterSeconds: 30 })
    expect(database.capture.values[0]).toMatchObject({ workspaceId: 'workspace-1', count: 1 })
    expect(database.capture.values[0]).not.toEqual(expect.objectContaining({ keyHash: expect.stringContaining('secret-token') }))
  })

  it('combines IP and bearer-token limits for HTML and PDF reports', async () => {
    mocks.databases.push(
      databaseDouble({ statementResults: [[{ count: 60 }]] }).db,
      databaseDouble({ statementResults: [[{ count: 301 }]] }).db,
    )
    await expect(consumePublicReportRateLimits({
      workspaceId: 'workspace-1', token: 'report-token', ip: '198.51.100.1',
    })).resolves.toMatchObject({ allowed: false })

    mocks.databases.push(
      databaseDouble({ statementResults: [[{ count: 20 }]] }).db,
      databaseDouble({ statementResults: [[{ count: 300 }]] }).db,
    )
    await expect(consumePublicReportRateLimits({
      workspaceId: 'workspace-1', token: 'report-token', ip: '198.51.100.1', pdf: true,
    })).resolves.toMatchObject({ allowed: true })
  })

  it('does not let an exhausted IP consume the shared bearer-token quota', async () => {
    mocks.databases.push(databaseDouble({ statementResults: [[{ count: 61 }]] }).db)
    await expect(consumePublicReportRateLimits({
      workspaceId: 'workspace-1', token: 'shared-report-token', ip: '198.51.100.9',
    })).resolves.toMatchObject({ allowed: false })
    expect(mocks.transaction).toHaveBeenCalledOnce()
  })

  it('fails closed when no pseudonymization key is configured', async () => {
    delete process.env.RATE_LIMIT_HASH_KEY
    delete process.env.APP_ENCRYPTION_KEY
    await expect(consumeRateLimit({ namespace: 'api', identity: 'id', limit: 1, windowMs: 1_000 }))
      .rejects.toThrow('RATE_LIMIT_HASH_KEY')
  })
})
