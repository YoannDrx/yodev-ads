import { describe, expect, it } from 'vitest'
import { platformStatusSummary } from '@/lib/platform-status'

describe('platformStatusSummary', () => {
  it('keeps every component operational without an active incident', () => {
    expect(platformStatusSummary([])).toMatchObject({ overall: 'operational', activeIncidentCount: 0 })
  })

  it('selects the worst active impact per component and globally', () => {
    const result = platformStatusSummary([
      { component: 'google_ads', impact: 'degraded', status: 'monitoring' },
      { component: 'google_ads', impact: 'partial_outage', status: 'identified' },
      { component: 'stripe', impact: 'major_outage', status: 'resolved' },
    ])
    expect(result.overall).toBe('partial_outage')
    expect(result.components.google_ads).toBe('partial_outage')
    expect(result.components.stripe).toBe('operational')
  })
})
