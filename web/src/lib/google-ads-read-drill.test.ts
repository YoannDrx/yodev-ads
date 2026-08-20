import { describe, expect, it, vi } from 'vitest'
import { GoogleAdsError } from '@/lib/google-ads'
import { GoogleAdsReadDrillError, runGoogleAdsReadDrill } from '@/lib/google-ads-read-drill'

const context = {
  encryptedRefreshToken: 'encrypted-refresh-token',
  managerCustomerId: '1111111111',
  googleCustomerId: '2222222222',
}

function gatewayFixture() {
  const requestIds: string[] = []
  const result = <T>(requestId: string, value: T) => vi.fn(async () => {
    requestIds.push(requestId)
    return value
  })
  return {
    verifyOAuthAccess: vi.fn(async () => ({ valid: true as const })),
    listManagedCustomers: result('mcc-request', [{ id: 'managed' }]),
    campaignPerformance: result('campaign-request', [{ channelType: 'SEARCH' }, { channelType: 'PERFORMANCE_MAX' }]),
    performanceMaxPlacements: result('pmax-request', [{ placement: 'example.invalid' }]),
    assetGroupPerformance: result('asset-group-request', [{ id: 'asset-group' }]),
    shoppingProductPerformance: result('shopping-request', []),
    conversionActions: result('conversion-request', [{ resourceName: 'conversion' }]),
    offlineConversionDiagnostics: result('offline-request', []),
    collectedRequestIds: () => [...requestIds],
  }
}

describe('Google Ads read drill', () => {
  it('runs every read-only family and groups provider request IDs by stage', async () => {
    const gateway = gatewayFixture()
    const evidence = await runGoogleAdsReadDrill({
      loadContext: vi.fn(async () => context),
      createGateway: () => gateway as never,
    })

    expect(evidence).toMatchObject({
      verified: true,
      mode: 'read_only',
      refreshTokenRenewed: true,
      managedAccounts: 1,
      campaigns: 2,
      channelTypes: ['PERFORMANCE_MAX', 'SEARCH'],
      pmaxPlacements: 1,
      assetGroups: 1,
      shoppingProducts: 0,
      conversionActions: 1,
      offlineDiagnostics: 0,
      requestIds: {
        oauth_and_mcc: ['mcc-request'],
        campaign_performance: ['campaign-request'],
        performance_max: ['pmax-request', 'asset-group-request'],
        shopping: ['shopping-request'],
        conversions: ['conversion-request'],
        offline_diagnostics: ['offline-request'],
      },
    })
    expect(gateway.verifyOAuthAccess).toHaveBeenCalledOnce()
  })

  it('preserves safe drill failures and converts provider failures without their message', async () => {
    const expected = new GoogleAdsReadDrillError('connection_missing', 'database_context')
    await expect(runGoogleAdsReadDrill({
      loadContext: vi.fn(async () => { throw expected }),
      createGateway: () => gatewayFixture() as never,
    })).rejects.toBe(expected)

    const gateway = gatewayFixture()
    gateway.conversionActions.mockRejectedValueOnce(new GoogleAdsError('sensitive provider message', 403, 'failed-request'))
    const error = await runGoogleAdsReadDrill({
      loadContext: vi.fn(async () => context),
      createGateway: () => gateway as never,
    }).catch((failure) => failure)
    expect(error).toBeInstanceOf(GoogleAdsReadDrillError)
    expect(error).toMatchObject({ code: 'google_ads_request_failed', stage: 'conversions', requestId: 'failed-request' })
    expect(error.message).not.toContain('sensitive provider message')
  })

  it('fails closed on unexpected local errors', async () => {
    const error = await runGoogleAdsReadDrill({
      loadContext: vi.fn(async () => { throw new Error('database connection details') }),
      createGateway: () => gatewayFixture() as never,
    }).catch((failure) => failure)
    expect(error).toMatchObject({ code: 'read_drill_failed', stage: 'database_context', requestId: null })
    expect(error.message).not.toContain('database connection details')
  })
})
