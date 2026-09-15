import { describe, expect, it } from 'vitest'
import { normalizeMetricSyncData } from './metric-sync-data'

const account = { date: '2026-08-31', costMicros: '12345678901234567', impressions: '10', clicks: '2', conversions: 1.5, conversionValue: 12.5 }
const campaign = { ...account, campaignId: '42', campaignName: 'Removed campaign', campaignType: 'SEARCH', status: 'REMOVED' }
const input = { window: { from: '2026-08-31', through: '2026-09-02' }, today: '2026-09-02', complete: true, accounts: [account], campaigns: [campaign] }
describe('qualified daily metric datasets', () => {
  it('distinguishes covered zeros from a partial current day and preserves exact integer amounts', () => {
    const result = normalizeMetricSyncData(input)
    expect(result.accounts[0]).toMatchObject({ costMicros: account.costMicros, coverageStatus: 'complete', accountRows: 1, campaignRows: 1 })
    expect(result.accounts[1]).toMatchObject({ date: '2026-09-01', costMicros: '0', coverageStatus: 'complete', accountRows: 0, campaignRows: 0 })
    expect(result.accounts[2]).toMatchObject({ date: input.today, coverageStatus: 'partial' })
    expect(result.campaigns[0].status).toBe('REMOVED')
  })
  it('refuses incomplete, duplicate or out-of-period rows before history can be replaced', () => {
    expect(() => normalizeMetricSyncData({ ...input, complete: false })).toThrow('Incomplete')
    expect(() => normalizeMetricSyncData({ ...input, accounts: [account, account] })).toThrow('duplicate')
    expect(() => normalizeMetricSyncData({ ...input, campaigns: [campaign, campaign] })).toThrow('Duplicate')
    expect(() => normalizeMetricSyncData({ ...input, accounts: [{ ...account, date: '2026-08-30' }] })).toThrow('Unexpected')
    expect(() => normalizeMetricSyncData({ ...input, campaigns: [{ ...campaign, campaignId: 'not-an-id' }] })).toThrow('identity')
    expect(() => normalizeMetricSyncData({ ...input, today: '2026-09-01' })).toThrow('Future')
  })
  it('rejects malformed amounts and unsafe conversion-value rounding', () => {
    for (const metric of [{ ...account, costMicros: '1.5' }, { ...account, clicks: '1'.repeat(23) }, { ...account, conversions: NaN }, { ...account, conversionValue: Number.MAX_SAFE_INTEGER }]) {
      expect(() => normalizeMetricSyncData({ ...input, accounts: [metric] })).toThrow('metric')
    }
  })
})
