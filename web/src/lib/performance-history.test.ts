import { beforeEach, describe, expect, it, vi } from 'vitest'
import { databaseDouble } from '../../test/fluent-db'

const mocks = vi.hoisted(() => ({
  systemDatabase: undefined as unknown,
  tenantDatabase: undefined as unknown,
  system: vi.fn(async (callback: (db: unknown) => unknown) => callback(mocks.systemDatabase)),
  tenant: vi.fn(async (_context: unknown, callback: (db: unknown) => unknown) => callback(mocks.tenantDatabase)),
}))
vi.mock('@/db/transactions', () => ({ withSystemTransaction: mocks.system, withTenantTransaction: mocks.tenant }))

import { aggregateCampaignPerformance, listPerformanceHistory, storePerformanceSnapshot } from '@/lib/performance-history'

describe('performance history aggregation', () => {
  beforeEach(() => vi.clearAllMocks())

  it('aggregates Google Ads metrics without losing fractional conversions', () => {
    const totals = aggregateCampaignPerformance([
      {
        id: '1',
        name: 'Search',
        status: 'ENABLED',
        channelType: 'SEARCH',
        budgetResourceName: 'budgets/1',
        budgetMicros: '10000000',
        impressions: '1200',
        clicks: '50',
        costMicros: '45000000',
        conversions: 2.5,
        conversionValueMicros: '90000000',
        searchBudgetLostImpressionShare: 0.2,
        searchRankLostImpressionShare: 0.1,
      },
      {
        id: '2',
        name: 'Brand',
        status: 'PAUSED',
        channelType: 'SEARCH',
        budgetResourceName: 'budgets/2',
        budgetMicros: '5000000',
        impressions: '300',
        clicks: '20',
        costMicros: '10000000',
        conversions: 1,
        conversionValueMicros: '20000000',
        searchBudgetLostImpressionShare: null,
        searchRankLostImpressionShare: null,
      },
    ])
    expect(totals).toEqual({
      costMicros: 55_000_000,
      impressions: 1500,
      clicks: 70,
      conversions: 3.5,
      activeCampaigns: 1,
    })
  })

  it('upserts a dated snapshot with normalized aggregate values', async () => {
    const database = databaseDouble()
    mocks.systemDatabase = database.db
    await storePerformanceSnapshot({
      workspaceId: 'workspace-1', clientId: 'client-1', currencyCode: 'EUR',
      date: new Date('2026-08-12T23:00:00Z'), campaigns: [{
        id: '1', name: 'Search', status: 'ENABLED', channelType: 'SEARCH', budgetResourceName: 'budget/1', budgetMicros: '1',
        impressions: '10.4', clicks: '2.6', costMicros: '1000000.4', conversions: 1.5, conversionValueMicros: '2',
        searchBudgetLostImpressionShare: null, searchRankLostImpressionShare: null,
      }],
    })
    expect(database.capture.values[0]).toEqual(expect.objectContaining({
      snapshotDate: '2026-08-12', costMicros: '1000000', impressions: '10', clicks: '3', conversions: '1.5', activeCampaigns: 1,
    }))
  })

  it('lists only tenant-scoped history through the repository transaction', async () => {
    const rows = [{ snapshotDate: '2026-08-12' }]
    const findMany = vi.fn(async () => rows)
    mocks.tenantDatabase = { query: { performanceSnapshots: { findMany } } }
    await expect(listPerformanceHistory('workspace-1', 'client-1', 30)).resolves.toEqual(rows)
    expect(mocks.tenant).toHaveBeenCalledWith(
      { workspaceId: 'workspace-1', userId: 'repository:performance-history' }, expect.any(Function),
    )
    expect(findMany).toHaveBeenCalledOnce()
  })
})
