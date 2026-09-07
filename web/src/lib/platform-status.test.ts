import { describe, expect, it } from 'vitest'
import { platformStatusSummary } from '@/lib/platform-status'

describe('platformStatusSummary', () => {
  it('does not claim operational service without a verified observation', () => {
    expect(platformStatusSummary([])).toMatchObject({ overall: 'unknown', activeIncidentCount: 0 })
  })

  it('counts aggregated incidents without limiting their impact to a preview', () => {
    expect(platformStatusSummary([{ component: 'email', impact: 'major_outage', status: 'investigating', count: 521 }])).toMatchObject({ overall: 'major_outage', activeIncidentCount: 521 })
  })

  it('selects the worst active impact per component and globally', () => {
    const result = platformStatusSummary([
      { component: 'google_ads', impact: 'degraded', status: 'monitoring' },
      { component: 'google_ads', impact: 'partial_outage', status: 'identified' },
      { component: 'stripe', impact: 'major_outage', status: 'resolved' },
    ])
    expect(result.overall).toBe('partial_outage')
    expect(result.components.google_ads).toBe('partial_outage')
    expect(result.components.stripe).toBe('unknown')
  })
})
