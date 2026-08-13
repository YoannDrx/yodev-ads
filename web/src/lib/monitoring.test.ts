import { describe, expect, it } from 'vitest'
import {
  analyzeAdsForMonitoring,
  analyzeCampaigns,
  analyzeKeywordsForMonitoring,
  analyzePacingForMonitoring,
  analyzeSearchTermsForMonitoring,
  analyzeTrackingForMonitoring,
  agentTemplatesForLocale,
} from '@/lib/monitoring'

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
  conversionValueMicros: '0',
  searchBudgetLostImpressionShare: 0.2,
  searchRankLostImpressionShare: 0.1,
}

describe('monitoring engine', () => {
  it('exposes the same monitor contracts in French and English', () => {
    expect(agentTemplatesForLocale('fr').find((template) => template.kind === 'no_delivery')?.name).toBe('Sentinelle de diffusion')
    expect(agentTemplatesForLocale('en').find((template) => template.kind === 'no_delivery')).toMatchObject({ name: 'Delivery sentinel', threshold: 0 })
  })
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

  it('ignores historical spend from paused campaigns', () => {
    expect(
      analyzeCampaigns({ id: 'agent-1', kind: 'spend_without_conversion', threshold: '50' }, [
        { ...campaign, status: 'PAUSED' },
      ]),
    ).toEqual([])
  })

  it('monitors costly search terms that are not already excluded', () => {
    const findings = analyzeSearchTermsForMonitoring(
      { id: 'agent-2', kind: 'wasted_search_terms', threshold: '20' },
      [
        {
          searchTerm: 'gratuit',
          targetingStatus: 'NONE',
          campaignId: '42',
          campaignName: 'Search',
          adGroupId: '8',
          adGroupName: 'Courrier',
          impressions: '100',
          clicks: '15',
          costMicros: '65000000',
          conversions: 0,
        },
      ],
    )
    expect(findings[0]).toMatchObject({ severity: 'critical', value: 65 })
  })

  it('monitors enabled low-quality keywords with traffic', () => {
    const findings = analyzeKeywordsForMonitoring(
      { id: 'agent-3', kind: 'low_quality_keywords', threshold: '5' },
      [
        {
          criterionId: '99',
          text: 'courrier recommandé',
          matchType: 'PHRASE',
          status: 'ENABLED',
          qualityScore: 4,
          expectedCtr: 'AVERAGE',
          adRelevance: 'BELOW_AVERAGE',
          landingPageExperience: 'AVERAGE',
          campaignId: '42',
          campaignName: 'Search',
          adGroupId: '8',
          adGroupName: 'Courrier',
          impressions: '100',
          clicks: '15',
          costMicros: '25000000',
          conversions: 1,
        },
      ],
    )
    expect(findings[0]).toMatchObject({ title: 'Quality Score faible (4/10)', severity: 'warning' })
  })

  it('monitors incomplete responsive ads and inactive tracking', () => {
    const adFindings = analyzeAdsForMonitoring(
      { id: 'agent-4', kind: 'weak_responsive_ads', threshold: '8' },
      [
        {
          id: '7',
          status: 'ENABLED',
          adStrength: 'GOOD',
          approvalStatus: 'APPROVED',
          campaignId: '42',
          campaignName: 'Search',
          adGroupId: '8',
          adGroupName: 'Courrier',
          headlines: ['Un titre'],
          descriptions: ['Une description'],
          impressions: '100',
          clicks: '15',
          costMicros: '25000000',
          conversions: 1,
        },
      ],
    )
    const trackingFindings = analyzeTrackingForMonitoring(
      { id: 'agent-5', kind: 'tracking_gap', threshold: '50' },
      [campaign],
      {
        status: 'NOT_CONVERSION_TRACKED',
        managerCustomer: null,
        acceptedCustomerDataTerms: false,
        enhancedConversionsForLeadsEnabled: false,
      },
    )
    expect(adFindings).toHaveLength(1)
    expect(trackingFindings[0]).toMatchObject({ title: 'Suivi des conversions inactif', severity: 'critical' })
  })

  it('creates pacing and forecast findings only with a configured goal and enough daily evidence', () => {
    const context = {
      goal: { monthlyBudgetMicros: 310_000_000 },
      pacing: { status: 'over' as const, variancePercent: 0.25, forecastMicros: 400_000_000 },
      observedDays: 10,
      year: 2026,
      month: 8,
    }
    expect(analyzePacingForMonitoring({ id: 'pace', kind: 'pacing_variance', threshold: '10' }, context)[0]).toMatchObject({
      fingerprint: 'pace:pacing:2026-08', severity: 'critical', title: 'Sur-pacing mensuel', value: 25,
    })
    expect(analyzePacingForMonitoring({ id: 'forecast', kind: 'forecast_overrun', threshold: '10' }, context)[0]).toMatchObject({
      fingerprint: 'forecast:forecast:2026-08', severity: 'critical', title: 'Forecast supérieur au budget mensuel',
    })
    expect(analyzePacingForMonitoring({ id: 'pace', kind: 'pacing_variance', threshold: '10' }, { ...context, observedDays: 2 })).toEqual([])
    expect(analyzePacingForMonitoring({ id: 'pace', kind: 'pacing_variance', threshold: '10' }, { ...context, goal: null })).toEqual([])
  })

  it('covers pacing directions, warning thresholds and unavailable forecasts', () => {
    const baseContext = { goal: { monthlyBudgetMicros: 100 }, pacing: { status: 'under' as const, variancePercent: -0.15, forecastMicros: 80 }, observedDays: 3, year: 2026, month: 2 }
    expect(analyzePacingForMonitoring({ id: 'pace', kind: 'pacing_variance', threshold: '10' }, baseContext)[0]).toMatchObject({ title: 'Sous-pacing mensuel', severity: 'warning' })
    expect(analyzePacingForMonitoring({ id: 'pace', kind: 'pacing_variance', threshold: '20' }, baseContext)).toEqual([])
    expect(analyzePacingForMonitoring({ id: 'pace', kind: 'pacing_variance', threshold: '1' }, { ...baseContext, pacing: { ...baseContext.pacing, status: 'on_track' } })).toEqual([])
    expect(analyzePacingForMonitoring({ id: 'forecast', kind: 'forecast_overrun', threshold: '10' }, baseContext)).toEqual([])
    expect(analyzePacingForMonitoring({ id: 'forecast', kind: 'forecast_overrun', threshold: '10' }, { ...baseContext, pacing: { ...baseContext.pacing, forecastMicros: null } })).toEqual([])
    expect(analyzePacingForMonitoring({ id: 'unknown', kind: 'unknown', threshold: '10' }, baseContext)).toEqual([])
  })

  it('filters search terms and keywords on every safety condition', () => {
    const term = { searchTerm: 'gratuit', targetingStatus: 'NONE', campaignId: '1', campaignName: 'Search', adGroupId: '2', adGroupName: 'Core', impressions: '10', clicks: '2', costMicros: '20000000', conversions: 0 }
    const agent = { id: 'search', kind: 'wasted_search_terms', threshold: '20' }
    expect(analyzeSearchTermsForMonitoring(agent, [term])[0]).toMatchObject({ severity: 'warning' })
    expect(analyzeSearchTermsForMonitoring(agent, [{ ...term, conversions: 1 }, { ...term, costMicros: '19000000' }, { ...term, targetingStatus: 'ADDED_EXCLUDED' }])).toEqual([])

    const keyword = { criterionId: '1', text: 'keyword', matchType: 'BROAD', status: 'ENABLED', qualityScore: 3, expectedCtr: 'AVERAGE', adRelevance: 'AVERAGE', landingPageExperience: 'AVERAGE', campaignId: '1', campaignName: 'Search', adGroupId: '2', adGroupName: 'Core', impressions: '1', clicks: '1', costMicros: '1', conversions: 0 }
    const keywordAgent = { id: 'keyword', kind: 'low_quality_keywords', threshold: '5' }
    expect(analyzeKeywordsForMonitoring(keywordAgent, [keyword])[0]).toMatchObject({ severity: 'critical' })
    expect(analyzeKeywordsForMonitoring(keywordAgent, [
      { ...keyword, status: 'PAUSED' }, { ...keyword, qualityScore: null }, { ...keyword, qualityScore: 6 }, { ...keyword, impressions: '0' },
    ])).toEqual([])
  })

  it('distinguishes ad policy failures, creative weakness and healthy ads', () => {
    const ad = { id: '1', status: 'ENABLED', adStrength: 'GOOD', approvalStatus: 'APPROVED', campaignId: '1', campaignName: 'Search', adGroupId: '2', adGroupName: 'Core', headlines: Array(8).fill('h'), descriptions: Array(3).fill('d'), impressions: '1', clicks: '1', costMicros: '1', conversions: 0 }
    const agent = { id: 'ads', kind: 'weak_responsive_ads', threshold: '8' }
    expect(analyzeAdsForMonitoring(agent, [{ ...ad, status: 'PAUSED' }, ad])).toEqual([])
    expect(analyzeAdsForMonitoring(agent, [{ ...ad, approvalStatus: 'DISAPPROVED' }])[0]).toMatchObject({ title: 'Annonce refusée', severity: 'critical' })
    expect(analyzeAdsForMonitoring(agent, [{ ...ad, adStrength: 'POOR' }])[0]).toMatchObject({ severity: 'critical' })
    expect(analyzeAdsForMonitoring(agent, [{ ...ad, adStrength: 'AVERAGE' }])[0]).toMatchObject({ severity: 'warning' })
  })

  it('distinguishes active tracking outcomes and every campaign monitor kind', () => {
    const active = { status: 'CONVERSION_TRACKING_MANAGED_BY_THIS_GOOGLE_ADS_ACCOUNT', managerCustomer: null, acceptedCustomerDataTerms: true, enhancedConversionsForLeadsEnabled: true }
    const agent = { id: 'tracking', kind: 'tracking_gap', threshold: '50' }
    expect(analyzeTrackingForMonitoring(agent, [{ ...campaign, costMicros: '10000000' }], active)).toEqual([])
    expect(analyzeTrackingForMonitoring(agent, [{ ...campaign, conversions: 1 }], active)).toEqual([])
    expect(analyzeTrackingForMonitoring(agent, [campaign], active)[0]).toMatchObject({ title: 'Dépense sans conversion mesurée' })

    expect(analyzeCampaigns({ id: 'delivery', kind: 'no_delivery', threshold: '0' }, [{ ...campaign, impressions: '0' }])[0]).toMatchObject({ severity: 'critical' })
    expect(analyzeCampaigns({ id: 'cpa', kind: 'high_cpa', threshold: '50' }, [{ ...campaign, conversions: 1 }])[0]).toMatchObject({ title: 'CPA au-dessus du plafond', severity: 'critical' })
    expect(analyzeCampaigns({ id: 'budget', kind: 'budget_pressure', threshold: '30' }, [campaign])[0]).toMatchObject({ title: 'Pression budgétaire élevée' })
    expect(analyzeCampaigns({ id: 'budget', kind: 'budget_pressure', threshold: '1' }, [{ ...campaign, budgetMicros: '0' }])).toEqual([])
    expect(analyzeCampaigns({ id: 'unknown', kind: 'unknown', threshold: '1' }, [campaign])).toEqual([])
  })
})
