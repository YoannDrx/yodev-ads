import { describe, expect, it } from 'vitest'
import { aggregateCampaignPerformance } from '@/lib/performance-history'

describe('performance history aggregation', () => {
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
})
