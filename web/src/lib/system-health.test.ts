import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  latest: vi.fn(),
  transaction: vi.fn(async (operation: (db: { execute: () => Promise<void> }) => unknown) => operation({ execute: vi.fn() })),
}))

vi.mock('@/lib/operational-runs', () => ({ latestOperationalRuns: mocks.latest }))
vi.mock('@/db/transactions', () => ({ withSystemTransaction: mocks.transaction }))

import { systemHealthSnapshot } from './system-health'

describe('system health', () => {
  const now = new Date('2026-08-17T12:00:00.000Z')

  beforeEach(() => {
    vi.clearAllMocks()
    process.env.SCHEDULER_ENABLED = '1'
    delete process.env.MAINTENANCE_MODE
    delete process.env.RELEASE_TARGET
    delete process.env.VERCEL_ENV
  })

  afterEach(() => {
    delete process.env.SCHEDULER_ENABLED
    delete process.env.MAINTENANCE_MODE
    delete process.env.RELEASE_TARGET
    delete process.env.VERCEL_ENV
  })

  it('is healthy only when scheduler and retention both have recent successful evidence', async () => {
    mocks.latest.mockResolvedValue({
      scheduler: {
        status: 'completed', startedAt: new Date('2026-08-17T11:55:00.000Z'),
        nextExpectedAt: new Date('2026-08-17T12:00:00.000Z'),
      },
      retention: {
        status: 'completed', startedAt: new Date('2026-08-17T01:00:00.000Z'),
        nextExpectedAt: new Date('2026-08-18T01:00:00.000Z'),
      },
    })
    await expect(systemHealthSnapshot(now)).resolves.toMatchObject({
      status: 'ok', scheduler: { overdue: false }, retention: { overdue: false },
    })
  })

  it('degrades after two missed scheduler passages or more than 48 hours without retention', async () => {
    mocks.latest.mockResolvedValue({
      scheduler: {
        status: 'completed', startedAt: new Date('2026-08-17T11:40:00.000Z'),
        nextExpectedAt: new Date('2026-08-17T11:45:00.000Z'),
      },
      retention: {
        status: 'completed', startedAt: new Date('2026-08-15T10:00:00.000Z'),
        nextExpectedAt: new Date('2026-08-16T10:00:00.000Z'),
      },
    })
    await expect(systemHealthSnapshot(now)).resolves.toMatchObject({
      status: 'degraded', scheduler: { overdue: true }, retention: { overdue: true },
    })
  })

  it('reports operational checks as disabled when the scheduler is intentionally disabled', async () => {
    process.env.SCHEDULER_ENABLED = '0'
    mocks.latest.mockResolvedValue({})
    await expect(systemHealthSnapshot(now)).resolves.toMatchObject({
      status: 'ok', scheduler: { status: 'disabled' }, retention: { status: 'disabled' },
    })
  })

  it.each([
    ['staging', undefined],
    ['private_beta', undefined],
    ['public', undefined],
    [undefined, 'production'],
  ])('degrades when workers are disabled for release target %s / Vercel %s', async (target, vercelEnvironment) => {
    process.env.SCHEDULER_ENABLED = '0'
    if (target) process.env.RELEASE_TARGET = target
    if (vercelEnvironment) process.env.VERCEL_ENV = vercelEnvironment
    mocks.latest.mockResolvedValue({})
    await expect(systemHealthSnapshot(now)).resolves.toMatchObject({
      status: 'degraded',
      scheduler: { status: 'disabled', overdue: true },
      retention: { status: 'disabled', overdue: true },
    })
  })

  it('reports maintenance explicitly even if the last operational runs were successful', async () => {
    process.env.MAINTENANCE_MODE = '1'
    mocks.latest.mockResolvedValue({
      scheduler: { status: 'completed', nextExpectedAt: new Date('2026-08-17T12:05:00.000Z') },
      retention: { status: 'completed', nextExpectedAt: new Date('2026-08-18T01:00:00.000Z') },
    })
    await expect(systemHealthSnapshot(now)).resolves.toMatchObject({ status: 'maintenance' })
  })
})
