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
    expect(model.totals).toMatchObject({ costMicros: 20_000_000, impressions: 100, clicks: 10, conversions: 2, conversionValueMicros: 60_000_000, ctr: 0.1, cpaMicros: 10_000_000, roas: 3 })
    expect(model.editorialComment).toBe('Bon mois.')
  })

  it('emits UTF-8 spreadsheet-safe CSV and rejects unsupported periods', () => {
    const model = buildClientReportModel({ brandName: 'Studio', clientName: 'Acme', currencyCode: 'EUR', campaigns: [campaign] })
    const csv = clientReportCsv(model)
    expect(csv.startsWith('\uFEFF')).toBe(true)
    expect(csv).toContain('"Brand, France"')
    expect(() => buildClientReportModel({ brandName: 'Studio', clientName: 'Acme', currencyCode: 'EUR', campaigns: [], periodDays: 90 })).toThrow('pas prise en charge')
  })
})
