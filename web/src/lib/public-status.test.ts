import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  database: undefined as unknown,
  transaction: vi.fn(async (callback: (db: unknown) => unknown) => callback(mocks.database)),
}))

vi.mock('@/db/transactions', () => ({ withSystemTransaction: mocks.transaction }))

import { getPublicPlatformStatus } from './public-status'

function databaseWith(incidents: unknown[], updates: unknown[]) {
  return { query: {
    platformIncidents: { findMany: vi.fn(async () => incidents) },
    platformIncidentUpdates: { findMany: vi.fn(async () => updates) },
  } }
}

describe('public platform status', () => {
  beforeEach(() => vi.clearAllMocks())

  it('filters stale resolved incidents and groups public updates', async () => {
    const now = new Date('2026-08-12T12:00:00Z')
    const active = { id: 'active', component: 'google_ads', impact: 'degraded', status: 'monitoring', startedAt: new Date('2026-08-10') }
    const recent = { id: 'recent', component: 'email', impact: 'partial_outage', status: 'resolved', startedAt: new Date('2026-08-01') }
    const stale = { id: 'stale', component: 'database', impact: 'major_outage', status: 'resolved', startedAt: new Date('2025-01-01') }
    const update = { id: 'update-1', incidentId: active.id }
    mocks.database = databaseWith([active, recent, stale], [update])
    await expect(getPublicPlatformStatus(now)).resolves.toEqual({
      summary: expect.objectContaining({ overall: 'degraded', activeIncidentCount: 1 }),
      incidents: [{ incident: active, updates: [update] }, { incident: recent, updates: [] }],
      checkedAt: now,
    })
    expect((mocks.database as ReturnType<typeof databaseWith>).query.platformIncidentUpdates.findMany).toHaveBeenCalledOnce()
  })

  it('does not query updates when there is no visible incident', async () => {
    const database = databaseWith([], [])
    mocks.database = database
    const result = await getPublicPlatformStatus(new Date('2026-08-12T12:00:00Z'))
    expect(result.incidents).toEqual([])
    expect(result.summary.overall).toBe('operational')
    expect(database.query.platformIncidentUpdates.findMany).not.toHaveBeenCalled()
  })
})
