import { describe, expect, it } from 'vitest'
import { atomicChangeBatchState, atomicOperationFromApproval, type AtomicBatchSource } from './atomic-change-batch'

function source(overrides: Partial<AtomicBatchSource> = {}): AtomicBatchSource {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    kind: 'campaign_status',
    resourceName: 'customers/1/campaigns/1',
    payload: { campaignId: '1', status: 'PAUSED' },
    expectedState: { resourceName: 'customers/1/campaigns/1', status: 'ENABLED' },
    proposedState: { resourceName: 'customers/1/campaigns/1', status: 'PAUSED' },
    ...overrides,
  }
}

describe('generic atomic change batches', () => {
  it('maps only reversible supported operations', () => {
    expect(atomicOperationFromApproval(source())).toEqual({
      kind: 'campaign_status', campaignId: '1', resourceName: 'customers/1/campaigns/1', status: 'PAUSED',
    })
    expect(atomicOperationFromApproval(source({
      kind: 'campaign_budget', resourceName: 'customers/1/campaignBudgets/2', payload: { campaignId: '1', amountMicros: '12' },
    }))).toEqual({ kind: 'campaign_budget', campaignId: '1', resourceName: 'customers/1/campaignBudgets/2', amountMicros: '12' })
    expect(() => atomicOperationFromApproval(source({ kind: 'rsa_create_draft' }))).toThrow('non compatible')
  })

  it('builds a stable state and rejects duplicate resources', () => {
    const second = source({ id: '00000000-0000-4000-8000-000000000002', kind: 'ad_status', resourceName: 'customers/1/adGroupAds/2~3' })
    expect(atomicChangeBatchState([second, source()], 'expectedState')).toEqual(expect.objectContaining({
      atomic: true, partialFailure: false, changes: [expect.objectContaining({ sourceApprovalId: source().id }), expect.objectContaining({ sourceApprovalId: second.id })],
    }))
    expect(() => atomicChangeBatchState([source(), source({ id: second.id })], 'expectedState')).toThrow('une fois')
  })
})
