import { describe, expect, it, vi } from 'vitest'
import type { GoogleAdsGateway } from '@/lib/google-ads'
import {
  currentKeywordCreationContext,
  mutateKeywordCreation,
  proposedKeywordCreationState,
} from '@/lib/keyword-creation'

describe('keyword creation workflow', () => {
  it('builds an account-wide atomic context and a stable proposed state', async () => {
    const accountState = {
      scope: 'account' as const,
      customerResourceName: 'customers/1234567890',
      sharedSetResourceName: null,
      attached: false,
      campaignIds: ['1', '2'],
      normalizedText: 'red shoes',
      matches: [],
    }
    const mutateAccountNegativeKeyword = vi.fn().mockResolvedValue({ requestId: 'request-1' })
    const gateway = {
      accountNegativeKeywordState: vi.fn().mockResolvedValue(accountState),
      mutateAccountNegativeKeyword,
    } as unknown as GoogleAdsGateway
    const payload = {
      scope: 'account' as const, campaignId: '1', campaignIds: ['1', '2'], keywordText: 'Red Shoes',
      matchType: 'PHRASE' as const, negative: true,
    }
    const context = await currentKeywordCreationContext(gateway, '1234567890', payload)
    expect(context).toMatchObject({ scope: 'account', operationCount: 3, resourceName: 'customers/1234567890' })
    expect(proposedKeywordCreationState(context, payload)).toMatchObject({
      configured: true,
      matches: [{ text: 'red shoes', matchType: 'PHRASE', negative: true, status: 'ENABLED' }],
    })
    await mutateKeywordCreation(gateway, '1234567890', payload, context, true)
    expect(mutateAccountNegativeKeyword).toHaveBeenCalledWith('1234567890', accountState, 'Red Shoes', 'PHRASE', true)
  })

  it('rejects positive keywords outside the ad-group scope', async () => {
    const gateway = {} as GoogleAdsGateway
    await expect(currentKeywordCreationContext(gateway, '1234567890', {
      scope: 'campaign', campaignId: '1', keywordText: 'brand', matchType: 'EXACT', negative: false,
    })).rejects.toThrow('positif')
  })
})
