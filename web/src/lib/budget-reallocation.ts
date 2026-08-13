import type { CampaignMutationState } from '@/lib/google-ads'

export type AtomicBudgetState = {
  atomic: true
  changes: Array<{
    campaignId: string
    resourceName: string
    amountMicros: string
    explicitlyShared: boolean
    referenceCount: string
  }>
}

export type AtomicBudgetReallocation = {
  changes: Array<{
    campaignId: string
    campaignName: string
    budgetResourceName: string
    amountMicros: string
  }>
  expectedState: AtomicBudgetState
  proposedState: AtomicBudgetState
}

function budgetState(state: CampaignMutationState) {
  return {
    campaignId: state.campaignId,
    resourceName: state.budgetResourceName,
    amountMicros: state.budgetMicros,
    explicitlyShared: state.budgetExplicitlyShared,
    referenceCount: state.budgetReferenceCount,
  }
}

export function atomicBudgetState(states: CampaignMutationState[]): AtomicBudgetState {
  return { atomic: true, changes: states.map(budgetState) }
}

export function buildAtomicBudgetReallocation(
  source: CampaignMutationState,
  target: CampaignMutationState,
  transferMicros: bigint,
): AtomicBudgetReallocation {
  if (transferMicros <= 0) throw new Error('Le transfert doit être strictement positif.')
  if (source.campaignId === target.campaignId || source.budgetResourceName === target.budgetResourceName) {
    throw new Error('Une réallocation exige deux campagnes et deux budgets distincts.')
  }
  if (!source.budgetResourceName || !target.budgetResourceName) {
    throw new Error('Chaque campagne doit posséder un budget identifiable.')
  }
  if (source.budgetExplicitlyShared || target.budgetExplicitlyShared) {
    throw new Error('Les réallocations batch sont bloquées pour les budgets partagés afin d’éviter un impact indirect non borné.')
  }

  const sourceAmount = BigInt(source.budgetMicros) - transferMicros
  const targetAmount = BigInt(target.budgetMicros) + transferMicros
  if (sourceAmount <= 0) throw new Error('Le transfert rendrait le budget source nul ou négatif.')

  const changes = [
    {
      campaignId: source.campaignId,
      campaignName: source.campaignName,
      budgetResourceName: source.budgetResourceName,
      amountMicros: sourceAmount.toString(),
    },
    {
      campaignId: target.campaignId,
      campaignName: target.campaignName,
      budgetResourceName: target.budgetResourceName,
      amountMicros: targetAmount.toString(),
    },
  ]
  const expectedState = atomicBudgetState([source, target])
  const proposedState: AtomicBudgetState = {
    atomic: true,
    changes: expectedState.changes.map((state, index) => ({
      ...state,
      amountMicros: changes[index].amountMicros,
    })),
  }
  return { changes, expectedState, proposedState }
}
