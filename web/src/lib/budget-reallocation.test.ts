import { describe, expect, it } from 'vitest'
import { atomicBudgetState, buildAtomicBudgetReallocation } from '@/lib/budget-reallocation'
import type { CampaignMutationState } from '@/lib/google-ads'

function campaign(overrides: Partial<CampaignMutationState> = {}): CampaignMutationState {
  return {
    campaignId: '1',
    campaignName: 'Source',
    campaignResourceName: 'customers/123/campaigns/1',
    status: 'ENABLED',
    budgetResourceName: 'customers/123/campaignBudgets/10',
    budgetMicros: '100000000',
    budgetExplicitlyShared: false,
    budgetReferenceCount: '1',
    ...overrides,
  }
}

describe('atomic budget reallocation', () => {
  it('preserves total daily budget and builds stable before/after states', () => {
    const source = campaign()
    const target = campaign({
      campaignId: '2',
      campaignName: 'Target',
      campaignResourceName: 'customers/123/campaigns/2',
      budgetResourceName: 'customers/123/campaignBudgets/20',
      budgetMicros: '50000000',
    })
    const result = buildAtomicBudgetReallocation(source, target, BigInt(5_000_000))

    expect(result.changes.map((change) => change.amountMicros)).toEqual(['95000000', '55000000'])
    expect(result.expectedState).toEqual(atomicBudgetState([source, target]))
    expect(result.proposedState.changes.map((change) => change.amountMicros)).toEqual(['95000000', '55000000'])
    expect(result.changes.reduce((sum, change) => sum + BigInt(change.amountMicros), BigInt(0))).toBe(BigInt(150_000_000))
  })

  it('rejects same/shared budgets and non-positive source results', () => {
    const source = campaign()
    const target = campaign({ campaignId: '2', campaignResourceName: 'customers/123/campaigns/2' })
    expect(() => buildAtomicBudgetReallocation(source, target, BigInt(1))).toThrow('deux campagnes et deux budgets distincts')
    expect(() => buildAtomicBudgetReallocation(source, campaign({ campaignId: '2', budgetResourceName: 'customers/123/campaignBudgets/20', budgetExplicitlyShared: true }), BigInt(1))).toThrow('budgets partagés')
    expect(() => buildAtomicBudgetReallocation(source, campaign({ campaignId: '2', budgetResourceName: 'customers/123/campaignBudgets/20' }), BigInt(100_000_000))).toThrow('nul ou négatif')
    expect(() => buildAtomicBudgetReallocation(source, campaign({ campaignId: '2', budgetResourceName: 'customers/123/campaignBudgets/20' }), BigInt(0))).toThrow('strictement positif')
  })
})
