import { beforeEach, describe, expect, it, vi } from 'vitest'

const getAccessTokenMock = vi.hoisted(() => vi.fn())

vi.mock('google-auth-library', () => ({
  OAuth2Client: class {
    setCredentials() {}
    getAccessToken() { return getAccessTokenMock() }
    generateAuthUrl() { return 'https://accounts.google.test/oauth' }
  },
}))
vi.mock('@/lib/crypto', () => ({ decryptSecret: () => 'refresh-token' }))
vi.mock('@/lib/env', () => ({
  getServerEnv: () => ({
    APP_ENCRYPTION_KEY: 'x'.repeat(43),
    GOOGLE_ADS_DEVELOPER_TOKEN: 'developer-token',
    GOOGLE_OAUTH_CLIENT_ID: 'client-id',
    GOOGLE_OAUTH_CLIENT_SECRET: 'client-secret',
    GOOGLE_ADS_API_VERSION: 'v25',
  }),
}))

import { accountNegativeKeywordApprovalState, GoogleAdsError, GoogleAdsGateway, revokeGoogleOAuthToken } from './google-ads'

function googleResponse(results: unknown[], requestId = 'google-request') {
  return new Response(JSON.stringify([{ results }]), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'request-id': requestId },
  })
}

describe('GoogleAdsGateway v25 contracts', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    getAccessTokenMock.mockReset().mockResolvedValue({ token: 'access-token' })
    process.env.GOOGLE_READS_ENABLED = '1'
  })

  it('fails closed before OAuth or HTTP when the Google read switch is off', async () => {
    process.env.GOOGLE_READS_ENABLED = '0'
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    const gateway = new GoogleAdsGateway({ encryptedRefreshToken: 'cipher', managerCustomerId: '9999999999' })
    await expect(gateway.verifyOAuthAccess()).rejects.toThrow('lectures Google Ads sont temporairement désactivées')
    expect(getAccessTokenMock).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('verifies OAuth refresh access without issuing a Google Ads request', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    const gateway = new GoogleAdsGateway({ encryptedRefreshToken: 'cipher', managerCustomerId: '9999999999' })
    await expect(gateway.verifyOAuthAccess()).resolves.toEqual({ valid: true })
    expect(getAccessTokenMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('classifies a revoked refresh token with a safe reconnect diagnostic', async () => {
    getAccessTokenMock.mockRejectedValue({ response: { data: { error: 'invalid_grant', error_description: 'provider detail must stay private' } } })
    const gateway = new GoogleAdsGateway({ encryptedRefreshToken: 'cipher', managerCustomerId: '9999999999' })
    const error = await gateway.verifyOAuthAccess().catch((failure) => failure)
    expect(error).toBeInstanceOf(GoogleAdsError)
    expect(error).toMatchObject({ status: 401, requestId: null, message: expect.stringContaining('Reconnectez') })
    expect(error.message).not.toContain('provider detail')
  })

  it('classifies unknown OAuth refresh failures as temporarily unavailable', async () => {
    getAccessTokenMock.mockRejectedValue(new Error('sensitive network detail'))
    const gateway = new GoogleAdsGateway({ encryptedRefreshToken: 'cipher', managerCustomerId: '9999999999' })
    const error = await gateway.verifyOAuthAccess().catch((failure) => failure)
    expect(error).toBeInstanceOf(GoogleAdsError)
    expect(error).toMatchObject({ status: 503, requestId: null, message: 'Le renouvellement Google OAuth a échoué (oauth_refresh_unavailable).' })
    expect(error.message).not.toContain('sensitive network detail')
  })

  it('revokes orphaned OAuth grants without putting the refresh token in the URL', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 200 }))
    await expect(revokeGoogleOAuthToken('refresh-token-to-revoke')).resolves.toMatchObject({ ok: true })
    expect(fetchMock).toHaveBeenCalledWith('https://oauth2.googleapis.com/revoke', expect.objectContaining({
      method: 'POST',
      body: expect.any(URLSearchParams),
      cache: 'no-store',
    }))
    expect(String(fetchMock.mock.calls[0][1]?.body)).toBe('token=refresh-token-to-revoke')
    expect(() => revokeGoogleOAuthToken('')).toThrow('refresh token')
  })

  it('merges full campaign inventory with metric rows and keeps zero-delivery campaigns', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(googleResponse([
        { campaign: { id: '2', name: 'Zero', status: 'ENABLED', advertisingChannelType: 'SEARCH', campaignBudget: 'customers/123/campaignBudgets/2' }, campaignBudget: { amountMicros: '5000000' } },
        { campaign: { id: '1', name: 'Spend', status: 'PAUSED', advertisingChannelType: 'SEARCH', campaignBudget: 'customers/123/campaignBudgets/1' }, campaignBudget: { amountMicros: '10000000' } },
      ]))
      .mockResolvedValueOnce(googleResponse([
        { campaign: { id: '1' }, metrics: { impressions: '100', clicks: '10', costMicros: '20000000', conversions: 2, conversionsValue: 55, searchBudgetLostImpressionShare: 0.25, searchRankLostImpressionShare: 0.1 } },
      ]))
    const gateway = new GoogleAdsGateway({ encryptedRefreshToken: 'cipher', managerCustomerId: '999-888-7777' })
    const campaigns = await gateway.campaignPerformance('123-456-7890')
    expect(campaigns.map(({ id, impressions }) => ({ id, impressions }))).toEqual([
      { id: '1', impressions: '100' },
      { id: '2', impressions: '0' },
    ])
    expect(campaigns[0]).toMatchObject({
      conversionValueMicros: '55000000',
      searchBudgetLostImpressionShare: 0.25,
      searchRankLostImpressionShare: 0.1,
    })
    expect(campaigns[1]).toMatchObject({
      conversionValueMicros: '0',
      searchBudgetLostImpressionShare: null,
      searchRankLostImpressionShare: null,
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(String(fetchMock.mock.calls[0][0])).toContain('/v25/customers/1234567890/googleAds:searchStream')
    expect(fetchMock.mock.calls[0][1]?.headers).toMatchObject({ 'developer-token': 'developer-token', 'login-customer-id': '9998887777' })
  })

  it('maps extended read-only reports with type-specific fields', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(googleResponse([{ segments: { device: 'MOBILE' }, metrics: { impressions: '10', clicks: '2', costMicros: '3000000', conversions: 1, conversionsValue: 8 } }]))
      .mockResolvedValueOnce(googleResponse([{ segments: { dayOfWeek: 'MONDAY', hour: 9 }, metrics: { impressions: '20' } }]))
      .mockResolvedValueOnce(googleResponse([{ geographicView: { countryCriterionId: '2250', locationType: 'LOCATION_OF_PRESENCE' }, campaign: { id: '1', name: 'France' }, metrics: { clicks: '5' } }]))
      .mockResolvedValueOnce(googleResponse([{ segments: { auctionInsightDomain: 'example.test' }, campaign: { id: '1', name: 'Search' }, metrics: { auctionInsightSearchImpressionShare: 0.4, auctionInsightSearchOverlapRate: 0.2 } }]))
      .mockResolvedValueOnce(googleResponse([{ campaign: { id: '2', name: 'PMax' }, performanceMaxPlacementView: { displayName: 'YouTube', placement: 'channel', placementType: 'YOUTUBE_CHANNEL', targetUrl: 'https://youtube.test/channel' }, metrics: { impressions: '100' } }]))
      .mockResolvedValueOnce(googleResponse([{ campaign: { id: '2', name: 'PMax' }, assetGroup: { id: '8', name: 'Core', status: 'ENABLED', adStrength: 'GOOD' }, metrics: { clicks: '12', conversionsValue: 42 } }]))
      .mockResolvedValueOnce(googleResponse([
        { campaign: { id: '2', name: 'PMax' }, assetGroup: { id: '8', name: 'Core' }, assetGroupAsset: { asset: 'customers/123/assets/9', fieldType: 'HEADLINE', status: 'ENABLED', primaryStatus: 'ELIGIBLE', performanceLabel: 'LOW' }, segments: { date: '2026-08-10' }, metrics: { impressions: '6000', clicks: '100', costMicros: '3000000', conversions: 2, conversionsValue: 20 } },
        { campaign: { id: '2', name: 'PMax' }, assetGroup: { id: '8', name: 'Core' }, assetGroupAsset: { asset: 'customers/123/assets/9', fieldType: 'HEADLINE', status: 'ENABLED', primaryStatus: 'ELIGIBLE', performanceLabel: 'LOW' }, segments: { date: '2026-07-25' }, metrics: { impressions: '6000', clicks: '300', costMicros: '4000000', conversions: 4, conversionsValue: 40 } },
      ]))
      .mockResolvedValueOnce(googleResponse([{ campaign: { id: '3', name: 'Shopping' }, segments: { productItemId: 'sku-1', productTitle: 'Produit', productBrand: 'Yodev', productMerchantId: '99', productCountry: 'FR', productChannel: 'ONLINE' }, metrics: { costMicros: '7000000', conversions: 2 } }]))
      .mockResolvedValueOnce(googleResponse([{ shoppingProduct: { resourceName: 'customers/123/shoppingProducts/99~ONLINE~fr~FR~sku-2', merchantCenterId: '99', channel: 'ONLINE', languageCode: 'fr', feedLabel: 'FR', itemId: 'sku-2', title: 'Produit refusé', status: 'NOT_ELIGIBLE', issues: [{ errorCode: 'landing_page_error', adsSeverity: 'ERROR', description: 'Landing page unavailable', documentation: 'https://support.google.test/product', affectedRegions: ['FR'] }] } }]))
      .mockResolvedValueOnce(googleResponse([{ campaign: { id: '4', name: 'Display' }, campaignCriterion: { criterionId: '55', bidModifier: 1.2 }, userList: { name: 'Visiteurs 30j' }, metrics: { impressions: '1000', costMicros: '5000000' } }]))
      .mockResolvedValueOnce(googleResponse([{ campaign: { id: '4', name: 'Display' }, adGroup: { id: '44', name: 'Remarketing' }, adGroupCriterion: { criterionId: '56', bidModifier: 1.1 }, userList: { name: 'Acheteurs 90j' }, metrics: { impressions: '800', costMicros: '3500000' } }]))
      .mockResolvedValueOnce(googleResponse([{ campaign: { id: '4', name: 'Display' }, adGroup: { id: '44', name: 'Remarketing' }, groupPlacementView: { displayName: 'Example', placement: 'example.test', placementType: 'WEBSITE', targetUrl: 'https://example.test/page' }, metrics: { impressions: '700', clicks: '8', costMicros: '3000000', viewThroughConversions: 2 } }]))
    const gateway = new GoogleAdsGateway({ encryptedRefreshToken: 'cipher', managerCustomerId: '9999999999' })

    await expect(gateway.devicePerformance('1234567890')).resolves.toMatchObject([{ key: 'MOBILE', conversionValueMicros: '8000000' }])
    await expect(gateway.schedulePerformance('1234567890')).resolves.toMatchObject([{ key: 'MONDAY-9', label: 'MONDAY · 09:00' }])
    await expect(gateway.geographicPerformance('1234567890')).resolves.toMatchObject([{ criterionId: '2250', locationType: 'LOCATION_OF_PRESENCE' }])
    await expect(gateway.auctionInsights('1234567890')).resolves.toMatchObject([{ domain: 'example.test', impressionShare: 0.4, overlapRate: 0.2 }])
    await expect(gateway.performanceMaxPlacements('1234567890')).resolves.toMatchObject([{ type: 'YOUTUBE_CHANNEL', impressions: '100' }])
    await expect(gateway.assetGroupPerformance('1234567890')).resolves.toMatchObject([{ assetGroupId: '8', adStrength: 'GOOD', conversionValueMicros: '42000000' }])
    await expect(gateway.assetPerformance('1234567890', '2026-08-12')).resolves.toMatchObject([{ assetResourceName: 'customers/123/assets/9', fatigue: { status: 'review', confidence: 'high' }, impressions: '12000' }])
    await expect(gateway.shoppingProductPerformance('1234567890')).resolves.toMatchObject([{ itemId: 'sku-1', brand: 'Yodev', conversions: 2 }])
    await expect(gateway.shoppingProductDiagnostics('1234567890')).resolves.toMatchObject([{ itemId: 'sku-2', status: 'NOT_ELIGIBLE', issues: [{ errorCode: 'landing_page_error', severity: 'ERROR', affectedRegions: ['FR'] }] }])
    await expect(gateway.campaignAudiencePerformance('1234567890')).resolves.toMatchObject([{ label: 'Visiteurs 30j', criterionId: '55', bidModifier: 1.2 }])
    await expect(gateway.adGroupAudiencePerformance('1234567890')).resolves.toMatchObject([{ label: 'Acheteurs 90j · Remarketing', criterionId: '56', bidModifier: 1.1 }])
    await expect(gateway.groupPlacementPerformance('1234567890')).resolves.toMatchObject([{ placementType: 'WEBSITE', viewThroughConversions: 2, targetUrl: 'https://example.test/page' }])

    const bodies = fetchMock.mock.calls.map((call) => String(call[1]?.body))
    expect(bodies).toHaveLength(12)
    expect(bodies.every((body) => !body.includes(':mutate'))).toBe(true)
  })

  it('uses conservative defaults for incomplete Google rows and drops rows without required identity', async () => {
    const responses = [
      // MCC, campaign inventory and campaign metrics.
      googleResponse([{}, { customerClient: { clientCustomer: 'customers/1' } }]),
      googleResponse([{}]),
      googleResponse([{}]),
      // Extended read-only reports.
      googleResponse([{}]),
      googleResponse([{}]),
      googleResponse([{}]),
      googleResponse([{}, { segments: { auctionInsightDomain: 'competitor.test' } }]),
      googleResponse([{}]),
      googleResponse([{}]),
      googleResponse([{}]),
      googleResponse([{}]),
      googleResponse([{}, { shoppingProduct: { resourceName: 'products/1', issues: [{ documentation: 'http://unsafe.test' }, { documentation: 'not-a-url' }] } }]),
      googleResponse([{}]),
      googleResponse([{}]),
      googleResponse([{}]),
      // Daily series and core analysis reports.
      googleResponse([{}, { segments: { date: '2026-08-01' } }]),
      googleResponse([{}, { campaign: { id: '1' }, segments: { date: '2026-08-01' } }]),
      googleResponse([{}]),
      googleResponse([{}]),
      googleResponse([{ adGroupAd: { ad: { responsiveSearchAd: { headlines: [{}, { text: 'Headline' }], descriptions: [{}] } } } }]),
      googleResponse([{}]),
      // Change, conversion and offline diagnostics.
      googleResponse([{},
        { changeEvent: { resourceName: 'changes/invalid', changeDateTime: 'invalid' } },
        { changeEvent: { resourceName: 'changes/1', changeDateTime: '2026-08-01 10:00:00', changedFields: ' campaign.status, , campaign.name ' } },
      ]),
      googleResponse([{}, { conversionAction: { resourceName: 'conversionActions/1' }, metrics: { conversionLastConversionDate: 'invalid', conversionLastReceivedRequestDateTime: '2026-08-01' } }]),
      googleResponse([{}, { offlineConversionUploadClientSummary: { client: 'GOOGLE_ADS_WEB_CLIENT', lastUploadDateTime: 'invalid' } }]),
    ]
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => responses.shift()!)
    const gateway = new GoogleAdsGateway({ encryptedRefreshToken: 'cipher', managerCustomerId: '9999999999' })
    const customerId = '1234567890'

    await expect(gateway.listManagedCustomers()).resolves.toEqual([{ customerId: '1', name: 'Compte 1', currencyCode: 'EUR', timezone: 'Europe/Paris', isManager: false }])
    await expect(gateway.campaignPerformance(customerId)).resolves.toMatchObject([{ id: '', name: 'Campagne sans nom', status: 'UNKNOWN', budgetMicros: '0' }])
    await expect(gateway.devicePerformance(customerId)).resolves.toMatchObject([{ key: 'UNKNOWN', label: 'Appareil inconnu', costMicros: '0' }])
    await expect(gateway.schedulePerformance(customerId)).resolves.toMatchObject([{ key: 'UNKNOWN-0', label: 'UNKNOWN · 00:00' }])
    await expect(gateway.geographicPerformance(customerId)).resolves.toMatchObject([{ criterionId: 'UNKNOWN', campaignName: 'Campagne sans nom' }])
    await expect(gateway.auctionInsights(customerId)).resolves.toEqual([expect.objectContaining({ domain: 'competitor.test', impressionShare: null })])
    await expect(gateway.performanceMaxPlacements(customerId)).resolves.toMatchObject([{ name: 'Placement indisponible', targetUrl: null }])
    await expect(gateway.assetGroupPerformance(customerId)).resolves.toMatchObject([{ label: 'Asset group sans nom', adStrength: 'UNKNOWN' }])
    await expect(gateway.assetPerformance(customerId, '2026-08-12')).resolves.toMatchObject([{ fieldType: 'UNKNOWN', impressions: '0' }])
    await expect(gateway.shoppingProductPerformance(customerId)).resolves.toMatchObject([{ title: 'Produit sans titre', brand: '—' }])
    await expect(gateway.shoppingProductDiagnostics(customerId)).resolves.toEqual([expect.objectContaining({
      title: 'Produit sans titre', status: 'UNKNOWN', issues: [expect.objectContaining({ documentation: null }), expect.objectContaining({ documentation: null })],
    })])
    await expect(gateway.campaignAudiencePerformance(customerId)).resolves.toMatchObject([{ label: 'Audience inconnue', bidModifier: null }])
    await expect(gateway.adGroupAudiencePerformance(customerId)).resolves.toMatchObject([{ label: 'Audience inconnue · Groupe sans nom' }])
    await expect(gateway.groupPlacementPerformance(customerId)).resolves.toMatchObject([{ label: 'Placement indisponible', targetUrl: null }])
    await expect(gateway.dailyAccountMetrics(customerId, '2026-08-01', '2026-08-01')).resolves.toEqual([expect.objectContaining({ date: '2026-08-01', impressions: '0' })])
    await expect(gateway.dailyCampaignMetrics(customerId, '2026-08-01', '2026-08-01')).resolves.toEqual([expect.objectContaining({ campaignId: '1', campaignName: 'Campagne sans nom' })])
    await expect(gateway.searchTermPerformance(customerId)).resolves.toMatchObject([{ searchTerm: 'Terme indisponible', conversions: 0 }])
    await expect(gateway.keywordPerformance(customerId)).resolves.toMatchObject([{ text: 'Mot-clé indisponible', qualityScore: null }])
    await expect(gateway.responsiveSearchAdPerformance(customerId)).resolves.toMatchObject([{ headlines: ['Headline'], descriptions: [], approvalStatus: 'UNSPECIFIED' }])
    await expect(gateway.conversionTrackingStatus(customerId)).resolves.toEqual({
      status: 'UNSPECIFIED', managerCustomer: null, acceptedCustomerDataTerms: false, enhancedConversionsForLeadsEnabled: false,
    })
    await expect(gateway.changeEvents(customerId, new Date('2026-08-01'), new Date('2026-08-02'))).resolves.toEqual([
      expect.objectContaining({ resourceName: 'changes/1', changedFields: ['campaign.status', 'campaign.name'], changedResourceName: null }),
    ])
    await expect(gateway.conversionActions(customerId)).resolves.toEqual([expect.objectContaining({
      resourceName: 'conversionActions/1', lastConversionAt: null, lastReceivedAt: expect.any(Date), lastActivityAt: expect.any(Date),
    })])
    await expect(gateway.offlineConversionDiagnostics(customerId)).resolves.toEqual([expect.objectContaining({
      uploadClient: 'GOOGLE_ADS_WEB_CLIENT', lastUploadAt: null, successRate: null, alerts: [],
    })])
    expect(fetchMock).toHaveBeenCalledTimes(24)
    expect(responses).toHaveLength(0)
  })

  it('maps accessible MCC customers and real mutation state', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(googleResponse([
        { customerClient: { clientCustomer: 'customers/1234567890', descriptiveName: 'Acme', currencyCode: 'USD', timeZone: 'America/New_York', manager: false } },
      ]))
      .mockResolvedValueOnce(googleResponse([
        { campaign: { id: '42', name: 'Brand', resourceName: 'customers/1234567890/campaigns/42', status: 'ENABLED', campaignBudget: 'customers/1234567890/campaignBudgets/7' }, campaignBudget: { resourceName: 'customers/1234567890/campaignBudgets/7', amountMicros: '9000000', explicitlyShared: true, referenceCount: '3' } },
      ]))
    const gateway = new GoogleAdsGateway({ encryptedRefreshToken: 'cipher', managerCustomerId: '9999999999' })
    await expect(gateway.listManagedCustomers()).resolves.toEqual([{ customerId: '1234567890', name: 'Acme', currencyCode: 'USD', timezone: 'America/New_York', isManager: false }])
    await expect(gateway.campaignMutationState('1234567890', '042')).resolves.toMatchObject({ campaignId: '42', budgetExplicitlyShared: true, budgetReferenceCount: '3' })
    expect(fetchMock.mock.calls[1][1]?.body).toContain('campaign.id = 42')
  })

  it('uses validateOnly and never retries mutations', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      new Response(JSON.stringify({ results: [] }), { status: 200, headers: { 'Content-Type': 'application/json', 'request-id': 'mutation-request' } }),
    )
    const gateway = new GoogleAdsGateway({ encryptedRefreshToken: 'cipher', managerCustomerId: '9999999999' })
    await expect(gateway.validateCampaignStatus('1234567890', '42', 'PAUSED')).resolves.toMatchObject({ requestId: 'mutation-request' })
    await expect(gateway.validateBudget('1234567890', 'customers/1234567890/campaignBudgets/7', '12000000')).resolves.toMatchObject({ requestId: 'mutation-request' })
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({ validateOnly: true, operations: [{ updateMask: 'status' }] })
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toMatchObject({ validateOnly: true, operations: [{ updateMask: 'amount_micros' }] })
    await expect(gateway.mutateBudget('1234567890', 'customers/4567890123/campaignBudgets/7', '1')).rejects.toThrow('ne correspond pas')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('uses GoogleAdsService mutate for an all-or-nothing budget batch', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ mutateOperationResponses: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'request-id': 'batch-validation' },
    }))
    const gateway = new GoogleAdsGateway({ encryptedRefreshToken: 'cipher', managerCustomerId: '9999999999' })
    await gateway.mutateBudgetBatch('1234567890', [
      { budgetResourceName: 'customers/1234567890/campaignBudgets/1', amountMicros: '9000000' },
      { budgetResourceName: 'customers/1234567890/campaignBudgets/2', amountMicros: '11000000' },
    ], true)
    expect(String(fetchMock.mock.calls[0][0])).toContain('/customers/1234567890/googleAds:mutate')
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
      mutateOperations: [
        { campaignBudgetOperation: { update: { resourceName: 'customers/1234567890/campaignBudgets/1', amountMicros: '9000000' }, updateMask: 'amount_micros' } },
        { campaignBudgetOperation: { update: { resourceName: 'customers/1234567890/campaignBudgets/2', amountMicros: '11000000' }, updateMask: 'amount_micros' } },
      ],
      partialFailure: false,
      validateOnly: true,
    })
    await expect(gateway.mutateBudgetBatch('1234567890', [
      { budgetResourceName: 'customers/1234567890/campaignBudgets/1', amountMicros: '1' },
    ])).rejects.toThrow('entre 2 et 50')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('maps heterogeneous reversible updates to one all-or-nothing GoogleAdsService request', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ mutateOperationResponses: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'request-id': 'atomic-batch' },
    }))
    const gateway = new GoogleAdsGateway({ encryptedRefreshToken: 'cipher', managerCustomerId: '9999999999' })
    await gateway.mutateAtomicBatch('1234567890', [
      { kind: 'campaign_status', campaignId: '1', resourceName: 'customers/1234567890/campaigns/1', status: 'PAUSED' },
      { kind: 'campaign_budget', campaignId: '1', resourceName: 'customers/1234567890/campaignBudgets/2', amountMicros: '12000000' },
      { kind: 'keyword_status', campaignId: '1', resourceName: 'customers/1234567890/adGroupCriteria/3~4', status: 'PAUSED' },
      { kind: 'ad_status', campaignId: '1', resourceName: 'customers/1234567890/adGroupAds/3~5', status: 'ENABLED' },
    ], true)
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
      mutateOperations: [
        { campaignOperation: { update: { resourceName: 'customers/1234567890/campaigns/1', status: 'PAUSED' }, updateMask: 'status' } },
        { campaignBudgetOperation: { update: { resourceName: 'customers/1234567890/campaignBudgets/2', amountMicros: '12000000' }, updateMask: 'amount_micros' } },
        { adGroupCriterionOperation: { update: { resourceName: 'customers/1234567890/adGroupCriteria/3~4', status: 'PAUSED' }, updateMask: 'status' } },
        { adGroupAdOperation: { update: { resourceName: 'customers/1234567890/adGroupAds/3~5', status: 'ENABLED' }, updateMask: 'status' } },
      ],
      partialFailure: false,
      validateOnly: true,
    })
    await expect(gateway.mutateAtomicBatch('1234567890', [
      { kind: 'campaign_status', campaignId: '1', resourceName: 'customers/1234567890/campaigns/1', status: 'PAUSED' },
      { kind: 'campaign_status', campaignId: '1', resourceName: 'customers/1234567890/campaigns/1', status: 'ENABLED' },
    ])).rejects.toThrow('une fois')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('detects keyword conflicts without interpolating user text into GAQL', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(googleResponse([{ campaign: { id: '1' }, adGroup: { id: '2', resourceName: 'customers/1234567890/adGroups/2' } }]))
      .mockResolvedValueOnce(googleResponse([
        { campaign: { id: '1' }, adGroup: { id: '2', resourceName: 'customers/1234567890/adGroups/2' }, adGroupCriterion: { status: 'ENABLED', negative: true, keyword: { text: 'Red   Shoes', matchType: 'PHRASE' } } },
        { campaign: { id: '1' }, adGroup: { id: '2', resourceName: 'customers/1234567890/adGroups/2' }, adGroupCriterion: { status: 'ENABLED', negative: false, keyword: { text: 'other', matchType: 'BROAD' } } },
      ]))
    const gateway = new GoogleAdsGateway({ encryptedRefreshToken: 'cipher', managerCustomerId: '9999999999' })
    await expect(gateway.keywordTextState('1234567890', '2', " red shoes ")).resolves.toEqual({
      campaignId: '1',
      adGroupId: '2',
      adGroupResourceName: 'customers/1234567890/adGroups/2',
      normalizedText: 'red shoes',
      matches: [{ text: 'red shoes', matchType: 'PHRASE', negative: true, status: 'ENABLED' }],
    })
    const body = String(fetchMock.mock.calls[1][1]?.body)
    expect(body).toContain('ad_group.id = 2')
    expect(body).not.toContain('red shoes')
  })

  it('reads campaign-level negative keyword conflicts without interpolating user text', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(googleResponse([{ campaign: { id: '1', resourceName: 'customers/1234567890/campaigns/1' } }]))
      .mockResolvedValueOnce(googleResponse([
        { campaign: { id: '1', resourceName: 'customers/1234567890/campaigns/1' }, campaignCriterion: { status: 'ENABLED', negative: true, keyword: { text: 'Red  Shoes', matchType: 'EXACT' } } },
      ]))
    const gateway = new GoogleAdsGateway({ encryptedRefreshToken: 'cipher', managerCustomerId: '9999999999' })
    await expect(gateway.campaignNegativeKeywordState('1234567890', '01', ' red shoes ')).resolves.toEqual({
      scope: 'campaign',
      campaignId: '1',
      campaignResourceName: 'customers/1234567890/campaigns/1',
      normalizedText: 'red shoes',
      matches: [{ text: 'red shoes', matchType: 'EXACT', negative: true, status: 'ENABLED' }],
    })
    expect(String(fetchMock.mock.calls[1][1]?.body)).toContain('campaign.id = 1')
    expect(String(fetchMock.mock.calls[1][1]?.body)).not.toContain('red shoes')
  })

  it('reads a client-owned account negative list and derives a stable approval state', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(googleResponse([{ campaign: { id: '2' } }, { campaign: { id: '1' } }]))
      .mockResolvedValueOnce(googleResponse([{ sharedSet: { resourceName: 'customers/1234567890/sharedSets/7', status: 'ENABLED', type: 'ACCOUNT_LEVEL_NEGATIVE_KEYWORDS' } }]))
      .mockResolvedValueOnce(googleResponse([{ customerNegativeCriterion: { resourceName: 'customers/1234567890/customerNegativeCriteria/8', negativeKeywordList: { sharedSet: 'customers/1234567890/sharedSets/7' } } }]))
      .mockResolvedValueOnce(googleResponse([{ sharedSet: { resourceName: 'customers/1234567890/sharedSets/7' }, sharedCriterion: { keyword: { text: 'Red Shoes', matchType: 'PHRASE' } } }]))
    const gateway = new GoogleAdsGateway({ encryptedRefreshToken: 'cipher', managerCustomerId: '9999999999' })
    const state = await gateway.accountNegativeKeywordState('1234567890', ' red shoes ')
    expect(state).toMatchObject({
      scope: 'account',
      sharedSetResourceName: 'customers/1234567890/sharedSets/7',
      attached: true,
      campaignIds: ['1', '2'],
      matches: [{ text: 'red shoes', matchType: 'PHRASE', negative: true, status: 'ENABLED' }],
    })
    expect(accountNegativeKeywordApprovalState(state)).toMatchObject({ configured: true, campaignIds: ['1', '2'] })
  })

  it('creates campaign and account negative keywords with explicit all-or-nothing validation', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(
      JSON.stringify({ mutateOperationResponses: [] }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'request-id': 'negative-keyword' },
      },
    ))
    const gateway = new GoogleAdsGateway({ encryptedRefreshToken: 'cipher', managerCustomerId: '9999999999' })
    await gateway.mutateCampaignNegativeKeyword('1234567890', '1', ' red  shoes ', 'PHRASE', true)
    await gateway.mutateAccountNegativeKeyword('1234567890', {
      scope: 'account', customerResourceName: 'customers/1234567890', sharedSetResourceName: null,
      attached: false, campaignIds: ['1'], normalizedText: 'red shoes', matches: [],
    }, ' red  shoes ', 'EXACT', true)
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
      operations: [{ create: {
        campaign: 'customers/1234567890/campaigns/1', status: 'ENABLED', negative: true,
        keyword: { text: 'red shoes', matchType: 'PHRASE' },
      } }],
      partialFailure: false,
      validateOnly: true,
    })
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toEqual({
      mutateOperations: [
        { sharedSetOperation: { create: {
          resourceName: 'customers/1234567890/sharedSets/-1',
          name: 'Ads by Yodev – exclusions compte',
          type: 'ACCOUNT_LEVEL_NEGATIVE_KEYWORDS',
        } } },
        { sharedCriterionOperation: { create: {
          sharedSet: 'customers/1234567890/sharedSets/-1', keyword: { text: 'red shoes', matchType: 'EXACT' },
        } } },
        { customerNegativeCriterionOperation: { create: {
          negativeKeywordList: { sharedSet: 'customers/1234567890/sharedSets/-1' },
        } } },
      ],
      partialFailure: false,
      validateOnly: true,
    })
  })

  it('adds only the criterion when the client-owned account list is already attached', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(
      JSON.stringify({ mutateOperationResponses: [] }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ))
    const gateway = new GoogleAdsGateway({ encryptedRefreshToken: 'cipher', managerCustomerId: '9999999999' })
    await gateway.mutateAccountNegativeKeyword('1234567890', {
      scope: 'account', customerResourceName: 'customers/1234567890',
      sharedSetResourceName: 'customers/1234567890/sharedSets/7', attached: true,
      campaignIds: ['1'], normalizedText: 'red shoes', matches: [],
    }, 'red shoes', 'EXACT')
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body)).mutateOperations).toEqual([
      { sharedCriterionOperation: { create: {
        sharedSet: 'customers/1234567890/sharedSets/7', keyword: { text: 'red shoes', matchType: 'EXACT' },
      } } },
    ])
  })

  it('refuses to mutate an account-level shared list owned by another customer', async () => {
    const gateway = new GoogleAdsGateway({ encryptedRefreshToken: 'cipher', managerCustomerId: '9999999999' })
    await expect(gateway.mutateAccountNegativeKeyword('1234567890', {
      scope: 'account', customerResourceName: 'customers/1234567890',
      sharedSetResourceName: 'customers/9999999999/sharedSets/7', attached: true,
      campaignIds: ['1'], normalizedText: 'red shoes', matches: [],
    }, 'red shoes', 'EXACT')).rejects.toThrow('ne correspond pas au compte client')
  })

  it('validates keyword and ad mutations as atomic non-partial operations', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({ results: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'request-id': 'mutation-request' },
    }))
    const gateway = new GoogleAdsGateway({ encryptedRefreshToken: 'cipher', managerCustomerId: '9999999999' })
    await gateway.mutateKeywordCreate('1234567890', '2', '  red   shoes ', 'PHRASE', true, true)
    await gateway.mutateKeywordStatus('1234567890', 'customers/1234567890/adGroupCriteria/2~3', 'PAUSED', true)
    await gateway.mutateAdGroupAdStatus('1234567890', 'customers/1234567890/adGroupAds/2~4', 'PAUSED', true)
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
      operations: [{ create: { adGroup: 'customers/1234567890/adGroups/2', status: 'ENABLED', negative: true, keyword: { text: 'red shoes', matchType: 'PHRASE' } } }],
      partialFailure: false,
      validateOnly: true,
    })
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toMatchObject({ validateOnly: true, operations: [{ updateMask: 'status' }] })
    expect(JSON.parse(String(fetchMock.mock.calls[2][1]?.body))).toMatchObject({ validateOnly: true, operations: [{ updateMask: 'status' }] })
    await expect(gateway.mutateKeywordStatus('1234567890', 'customers/999/adGroupCriteria/2~3', 'PAUSED')).rejects.toThrow('ne correspond pas')
    await expect(gateway.mutateAdGroupAdStatus('1234567890', 'customers/999/adGroupAds/2~4', 'PAUSED')).rejects.toThrow('ne correspond pas')
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('reads keyword and ad state with exact numeric resource ownership', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(googleResponse([{ campaign: { id: '1' }, adGroup: { id: '2' }, adGroupCriterion: { criterionId: '3', resourceName: 'customers/1234567890/adGroupCriteria/2~3', status: 'ENABLED', negative: false, keyword: { text: 'shoes', matchType: 'BROAD' } } }]))
      .mockResolvedValueOnce(googleResponse([{ campaign: { id: '1' }, adGroup: { id: '2' }, adGroupAd: { resourceName: 'customers/1234567890/adGroupAds/2~4', status: 'PAUSED', ad: { id: '4', type: 'RESPONSIVE_SEARCH_AD' } } }]))
    const gateway = new GoogleAdsGateway({ encryptedRefreshToken: 'cipher', managerCustomerId: '9999999999' })
    await expect(gateway.keywordCriterionState('1234567890', '02', '003')).resolves.toMatchObject({ criterionId: '3', text: 'shoes', status: 'ENABLED' })
    await expect(gateway.adGroupAdMutationState('1234567890', '02', '004')).resolves.toMatchObject({ adId: '4', adType: 'RESPONSIVE_SEARCH_AD', status: 'PAUSED' })
    expect(String(fetchMock.mock.calls[0][1]?.body)).toContain('ad_group_criterion.criterion_id = 3')
    expect(String(fetchMock.mock.calls[1][1]?.body)).toContain('ad_group_ad.ad.id = 4')
  })

  it('normalizes and validates a paused RSA draft without partial failure', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(googleResponse([{ campaign: { id: '1' }, adGroup: { id: '2', resourceName: 'customers/1234567890/adGroups/2' } }]))
      .mockResolvedValueOnce(googleResponse([]))
      .mockResolvedValueOnce(new Response(JSON.stringify({ results: [] }), { status: 200, headers: { 'Content-Type': 'application/json', 'request-id': 'rsa-validation' } }))
    const gateway = new GoogleAdsGateway({ encryptedRefreshToken: 'cipher', managerCustomerId: '9999999999' })
    const draft = { headlines: ['Title C', 'Title A', 'Title B'], descriptions: ['Description B', 'Description A'], finalUrls: ['https://example.com/landing'] }
    await expect(gateway.rsaDraftState('1234567890', '2', draft)).resolves.toMatchObject({
      campaignId: '1',
      normalizedDraft: {
        headlines: ['Title A', 'Title B', 'Title C'],
        descriptions: ['Description A', 'Description B'],
        finalUrls: ['https://example.com/landing'],
      },
      matches: [],
    })
    await gateway.mutateRsaDraft('1234567890', '2', {
      headlines: draft.headlines,
      descriptions: draft.descriptions,
      finalUrl: draft.finalUrls[0],
    }, true)
    expect(JSON.parse(String(fetchMock.mock.calls[2][1]?.body))).toEqual({
      operations: [{ create: {
        adGroup: 'customers/1234567890/adGroups/2',
        status: 'PAUSED',
        ad: {
          finalUrls: ['https://example.com/landing'],
          responsiveSearchAd: {
            headlines: [{ text: 'Title C' }, { text: 'Title A' }, { text: 'Title B' }],
            descriptions: [{ text: 'Description B' }, { text: 'Description A' }],
          },
        },
      } }],
      partialFailure: false,
      validateOnly: true,
    })
  })

  it('maps analysis resources without inventing missing Google values', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(googleResponse([{ searchTermView: { searchTerm: 'red shoes', status: 'NONE' }, campaign: { id: '1', name: 'Search' }, adGroup: { id: '2', name: 'Shoes' }, metrics: { impressions: '50', clicks: '5', costMicros: '7000000', conversions: 1 } }]))
      .mockResolvedValueOnce(googleResponse([{ adGroupCriterion: { criterionId: '3', status: 'ENABLED', keyword: { text: 'shoes', matchType: 'PHRASE' }, qualityInfo: { qualityScore: 7, searchPredictedCtr: 'AVERAGE', creativeQualityScore: 'ABOVE_AVERAGE', postClickQualityScore: 'BELOW_AVERAGE' } }, campaign: { id: '1', name: 'Search' }, adGroup: { id: '2', name: 'Shoes' }, metrics: { impressions: '40', clicks: '4', costMicros: '6000000', conversions: 0 } }]))
      .mockResolvedValueOnce(googleResponse([{ adGroupAd: { status: 'ENABLED', adStrength: 'GOOD', policySummary: { approvalStatus: 'APPROVED' }, ad: { id: '4', responsiveSearchAd: { headlines: [{ text: 'Headline' }], descriptions: [{ text: 'Description' }] } } }, campaign: { id: '1', name: 'Search' }, adGroup: { id: '2', name: 'Shoes' }, metrics: { impressions: '30', clicks: '3', costMicros: '5000000', conversions: 2 } }]))
      .mockResolvedValueOnce(googleResponse([{ customer: { conversionTrackingSetting: { conversionTrackingStatus: 'CONVERSION_TRACKING_MANAGED_BY_THIS_CUSTOMER', googleAdsConversionCustomer: 'customers/1234567890', acceptedCustomerDataTerms: true, enhancedConversionsForLeadsEnabled: false } } }]))
    const gateway = new GoogleAdsGateway({ encryptedRefreshToken: 'cipher', managerCustomerId: '9999999999' })
    await expect(gateway.searchTermPerformance('1234567890')).resolves.toEqual([expect.objectContaining({ searchTerm: 'red shoes', adGroupName: 'Shoes', conversions: 1 })])
    await expect(gateway.keywordPerformance('1234567890')).resolves.toEqual([expect.objectContaining({ text: 'shoes', qualityScore: 7, matchType: 'PHRASE' })])
    await expect(gateway.responsiveSearchAdPerformance('1234567890')).resolves.toEqual([expect.objectContaining({ id: '4', headlines: ['Headline'], descriptions: ['Description'] })])
    await expect(gateway.conversionTrackingStatus('1234567890')).resolves.toEqual({
      status: 'CONVERSION_TRACKING_MANAGED_BY_THIS_CUSTOMER',
      managerCustomer: '1234567890',
      acceptedCustomerDataTerms: true,
      enhancedConversionsForLeadsEnabled: false,
    })
  })

  it('surfaces Google request IDs and does not retry a rejected mutation', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      error: {
        message: 'Invalid',
        details: [{ requestId: 'body-request', errors: [{ errorCode: { requestError: 'INVALID_INPUT' }, message: 'Bad status' }] }],
      },
    }), { status: 400, headers: { 'Content-Type': 'application/json', 'request-id': 'header-request' } }))
    const gateway = new GoogleAdsGateway({ encryptedRefreshToken: 'cipher', managerCustomerId: '9999999999' })
    const error = await gateway.mutateCampaignStatus('1234567890', '42', 'PAUSED').catch((failure) => failure)
    expect(error).toBeInstanceOf(GoogleAdsError)
    expect(error).toMatchObject({ status: 400, requestId: 'header-request', message: expect.stringContaining('INVALID_INPUT') })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('fails safely on non-JSON mutation responses without retrying or exposing the body', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('<html>upstream secret details</html>', {
      status: 503,
      headers: { 'Content-Type': 'text/html', 'request-id': 'proxy-request' },
    }))
    const gateway = new GoogleAdsGateway({ encryptedRefreshToken: 'cipher', managerCustomerId: '9999999999' })
    const error = await gateway.mutateCampaignStatus('1234567890', '42', 'PAUSED').catch((failure) => failure)
    expect(error).toBeInstanceOf(GoogleAdsError)
    expect(error).toMatchObject({ status: 503, requestId: 'proxy-request' })
    expect(error.message).not.toContain('upstream secret details')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('retries an invalid read response but accepts the next valid Google payload', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('', { status: 502, headers: { 'request-id': 'proxy-failure' } }))
      .mockResolvedValueOnce(googleResponse([{ customerClient: { clientCustomer: 'customers/1234567890', descriptiveName: 'Acme' } }], 'google-success'))
    const gateway = new GoogleAdsGateway({ encryptedRefreshToken: 'cipher', managerCustomerId: '9999999999' })
    await expect(gateway.listManagedCustomers()).resolves.toEqual([
      { customerId: '1234567890', name: 'Acme', currencyCode: 'EUR', timezone: 'Europe/Paris', isManager: false },
    ])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('classifies a network failure as ambiguous-capable without retrying a mutation', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('socket closed after upload'))
    const gateway = new GoogleAdsGateway({ encryptedRefreshToken: 'cipher', managerCustomerId: '9999999999' })
    const error = await gateway.mutateCampaignStatus('1234567890', '42', 'PAUSED').catch((failure) => failure)
    expect(error).toBeInstanceOf(GoogleAdsError)
    expect(error).toMatchObject({ status: 0, requestId: null, message: 'Google Ads est momentanément injoignable.' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('assembles a complete account analysis from the independent reports', async () => {
    const gateway = new GoogleAdsGateway({ encryptedRefreshToken: 'cipher', managerCustomerId: '9999999999' })
    vi.spyOn(gateway, 'campaignPerformance').mockResolvedValue([])
    vi.spyOn(gateway, 'searchTermPerformance').mockResolvedValue([])
    vi.spyOn(gateway, 'keywordPerformance').mockResolvedValue([])
    vi.spyOn(gateway, 'responsiveSearchAdPerformance').mockResolvedValue([])
    vi.spyOn(gateway, 'conversionTrackingStatus').mockResolvedValue({ status: 'UNSPECIFIED', managerCustomer: null, acceptedCustomerDataTerms: false, enhancedConversionsForLeadsEnabled: false })
    await expect(gateway.accountAnalysis('1234567890')).resolves.toEqual({
      campaigns: [], searchTerms: [], keywords: [], ads: [],
      conversionTracking: { status: 'UNSPECIFIED', managerCustomer: null, acceptedCustomerDataTerms: false, enhancedConversionsForLeadsEnabled: false },
    })
  })

  it('maps daily account metrics and validates date ranges', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(googleResponse([{ segments: { date: '2026-08-12' }, metrics: { impressions: '12', clicks: '3', costMicros: '4000000', conversions: 1.5, conversionsValue: 25 } }]))
    const gateway = new GoogleAdsGateway({ encryptedRefreshToken: 'cipher', managerCustomerId: '9999999999' })
    await expect(gateway.dailyAccountMetrics('1234567890', '2026-08-01', '2026-08-12')).resolves.toEqual([{ date: '2026-08-12', impressions: '12', clicks: '3', costMicros: '4000000', conversions: 1.5, conversionValue: 25 }])
    await expect(gateway.dailyAccountMetrics('1234567890', 'bad', '2026-08-12')).rejects.toThrow('Invalid')
    await expect(gateway.dailyAccountMetrics('1234567890', '2026-08-13', '2026-08-12')).rejects.toThrow('Invalid')
  })

  it('maps real daily campaign metrics without reusing rolling snapshots', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(googleResponse([{
      campaign: { id: '42', name: 'Brand', status: 'ENABLED', advertisingChannelType: 'SEARCH' },
      segments: { date: '2026-08-12' },
      metrics: { impressions: '12', clicks: '3', costMicros: '4000000', conversions: 1.5, conversionsValue: 25 },
    }]))
    const gateway = new GoogleAdsGateway({ encryptedRefreshToken: 'cipher', managerCustomerId: '9999999999' })
    await expect(gateway.dailyCampaignMetrics('1234567890', '2026-08-01', '2026-08-12')).resolves.toEqual([{
      campaignId: '42', campaignName: 'Brand', campaignType: 'SEARCH', status: 'ENABLED', date: '2026-08-12',
      impressions: '12', clicks: '3', costMicros: '4000000', conversions: 1.5, conversionValue: 25,
    }])
  })

  it('maps v25 change events with stable event identities and field masks', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(googleResponse([{
      changeEvent: {
        resourceName: 'customers/123/changeEvents/1~0~0',
        changeDateTime: '2026-08-12 10:30:00+00:00',
        changeResourceName: 'customers/123/campaigns/42',
        userEmail: 'operator@example.com',
        clientType: 'GOOGLE_ADS_API',
        changeResourceType: 'CAMPAIGN',
        resourceChangeOperation: 'UPDATE',
        changedFields: 'status,name',
        oldResource: { campaign: { status: 'PAUSED' } },
        newResource: { campaign: { status: 'ENABLED' } },
      },
    }]))
    const gateway = new GoogleAdsGateway({ encryptedRefreshToken: 'cipher', managerCustomerId: '9999999999' })
    const through = new Date('2026-08-12T12:00:00Z')
    const from = new Date('2026-08-01T00:00:00Z')
    await expect(gateway.changeEvents('1234567890', from, through)).resolves.toEqual([expect.objectContaining({
      resourceName: 'customers/123/changeEvents/1~0~0',
      changedResourceName: 'customers/123/campaigns/42',
      changedFields: ['status', 'name'],
      clientType: 'GOOGLE_ADS_API',
      changedAt: new Date('2026-08-12T10:30:00Z'),
    })])
    expect(String(fetchMock.mock.calls[0][1]?.body)).toContain('LIMIT 10000')
    await expect(gateway.changeEvents('1234567890', new Date('2026-01-01'), through)).rejects.toThrow('within 30 days')
  })

  it('maps conversion configuration separately from observed tag activity', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(googleResponse([{
      conversionAction: {
        resourceName: 'customers/123/conversionActions/7',
        name: 'Purchase',
        status: 'ENABLED',
        category: 'PURCHASE',
        origin: 'WEBSITE',
        type: 'WEBPAGE',
        primaryForGoal: true,
        includeInConversionsMetric: true,
      },
      metrics: {
        conversionLastConversionDate: '2026-08-10',
        conversionLastReceivedRequestDateTime: '2026-08-11 08:15:00+00:00',
      },
    }]))
    const gateway = new GoogleAdsGateway({ encryptedRefreshToken: 'cipher', managerCustomerId: '9999999999' })
    await expect(gateway.conversionActions('1234567890')).resolves.toEqual([expect.objectContaining({
      name: 'Purchase',
      primaryForGoal: true,
      actionType: 'WEBPAGE',
      lastConversionAt: new Date('2026-08-10T12:00:00Z'),
      lastReceivedAt: new Date('2026-08-11T08:15:00Z'),
      lastActivityAt: new Date('2026-08-11T08:15:00Z'),
    })])
  })

  it('reads offline conversion upload health without uploading any event', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(googleResponse([{
      offlineConversionUploadClientSummary: {
        client: 'GOOGLE_ADS_API',
        status: 'NEEDS_ATTENTION',
        lastUploadDateTime: '2026-08-11 08:15:00+00:00',
        totalEventCount: '100',
        successfulEventCount: '85',
        pendingEventCount: '5',
        successRate: 0.85,
        alerts: [{ error: 'DUPLICATE_ORDER_ID', count: '10' }],
      },
    }]))
    const gateway = new GoogleAdsGateway({ encryptedRefreshToken: 'cipher', managerCustomerId: '9999999999' })
    await expect(gateway.offlineConversionDiagnostics('1234567890')).resolves.toEqual([{
      uploadClient: 'GOOGLE_ADS_API',
      status: 'NEEDS_ATTENTION',
      lastUploadAt: new Date('2026-08-11T08:15:00Z'),
      totalEventCount: '100',
      successfulEventCount: '85',
      pendingEventCount: '5',
      successRate: 0.85,
      alerts: [{ error: 'DUPLICATE_ORDER_ID', count: '10' }],
    }])
    expect(String(fetchMock.mock.calls[0][1]?.body)).toContain('offline_conversion_upload_client_summary')
    expect(String(fetchMock.mock.calls[0][1]?.body)).not.toContain('operations')
  })
})
