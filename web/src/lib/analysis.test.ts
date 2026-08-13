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

  it('ignores a term already targeted and proposes a converting query as a positive keyword', () => {
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
    expect(analyzeSearchTerms([{ ...base, targetingStatus: 'NONE', conversions: 2 }])).toEqual([
      expect.objectContaining({ suggestedWorkflow: 'keyword_create_positive', value: 2 }),
    ])
    expect(analyzeSearchTerms([{ ...base, targetingStatus: 'ADDED' }, { ...base, targetingStatus: 'EXCLUDED' }])).toEqual([])
    expect(analyzeSearchTerms([{ ...base, targetingStatus: 'NONE', conversions: 3 }])[0]).toMatchObject({ priority: 'high' })
    expect(analyzeSearchTerms([{ ...base, targetingStatus: 'NONE', costMicros: '19000000' }])).toEqual([])
    expect(analyzeSearchTerms([{ ...base, targetingStatus: 'NONE', costMicros: '20000000' }])[0]).toMatchObject({ priority: 'medium' })
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

  it('filters ineligible keywords and distinguishes medium weakness without invented signals', () => {
    const keyword = {
      criterionId: '3', text: 'mot clé', matchType: 'PHRASE', status: 'ENABLED', qualityScore: 5,
      expectedCtr: 'AVERAGE', adRelevance: 'AVERAGE', landingPageExperience: 'AVERAGE',
      campaignId: '1', campaignName: 'Search', adGroupId: '2', adGroupName: 'Core',
      impressions: '10', clicks: '1', costMicros: '1', conversions: 0,
    }
    expect(analyzeKeywords([keyword])[0]).toMatchObject({ priority: 'medium' })
    expect(analyzeKeywords([keyword])[0].description).not.toContain('sur :')
    expect(analyzeKeywords([{ ...keyword, adRelevance: 'BELOW_AVERAGE' }])[0].description).toContain('pertinence')
    expect(analyzeKeywords([
      { ...keyword, status: 'PAUSED' }, { ...keyword, qualityScore: null }, { ...keyword, qualityScore: 6 }, { ...keyword, impressions: '0' },
    ])).toEqual([])
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

  it('ignores paused and healthy ads while classifying weak creative strength', () => {
    const ad = {
      id: '4', status: 'ENABLED', adStrength: 'GOOD', approvalStatus: 'APPROVED', campaignId: '1', campaignName: 'Search',
      adGroupId: '2', adGroupName: 'Core', headlines: Array(8).fill('h'), descriptions: Array(3).fill('d'),
      impressions: '1', clicks: '1', costMicros: '1', conversions: 0,
    }
    expect(analyzeAds([{ ...ad, status: 'PAUSED' }, ad])).toEqual([])
    expect(analyzeAds([{ ...ad, adStrength: 'AVERAGE' }])[0]).toMatchObject({ priority: 'medium', value: 0 })
    expect(analyzeAds([{ ...ad, adStrength: 'POOR', headlines: [] }])[0]).toMatchObject({ priority: 'high', value: 8 })
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
          conversionValueMicros: '0',
          searchBudgetLostImpressionShare: 0.2,
          searchRankLostImpressionShare: 0.1,
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

  it('prioritizes inactive tracking and only suggests enhanced conversions when conversions exist', () => {
    const campaign = {
      id: '1', name: 'Search', status: 'ENABLED', channelType: 'SEARCH', budgetResourceName: 'budget/1', budgetMicros: '1',
      impressions: '1', clicks: '1', costMicros: '10000000', conversions: 2, conversionValueMicros: '2',
      searchBudgetLostImpressionShare: null, searchRankLostImpressionShare: null,
    }
    const inactive = analyzeAccount({ campaigns: [campaign], searchTerms: [], keywords: [], ads: [], conversionTracking: {
      status: 'NOT_CONVERSION_TRACKED', managerCustomer: null, acceptedCustomerDataTerms: false, enhancedConversionsForLeadsEnabled: false,
    } })
    expect(inactive.findings.map((finding) => finding.id)).toEqual(['tracking:inactive', 'tracking:enhanced-conversions'])
    expect(inactive.score).toBe(72)

    const healthy = analyzeAccount({ campaigns: [{ ...campaign, conversions: 0 }], searchTerms: [], keywords: [], ads: [], conversionTracking: {
      status: 'CONVERSION_TRACKING_MANAGED_BY_THIS_CLIENT', managerCustomer: null, acceptedCustomerDataTerms: true, enhancedConversionsForLeadsEnabled: true,
    } })
    expect(healthy.findings).toEqual([])
    expect(healthy.score).toBe(100)
  })

  it('localizes generated findings in English without changing their semantics', () => {
    const term = {
      searchTerm: 'certified letter', targetingStatus: 'NONE', campaignId: '1', campaignName: 'Search', adGroupId: '2',
      adGroupName: 'Letters', impressions: '80', clicks: '12', costMicros: '75000000', conversions: 0,
    }
    expect(analyzeSearchTerms([term], 20, 'en')[0]).toMatchObject({
      title: 'Expensive search term without conversions', suggestedWorkflow: 'keyword_create_negative',
    })
    expect(analyzeSearchTerms([{ ...term, conversions: 2 }], 20, 'en')[0].title).toBe('Converting search term to isolate')

    const keyword = {
      criterionId: '3', text: 'certified letter', matchType: 'PHRASE', status: 'ENABLED', qualityScore: 3,
      expectedCtr: 'BELOW_AVERAGE', adRelevance: 'BELOW_AVERAGE', landingPageExperience: 'BELOW_AVERAGE',
      campaignId: '1', campaignName: 'Search', adGroupId: '2', adGroupName: 'Letters', impressions: '200', clicks: '15',
      costMicros: '30000000', conversions: 1,
    }
    expect(analyzeKeywords([keyword], 5, 'en')[0].description).toContain('landing-page experience')

    const ad = {
      id: '4', status: 'ENABLED', adStrength: 'AVERAGE', approvalStatus: 'DISAPPROVED', campaignId: '1', campaignName: 'Search',
      adGroupId: '2', adGroupName: 'Letters', headlines: ['Title'], descriptions: ['Description'], impressions: '0', clicks: '0',
      costMicros: '0', conversions: 0,
    }
    expect(analyzeAds([ad], 'en')[0].title).toBe('Ad disapproved by Google')

    const result = analyzeAccount({ campaigns: [], searchTerms: [], keywords: [], ads: [], conversionTracking: {
      status: 'NOT_CONVERSION_TRACKED', managerCustomer: null, acceptedCustomerDataTerms: false, enhancedConversionsForLeadsEnabled: false,
    } }, 'en')
    expect(result.findings[0]).toMatchObject({ title: 'Conversion tracking inactive', entityLabel: 'Google Ads account' })
  })
})
