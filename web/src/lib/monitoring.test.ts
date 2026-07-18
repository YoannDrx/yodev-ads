import { describe, expect, it } from 'vitest'
import { analyzeCampaigns } from '@/lib/monitoring'

const campaign = {
  id: '42',
  name: 'Search marque',
  status: 'ENABLED',
  channelType: 'SEARCH',
  budgetResourceName: 'budget/1',
  budgetMicros: '10000000',
  impressions: '2000',
  clicks: '50',
  costMicros: '120000000',
  conversions: 0,
}

describe('monitoring engine', () => {
  it('detects spend without conversions above threshold', () => {
    const findings = analyzeCampaigns({ id: 'agent-1', kind: 'spend_without_conversion', threshold: '100' }, [campaign])
    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({ fingerprint: 'agent-1:42', severity: 'warning', value: 120 })
  })

  it('stays quiet below threshold', () => {
    expect(analyzeCampaigns({ id: 'agent-1', kind: 'spend_without_conversion', threshold: '150' }, [campaign])).toEqual(
      [],
    )
  })
})
