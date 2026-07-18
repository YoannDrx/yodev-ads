import { describe, expect, it } from 'vitest'
import {
  analyzeAdsForMonitoring,
  analyzeCampaigns,
  analyzeKeywordsForMonitoring,
  analyzeSearchTermsForMonitoring,
  analyzeTrackingForMonitoring,
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
})
