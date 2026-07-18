import { describe, expect, it } from 'vitest'
import { analyzeAccount, analyzeAds, analyzeKeywords, analyzeSearchTerms } from '@/lib/analysis'

describe('Google Ads analysis engine', () => {
  it('prioritizes costly search terms without conversions', () => {
    const findings = analyzeSearchTerms([
      {
        searchTerm: 'certificat médical gratuit',
        targetingStatus: 'NONE',
        campaignId: '1',
        campaignName: 'Search',
        adGroupId: '2',
        adGroupName: 'Certificat',
        impressions: '80',
        clicks: '12',
        costMicros: '75000000',
        conversions: 0,
      },
    ])
    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({ category: 'search_terms', priority: 'high', value: 75 })
  })

  it('ignores a term already excluded or converting', () => {
    const base = {
      searchTerm: 'courrier certifié',
      campaignId: '1',
      campaignName: 'Search',
      adGroupId: '2',
      adGroupName: 'Courrier',
      impressions: '80',
      clicks: '12',
      costMicros: '75000000',
      conversions: 0,
    }
    expect(analyzeSearchTerms([{ ...base, targetingStatus: 'ADDED_EXCLUDED' }])).toEqual([])
    expect(analyzeSearchTerms([{ ...base, targetingStatus: 'NONE', conversions: 2 }])).toEqual([])
  })

  it('explains the weak components of a low quality keyword', () => {
    const findings = analyzeKeywords([
      {
        criterionId: '3',
        text: 'lettre recommandée en ligne',
        matchType: 'PHRASE',
        status: 'ENABLED',
        qualityScore: 3,
        expectedCtr: 'BELOW_AVERAGE',
        adRelevance: 'AVERAGE',
        landingPageExperience: 'BELOW_AVERAGE',
        campaignId: '1',
        campaignName: 'Search',
        adGroupId: '2',
        adGroupName: 'Courrier',
        impressions: '200',
        clicks: '15',
        costMicros: '30000000',
        conversions: 1,
      },
    ])
    expect(findings[0].description).toContain('CTR attendu')
    expect(findings[0].description).toContain('expérience de page')
  })

  it('flags disapproved responsive search ads before weak creative strength', () => {
    const findings = analyzeAds([
      {
        id: '4',
        status: 'ENABLED',
        adStrength: 'AVERAGE',
        approvalStatus: 'DISAPPROVED',
        campaignId: '1',
        campaignName: 'Search',
        adGroupId: '2',
        adGroupName: 'Courrier',
        headlines: ['Titre 1'],
        descriptions: ['Description 1'],
        impressions: '0',
        clicks: '0',
        costMicros: '0',
        conversions: 0,
      },
    ])
    expect(findings[0]).toMatchObject({ title: 'Annonce refusée par Google', priority: 'high' })
  })

  it('calculates an explainable health score and tracking warning', () => {
    const result = analyzeAccount({
      campaigns: [
        {
          id: '1',
          name: 'Search',
          status: 'ENABLED',
          channelType: 'SEARCH',
          budgetResourceName: 'budgets/1',
          budgetMicros: '20000000',
          impressions: '1000',
          clicks: '40',
          costMicros: '100000000',
          conversions: 0,
        },
      ],
      searchTerms: [],
      keywords: [],
      ads: [],
      conversionTracking: {
        status: 'CONVERSION_TRACKING_MANAGED_BY_THIS_CLIENT',
        managerCustomer: null,
        acceptedCustomerDataTerms: true,
        enhancedConversionsForLeadsEnabled: false,
      },
    })
    expect(result.score).toBe(90)
    expect(result.findings[0].id).toBe('tracking:no-conversions')
  })
})
