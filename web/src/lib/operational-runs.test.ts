import { beforeEach, describe, expect, it, vi } from 'vitest'
import { databaseDouble } from '../../test/fluent-db'

const mocks = vi.hoisted(() => ({
  databases: [] as unknown[],
  transaction: vi.fn(async (callback: (db: unknown) => unknown) => callback(mocks.databases.shift())),
}))

vi.mock('@/db/transactions', () => ({ withSystemTransaction: mocks.transaction }))

import {
  acquireOperationalLease,
  completeOperationalRun,
  failOperationalRun,
  latestOperationalRuns,
  releaseOperationalLease,
  startOperationalRun,
} from './operational-runs'

describe('operational run registry', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.databases = []
  })

  it('records a run, its work counters and next expected passage', async () => {
    const startedAt = new Date('2026-08-17T10:00:00.000Z')
    const completedAt = new Date('2026-08-17T10:00:02.500Z')
    const nextExpectedAt = new Date('2026-08-17T10:05:00.000Z')
    const start = databaseDouble({ statementResults: [[{ id: 'run-1' }]] })
    const complete = databaseDouble()
    mocks.databases.push(start.db, complete.db)

    await startOperationalRun({ component: 'scheduler', runKey: 'request-1', startedAt, nextExpectedAt })
    await completeOperationalRun({
      component: 'scheduler', runKey: 'request-1', startedAt, completedAt, nextExpectedAt,
      workCount: 7, details: { deadLetters: 0 },
    })
    expect(start.capture.values[0]).toMatchObject({ component: 'scheduler', status: 'running', nextExpectedAt })
    expect(complete.capture.sets[0]).toMatchObject({
      status: 'completed', durationMs: 2500, workCount: 7, details: { deadLetters: 0 }, nextExpectedAt,
    })
  })

  it('normalizes a failed run and fetches the latest row for every component independently', async () => {
    const startedAt = new Date('2026-08-17T10:00:00.000Z')
    const failed = databaseDouble()
    const findFirst = vi.fn()
      .mockResolvedValueOnce({ id: 'scheduler-new', component: 'scheduler' })
      .mockResolvedValueOnce({ id: 'retention-new', component: 'retention' })
      .mockResolvedValueOnce(undefined)
    const latest = databaseDouble({ query: { operationalRuns: { findFirst } } })
    mocks.databases.push(failed.db, latest.db)

    await failOperationalRun({ component: 'scheduler', runKey: 'request-1', startedAt, error: new Error('boom') })
    await expect(latestOperationalRuns()).resolves.toEqual({
      scheduler: { id: 'scheduler-new', component: 'scheduler' },
      retention: { id: 'retention-new', component: 'retention' },
    })
    expect(findFirst).toHaveBeenCalledTimes(3)
    expect(failed.capture.sets[0]).toMatchObject({ status: 'failed', errorMessage: 'boom' })
  })

  it('acquires and releases a bounded scheduler lease', async () => {
    const now = new Date('2026-08-17T10:00:00.000Z')
    const acquired = databaseDouble({ statementResults: [[{
      owner: 'scheduler:request-1', leaseExpiresAt: new Date('2026-08-17T10:01:15.000Z'),
    }]] })
    const released = databaseDouble()
    mocks.databases.push(acquired.db, released.db)

    await expect(acquireOperationalLease({
      component: 'scheduler', owner: 'scheduler:request-1', now, leaseMs: 75_000,
    })).resolves.toMatchObject({ owner: 'scheduler:request-1' })
    await releaseOperationalLease({ component: 'scheduler', owner: 'scheduler:request-1', now })
    expect(acquired.capture.values[0]).toMatchObject({
      component: 'scheduler', owner: 'scheduler:request-1', leaseExpiresAt: new Date('2026-08-17T10:01:15.000Z'),
    })
    expect(released.capture.sets[0]).toMatchObject({ leaseExpiresAt: now, updatedAt: now })
  })

  it.each([
    ['', 75_000, 'Invalid operational lease owner'],
    ['x'.repeat(161), 75_000, 'Invalid operational lease owner'],
    ['owner', 4_999, 'Invalid operational lease duration'],
    ['owner', 900_001, 'Invalid operational lease duration'],
    ['owner', 7_500.5, 'Invalid operational lease duration'],
  ])('rejects invalid lease input owner=%s lease=%s', async (owner, leaseMs, message) => {
    expect(() => acquireOperationalLease({ component: 'scheduler', owner, leaseMs })).toThrow(message)
  })

  it('returns null when another owner still holds the lease', async () => {
    const database = databaseDouble({ statementResults: [[{ owner: 'scheduler:other', leaseExpiresAt: new Date() }]] })
    mocks.databases.push(database.db)
    await expect(acquireOperationalLease({ component: 'scheduler', owner: 'scheduler:request-1' })).resolves.toBeNull()
  })

  it('normalizes negative counters, defaults and non-Error failures', async () => {
    const start = databaseDouble({ statementResults: [[{ id: 'run-1' }]] })
    const complete = databaseDouble()
    const failed = databaseDouble()
    mocks.databases.push(start.db, complete.db, failed.db)
    await startOperationalRun({ component: 'retention', runKey: 'retention-1' })
    const startedAt = new Date(Date.now() + 1_000)
    await completeOperationalRun({ component: 'retention', runKey: 'retention-1', startedAt, workCount: -3 })
    await failOperationalRun({ component: 'retention', runKey: 'retention-2', startedAt, error: 'offline' })
    expect(complete.capture.sets[0]).toMatchObject({ durationMs: 0, workCount: 0, details: {}, nextExpectedAt: null })
    expect(failed.capture.sets[0]).toMatchObject({ durationMs: 0, errorMessage: 'offline', nextExpectedAt: null })
  })
})
