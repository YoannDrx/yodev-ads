import { describe, expect, it, vi } from 'vitest'
import { atomicOperationSchema, currentAtomicBatchSource, storedAtomicBatchSourceSchema } from './atomic-change-batch-server'

const id = '00000000-0000-4000-8000-000000000001'

function gateway() {
  return {
    campaignMutationState: vi.fn(async () => ({
      campaignResourceName: 'customers/1/campaigns/2', status: 'ENABLED',
      budgetResourceName: 'customers/1/campaignBudgets/3', budgetMicros: '12000000',
      budgetExplicitlyShared: true, budgetReferenceCount: '2',
    })),
    keywordCriterionState: vi.fn(async () => ({ resourceName: 'customers/1/adGroupCriteria/4~5', status: 'PAUSED' })),
    adGroupAdMutationState: vi.fn(async () => ({ resourceName: 'customers/1/adGroupAds/4~6', status: 'ENABLED' })),
  }
}

describe('atomic batch server state', () => {
  it('parses only stored reversible sources and executable operations', () => {
    expect(storedAtomicBatchSourceSchema.parse({ id, kind: 'campaign_status', resourceName: 'campaign', payload: {} })).toMatchObject({ id })
    expect(() => storedAtomicBatchSourceSchema.parse({ id: 'bad', kind: 'delete', resourceName: '', payload: {} })).toThrow()
    for (const operation of [
      { kind: 'campaign_status', campaignId: '2', resourceName: 'campaign', status: 'PAUSED' },
      { kind: 'campaign_budget', campaignId: '2', resourceName: 'budget', amountMicros: '12' },
      { kind: 'keyword_status', campaignId: '2', resourceName: 'keyword', status: 'ENABLED' },
      { kind: 'ad_status', campaignId: '2', resourceName: 'ad', status: 'PAUSED' },
    ]) expect(atomicOperationSchema.parse(operation)).toEqual(operation)
    expect(() => atomicOperationSchema.parse({ kind: 'campaign_budget', campaignId: 'x', resourceName: 'budget', amountMicros: '-1' })).toThrow()
  })

  it('refreshes campaign status and budget source state from Google', async () => {
    const ads = gateway()
    await expect(currentAtomicBatchSource(ads as never, '1', {
      id, kind: 'campaign_status', resourceName: 'customers/1/campaigns/2', payload: { campaignId: '2' },
    })).resolves.toMatchObject({ expectedState: { status: 'ENABLED' }, proposedState: { status: 'ENABLED' } })
    await expect(currentAtomicBatchSource(ads as never, '1', {
      id, kind: 'campaign_budget', resourceName: 'customers/1/campaignBudgets/3', payload: { campaignId: '2' },
    })).resolves.toMatchObject({ expectedState: { amountMicros: '12000000', explicitlyShared: true, referenceCount: '2' } })
  })

  it('refreshes keyword and ad state and rejects drifted resources or malformed identifiers', async () => {
    const ads = gateway()
    await expect(currentAtomicBatchSource(ads as never, '1', {
      id, kind: 'keyword_status', resourceName: 'customers/1/adGroupCriteria/4~5', payload: { campaignId: '2', adGroupId: '4', criterionId: '5' },
    })).resolves.toMatchObject({ expectedState: { status: 'PAUSED' } })
    await expect(currentAtomicBatchSource(ads as never, '1', {
      id, kind: 'ad_status', resourceName: 'customers/1/adGroupAds/4~6', payload: { campaignId: '2', adGroupId: '4', adId: '6' },
    })).resolves.toMatchObject({ expectedState: { status: 'ENABLED' } })
    await expect(currentAtomicBatchSource(ads as never, '1', {
      id, kind: 'campaign_status', resourceName: 'wrong', payload: { campaignId: '2' },
    })).rejects.toThrow('ne correspond plus')
    await expect(currentAtomicBatchSource(ads as never, '1', {
      id, kind: 'keyword_status', resourceName: 'x', payload: { campaignId: '2', adGroupId: 'bad', criterionId: '5' },
    })).rejects.toThrow()
  })
})
