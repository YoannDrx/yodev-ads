import { describe, expect, it } from 'vitest'
import { dashboardHealth, dashboardScoreCampaigns } from './dashboard-health'
import type { CampaignPerformance } from './google-ads'
import type { AnalyticalSnapshot } from './analytical-model'

const campaign = { status: 'ENABLED', impressions: '10', costMicros: '0', conversions: 0 } as CampaignPerformance
const alerts = { clientId: 'a', openCount: 0, criticalCount: 0 }
const now = new Date('2026-09-07T10:00:00Z'), client = { timezone: 'Europe/Paris', currencyCode: 'EUR' }
const coverage = { version: 1, queries: [{ queryHash: 'a'.repeat(64), rows: 1, pages: 1, bytes: 100, limit: 500, state: 'query_complete' }] }
const snapshot: AnalyticalSnapshot = { family: 'campaigns', contractVersion: 1, periodFrom: '2026-08-08', periodThrough: '2026-09-06', ...client, sourceVersion: 'v1', observedAt: now, collectedAt: now, payload: [campaign], coverage }

describe('client cockpit health', () => {
  it('never scores failed collection or a confirmed empty result, but preserves independent alert counts', () => {
    for (const campaigns of [null, []]) expect(dashboardHealth({ clientId: 'a', campaigns, alerts: { ...alerts, openCount: 521, criticalCount: 301 } })).toEqual({ score: null, openCount: 521 })
  })
  it('scores all aggregated critical incidents rather than a list preview', () => {
    expect(dashboardHealth({ clientId: 'a', campaigns: [campaign], alerts: { ...alerts, openCount: 521, criticalCount: 2 } })).toEqual({ score: 84, openCount: 521 })
    expect(dashboardHealth({ clientId: 'a', campaigns: [campaign], alerts: { ...alerts, openCount: 521, criticalCount: 301 } }).score).toBe(0)
  })
  it('rejects missing, foreign-client and malformed summaries', () => {
    for (const summary of [undefined, { ...alerts, clientId: 'b' }, { ...alerts, openCount: -1 }, { ...alerts, criticalCount: 1 }, { ...alerts, openCount: NaN }, { ...alerts, criticalCount: 0.5 }]) {
      expect(dashboardHealth({ clientId: 'a', campaigns: [campaign], alerts: summary })).toEqual({ score: null, openCount: null })
    }
    expect(dashboardHealth({ clientId: undefined, campaigns: [campaign], alerts }).score).toBeNull()
  })
  it('scores genuinely zero activity and expensive campaigns without conversions', () => {
    expect(dashboardHealth({ clientId: 'a', campaigns: [{ ...campaign, impressions: '0' }, { ...campaign, costMicros: '200000000' }], alerts }).score).toBe(68)
    expect(dashboardHealth({ clientId: 'a', campaigns: [{ ...campaign, costMicros: '100000001' }], alerts }).score).toBe(88)
  })
  it('rejects malformed campaign metrics instead of awarding a healthy score', () => {
    for (const value of [{ impressions: 'NaN' }, { costMicros: '-1' }, { conversions: NaN }, { conversions: -1 }]) expect(dashboardHealth({ clientId: 'a', campaigns: [{ ...campaign, ...value }], alerts }).score).toBeNull()
  })
  it('requires fresh, correctly scoped campaign data with complete query transport', () => {
    expect(dashboardScoreCampaigns([snapshot], client, now)).toEqual([campaign])
    expect(dashboardScoreCampaigns([], client, now)).toBeNull()
    for (const changes of [
      { coverage: null }, { coverage: { version: 1, queries: [] } },
      { coverage: { version: 1, queries: [{ ...coverage.queries[0], rows: 500, state: 'limit_reached' }] } },
      { observedAt: new Date(now.getTime() - 27 * 60 * 60_000) },
      { periodFrom: '2026-08-07', periodThrough: '2026-09-05' },
      { currencyCode: 'USD' }, { timezone: 'UTC' }, { contractVersion: 2 }, { payload: {} },
    ]) expect(dashboardScoreCampaigns([{ ...snapshot, ...changes }], client, now)).toBeNull()
  })
})
