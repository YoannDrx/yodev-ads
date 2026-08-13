import { describe, expect, it } from 'vitest'
import { buildMutationImpactPreview, mergeAtomicImpactPreviews, mutationConflicts } from './mutation-impact'

describe('mutation impact previews', () => {
  it('extracts stable affected resources and enforces an observation window', () => {
    expect(buildMutationImpactPreview({
      kind: 'campaign_budget',
      expectedState: { resourceName: 'customers/1/campaignBudgets/2', amountMicros: '10' },
      proposedState: { resourceName: 'customers/1/campaignBudgets/2', amountMicros: '12' },
      summary: 'Budget +20 %',
    })).toEqual(expect.objectContaining({
      atomic: false,
      partialFailure: false,
      operationCount: 1,
      affectedResources: ['customers/1/campaignBudgets/2'],
      observationWindowDays: 7,
    }))
    expect(() => buildMutationImpactPreview({ kind: 'x', expectedState: {}, proposedState: {}, summary: 'x', observationWindowDays: 31 })).toThrow('1 et 30')
  })

  it('merges non-blocking previews into an explicit all-or-nothing batch', () => {
    const first = buildMutationImpactPreview({
      kind: 'campaign_status', expectedState: { resourceName: 'campaign/1' }, proposedState: { resourceName: 'campaign/1' }, summary: 'Pause',
      conflicts: [{ code: 'TRAFFIC_INTERRUPTION', severity: 'warning', message: 'Traffic interrompu' }],
    })
    const second = buildMutationImpactPreview({
      kind: 'ad_status', expectedState: { resourceName: 'ad/2' }, proposedState: { resourceName: 'ad/2' }, summary: 'Pause ad',
    })
    expect(mergeAtomicImpactPreviews([first, second], 'Deux changements')).toEqual(expect.objectContaining({
      atomic: true,
      partialFailure: false,
      operationCount: 2,
      affectedResources: ['campaign/1', 'ad/2'],
    }))
  })

  it('rejects blocking conflicts and invalid batch sizes', () => {
    const blocking = buildMutationImpactPreview({
      kind: 'keyword', expectedState: {}, proposedState: {}, summary: 'Keyword',
      conflicts: [{ code: 'DUPLICATE', severity: 'blocking', message: 'Duplicate' }],
    })
    expect(() => mergeAtomicImpactPreviews([blocking, blocking], 'Invalid')).toThrow('conflit bloquant')
    expect(() => mergeAtomicImpactPreviews([blocking], 'Invalid')).toThrow('2 et 20')
    const oversized = buildMutationImpactPreview({
      kind: 'batch', expectedState: {}, proposedState: { changed: true }, summary: 'Oversized', operationCount: 11,
    })
    expect(() => mergeAtomicImpactPreviews([oversized, oversized], 'Invalid')).toThrow('dépasser 20')
  })

  it('surfaces no-op, traffic interruption, shared-budget and paused-draft risks', () => {
    expect(mutationConflicts('campaign_status', { status: 'ENABLED' }, { status: 'ENABLED' })[0]).toMatchObject({ code: 'NO_EFFECT', severity: 'blocking' })
    expect(mutationConflicts('campaign_status', { status: 'ENABLED' }, { status: 'PAUSED' })[0]).toMatchObject({ code: 'TRAFFIC_INTERRUPTION' })
    expect(mutationConflicts('campaign_budget', { amountMicros: '1', explicitlyShared: true, referenceCount: '3' }, { amountMicros: '2' })[0]).toMatchObject({ code: 'SHARED_BUDGET' })
    expect(mutationConflicts('keyword_create_negative', {}, { scope: 'campaign', campaignResourceName: 'campaign/1' })).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'CAMPAIGN_WIDE_TRAFFIC_FILTER' })]))
    expect(mutationConflicts('keyword_create_negative', {}, { scope: 'account', customerResourceName: 'customers/1' })).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'ACCOUNT_WIDE_TRAFFIC_FILTER' })]))
    expect(mutationConflicts('rsa_create_draft', {}, { matches: [{}] })[0]).toMatchObject({ code: 'PAUSED_DRAFT', severity: 'info' })
  })
})
