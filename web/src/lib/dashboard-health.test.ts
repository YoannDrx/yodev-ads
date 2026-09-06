import { describe, expect, it } from 'vitest'
import { dashboardHealth } from './dashboard-health'
import type { CampaignPerformance } from './google-ads'

const campaign = { status: 'ENABLED', impressions: '10', costMicros: '0', conversions: 0 } as CampaignPerformance

describe('client cockpit health', () => {
  it('never scores failed collection or a confirmed empty result', () => {
    for (const campaigns of [null, []]) expect(dashboardHealth({ clientId: 'a', campaigns, incidents: [] }).score).toBeNull()
  })
  it('scopes open and reopened incidents to the selected client', () => {
    const incidents = ['open', 'reopened', 'acknowledged', 'snoozed', 'resolved'].map((status) => ({ clientId: 'a', status, severity: 'critical' }))
    incidents.push({ clientId: 'b', status: 'open', severity: 'critical' })
    expect(dashboardHealth({ clientId: 'a', campaigns: [campaign], incidents })).toMatchObject({ score: 84, openIncidents: incidents.slice(0, 2) })
  })
  it('scores genuinely zero activity and expensive campaigns without conversions', () => {
    expect(dashboardHealth({ clientId: 'a', campaigns: [{ ...campaign, impressions: '0' }, { ...campaign, costMicros: '200000000' }], incidents: [] }).score).toBe(68)
  })
})
