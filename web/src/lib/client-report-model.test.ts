import { describe, expect, it } from 'vitest'
import { buildClientReportModel, clientReportCsv } from '@/lib/client-report-model'
import type { CampaignPerformance } from '@/lib/google-ads'

const campaign: CampaignPerformance = {
  id: '1', name: 'Brand, France', status: 'ENABLED', channelType: 'SEARCH', budgetResourceName: 'budget/1', budgetMicros: '1',
  impressions: '100', clicks: '10', costMicros: '20000000', conversions: 2, conversionValueMicros: '60000000',
  searchBudgetLostImpressionShare: null, searchRankLostImpressionShare: null,
}

describe('client report model', () => {
  it('derives shared KPIs once for HTML, PDF and CSV consumers', () => {
    const model = buildClientReportModel({ brandName: 'Studio', clientName: 'Acme', currencyCode: 'EUR', campaigns: [campaign], editorialComment: '  Bon mois. ', actionPlan: 'Tester le RSA.' })
    expect(model.totals).toMatchObject({ costMicros: '20000000', impressions: '100', clicks: '10', conversions: 2, conversionValueMicros: '60000000', ctr: 0.1, cpaMicros: 10_000_000, roas: 3 })
    expect(model.editorialComment).toBe('Bon mois.')
  })

  it('preserves exact account totals independently from the campaign list and pins the exported period', () => {
    const model = buildClientReportModel({ brandName: 'Studio', clientName: 'Acme', currencyCode: 'EUR', campaigns: [campaign],
      window: { from: '2026-08-01', through: '2026-08-12', timezone: 'Europe/Paris' }, sourceVersion: 'source-fixture',
      accountTotals: { costMicros: '9007199254740993', impressions: '1000', clicks: '300', conversions: 3, conversionValueMicros: '-100' },
    })
    expect(model.periodDays).toBe(12)
    expect(model.totals.costMicros).toBe('9007199254740993')
    const csv = clientReportCsv(model)
    expect(csv).toContain('"account_cost_micros","9007199254740993"')
    expect(csv).toContain('"account_conversion_value_micros","-100"')
    expect(csv).toContain('"period_from","2026-08-01"')
    expect(csv).toContain('"timezone","Europe/Paris"')
    expect(csv).toContain('"source_version","source-fixture"')
  })

  it('emits UTF-8 spreadsheet-safe CSV and rejects unsupported periods', () => {
    const model = buildClientReportModel({ brandName: 'Studio', clientName: 'Acme', currencyCode: 'EUR', campaigns: [campaign] })
    const csv = clientReportCsv(model)
    expect(csv.startsWith('\uFEFF')).toBe(true)
    expect(csv).toContain('"Brand, France"')
    expect(() => buildClientReportModel({ brandName: 'Studio', clientName: 'Acme', currencyCode: 'EUR', campaigns: [], periodDays: 45 })).toThrow('pas prise en charge')
  })
})
