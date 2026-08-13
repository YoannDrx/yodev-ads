import { beforeEach, describe, expect, it, vi } from 'vitest'
import { databaseDouble } from '../../test/fluent-db'
import { stateHash } from './approval-state'

const mocks = vi.hoisted(() => ({
  databases: [] as unknown[],
  runTransaction: vi.fn(async (callback: (db: unknown) => unknown) => callback(mocks.databases.shift())),
  campaignMutationState: vi.fn(),
  keywordCriterionState: vi.fn(),
  adGroupAdMutationState: vi.fn(),
  rsaDraftState: vi.fn(),
  currentAtomicBatchSource: vi.fn(),
  currentKeywordCreationContext: vi.fn(),
  scheduleObservation: vi.fn(),
}))

vi.mock('@/db/transactions', () => ({ withSystemTransaction: mocks.runTransaction }))
vi.mock('@/lib/google-ads', () => ({
  GoogleAdsGateway: class {
    campaignMutationState = mocks.campaignMutationState
    keywordCriterionState = mocks.keywordCriterionState
    adGroupAdMutationState = mocks.adGroupAdMutationState
    rsaDraftState = mocks.rsaDraftState
  },
}))
vi.mock('@/lib/atomic-change-batch-server', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/atomic-change-batch-server')>(),
  currentAtomicBatchSource: mocks.currentAtomicBatchSource,
}))
vi.mock('@/lib/keyword-creation', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/keyword-creation')>(),
  currentKeywordCreationContext: mocks.currentKeywordCreationContext,
}))
vi.mock('@/lib/mutation-observations', () => ({
  scheduleMutationObservationWithDatabase: mocks.scheduleObservation,
}))

import { reconcileGoogleMutation } from './reconcile-google-mutation'

const approvalId = '00000000-0000-4000-8000-000000000001'
const workspaceId = '00000000-0000-4000-8000-000000000002'
const clientId = '00000000-0000-4000-8000-000000000003'
const executionId = '00000000-0000-4000-8000-000000000004'
const client = { id: clientId, workspaceId, googleCustomerId: '1234567890', timezone: 'Europe/Paris' }
const connection = { id: 'connection', workspaceId, encryptedRefreshToken: 'cipher', managerCustomerId: '9999999999' }
const execution = { id: executionId, attempt: 1, submittedAt: new Date('2026-08-12T10:00:00Z') }

function approval(overrides: Record<string, unknown> = {}) {
  return {
    id: approvalId, workspaceId, clientId, kind: 'campaign_status', status: 'ambiguous',
    payload: { campaignId: '1' }, proposedState: { resourceName: 'customers/123/campaigns/1', status: 'PAUSED' },
    expectedStateHash: stateHash({ resourceName: 'customers/123/campaigns/1', status: 'ENABLED' }),
    observationWindowDays: 7, ...overrides,
  }
}

function contextDatabase(item = approval(), context = { client: true, connection: true, execution: true }) {
  return databaseDouble({ statementResults: [
    [item],
    context.client ? [client] : [],
    context.connection ? [connection] : [],
    context.execution ? [execution] : [],
  ] })
}

function transitionDatabase(updated = true) {
  return databaseDouble({ statementResults: [updated ? [{ id: approvalId }] : [], [], [], []] })
}

function campaignState(overrides: Record<string, unknown> = {}) {
  return {
    campaignId: '1', campaignName: 'Campaign', campaignResourceName: 'customers/123/campaigns/1', status: 'PAUSED',
    budgetResourceName: 'customers/123/campaignBudgets/1', budgetMicros: '1000000',
    budgetExplicitlyShared: false, budgetReferenceCount: '1', ...overrides,
  }
}

describe('ambiguous Google mutation reconciliation', () => {
  beforeEach(() => {
    mocks.databases = []
    vi.clearAllMocks()
  })

  it('is idempotent when the approval is no longer ambiguous', async () => {
    mocks.databases.push(databaseDouble({ statementResults: [[]] }).db)
    await expect(reconcileGoogleMutation(approvalId)).resolves.toBe('already_reconciled')
  })

  it('rejects incomplete execution context and missing campaign identity', async () => {
    mocks.databases.push(contextDatabase(approval(), { client: false, connection: true, execution: true }).db)
    await expect(reconcileGoogleMutation(approvalId)).rejects.toThrow('context is incomplete')

    mocks.databases.push(contextDatabase(approval({ payload: {} })).db)
    await expect(reconcileGoogleMutation(approvalId)).rejects.toThrow('no campaign ID')
  })

  it('confirms an applied campaign status exactly once and schedules observation', async () => {
    const current = campaignState()
    mocks.campaignMutationState.mockResolvedValue(current)
    const contextDb = contextDatabase()
    const transition = transitionDatabase()
    mocks.databases.push(contextDb.db, transition.db)
    await expect(reconcileGoogleMutation(approvalId)).resolves.toBe('confirmed')
    expect(transition.capture.sets[0]).toMatchObject({ status: 'executed', executionState: 'confirmed', reconciliationState: 'confirmed' })
    expect(transition.capture.sets[1]).toMatchObject({ state: 'confirmed' })
    expect(mocks.scheduleObservation).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      approval: expect.objectContaining({ id: approvalId }), executedAt: execution.submittedAt,
    }))
  })

  it('does not duplicate confirmation side effects after losing the atomic update race', async () => {
    mocks.campaignMutationState.mockResolvedValue(campaignState())
    mocks.databases.push(contextDatabase().db, transitionDatabase(false).db)
    await expect(reconcileGoogleMutation(approvalId)).resolves.toBe('confirmed')
    expect(mocks.scheduleObservation).not.toHaveBeenCalled()
  })

  it('returns to pending only when non-application is proven and clears prior votes', async () => {
    const current = campaignState({ status: 'ENABLED' })
    mocks.campaignMutationState.mockResolvedValue(current)
    const transition = transitionDatabase()
    mocks.databases.push(contextDatabase().db, transition.db)
    await expect(reconcileGoogleMutation(approvalId)).resolves.toBe('not_applied')
    expect(transition.capture.sets[0]).toMatchObject({ status: 'pending', reconciliationState: 'not_applied', approvedBy: null })
    expect(transition.capture.sets[1]).toMatchObject({ state: 'failed', result: { reconciledState: {
      resourceName: 'customers/123/campaigns/1', status: 'ENABLED',
    }, provenNotApplied: true } })
  })

  it('keeps an ambiguous mutation blocked when Google matches neither state', async () => {
    mocks.campaignMutationState.mockResolvedValue(campaignState({ status: 'REMOVED' }))
    mocks.databases.push(contextDatabase().db)
    await expect(reconcileGoogleMutation(approvalId)).rejects.toThrow('neither the expected nor proposed')
  })

  it('reconciles campaign budgets and atomic budget reallocations', async () => {
    const budgetCurrent = campaignState({ budgetMicros: '2000000' })
    const budgetProposed = {
      resourceName: budgetCurrent.budgetResourceName, amountMicros: '2000000', explicitlyShared: false, referenceCount: '1',
    }
    mocks.campaignMutationState.mockResolvedValueOnce(budgetCurrent)
    mocks.databases.push(contextDatabase(approval({ kind: 'campaign_budget', proposedState: budgetProposed })).db, transitionDatabase().db)
    await expect(reconcileGoogleMutation(approvalId)).resolves.toBe('confirmed')

    const source = campaignState({ campaignId: '1', budgetResourceName: 'customers/123/campaignBudgets/1', budgetMicros: '500000' })
    const target = campaignState({ campaignId: '2', budgetResourceName: 'customers/123/campaignBudgets/2', budgetMicros: '1500000' })
    const atomic = { atomic: true, changes: [
      { campaignId: '1', resourceName: source.budgetResourceName, amountMicros: '500000', explicitlyShared: false, referenceCount: '1' },
      { campaignId: '2', resourceName: target.budgetResourceName, amountMicros: '1500000', explicitlyShared: false, referenceCount: '1' },
    ] }
    mocks.campaignMutationState.mockResolvedValueOnce(source).mockResolvedValueOnce(target)
    mocks.databases.push(contextDatabase(approval({
      kind: 'budget_reallocation', payload: { campaignId: '1', changes: [{ campaignId: '1' }, { campaignId: '2' }] }, proposedState: atomic,
    })).db, transitionDatabase().db)
    await expect(reconcileGoogleMutation(approvalId)).resolves.toBe('confirmed')
  })

  it('rejects malformed atomic budget context', async () => {
    mocks.databases.push(contextDatabase(approval({ kind: 'budget_reallocation', payload: { campaignId: '1', changes: [] } })).db)
    await expect(reconcileGoogleMutation(approvalId)).rejects.toThrow('invalid size')
    mocks.databases.push(contextDatabase(approval({
      kind: 'budget_reallocation', payload: { campaignId: '1', changes: [{ campaignId: '' }, { campaignId: '2' }] },
    })).db)
    await expect(reconcileGoogleMutation(approvalId)).rejects.toThrow('incomplete context')
  })

  it('reconciles heterogeneous atomic batches and keyword creations', async () => {
    const sources = [
      { id: '00000000-0000-4000-8000-000000000011', kind: 'campaign_status', resourceName: 'campaign/1', payload: { campaignId: '1', current: { resourceName: 'campaign/1', status: 'PAUSED' } } },
      { id: '00000000-0000-4000-8000-000000000012', kind: 'ad_status', resourceName: 'ad/1', payload: { campaignId: '1', current: { resourceName: 'ad/1', status: 'PAUSED' } } },
    ]
    const atomicState = { atomic: true, partialFailure: false, changes: sources.map((source) => ({ sourceApprovalId: source.id, kind: source.kind, state: source.payload.current })) }
    mocks.currentAtomicBatchSource.mockImplementation(async (_gateway, _customer, source) => ({
      ...source, expectedState: source.payload.current, proposedState: source.payload.current,
    }))
    mocks.databases.push(contextDatabase(approval({
      kind: 'atomic_change_batch', payload: { campaignId: '1', sources }, proposedState: atomicState,
    })).db, transitionDatabase().db)
    await expect(reconcileGoogleMutation(approvalId)).resolves.toBe('confirmed')

    const keywordState = { scope: 'campaign', campaignId: '1', campaignResourceName: 'campaign/1', normalizedText: 'shoes', matches: [{ negative: true }] }
    mocks.currentKeywordCreationContext.mockResolvedValue({ approvalState: keywordState })
    mocks.databases.push(contextDatabase(approval({
      kind: 'keyword_create_negative', payload: { scope: 'campaign', campaignId: '1', keywordText: 'shoes', matchType: 'PHRASE', negative: true },
      proposedState: keywordState,
    })).db, transitionDatabase().db)
    await expect(reconcileGoogleMutation(approvalId)).resolves.toBe('confirmed')
  })

  it('reconciles keyword, ad and RSA resources and validates their context', async () => {
    const keyword = { resourceName: 'criterion/1', status: 'PAUSED' }
    mocks.keywordCriterionState.mockResolvedValue(keyword)
    mocks.databases.push(contextDatabase(approval({
      kind: 'keyword_status', payload: { campaignId: '1', adGroupId: '2', criterionId: '3' }, proposedState: keyword,
    })).db, transitionDatabase().db)
    await expect(reconcileGoogleMutation(approvalId)).resolves.toBe('confirmed')

    const ad = { resourceName: 'ad/1', status: 'PAUSED' }
    mocks.adGroupAdMutationState.mockResolvedValue(ad)
    mocks.databases.push(contextDatabase(approval({
      kind: 'ad_status', payload: { campaignId: '1', adGroupId: '2', adId: '3' }, proposedState: ad,
    })).db, transitionDatabase().db)
    await expect(reconcileGoogleMutation(approvalId)).resolves.toBe('confirmed')

    const rsa = { adGroupResourceName: 'group/2', matches: [{ status: 'PAUSED' }] }
    mocks.rsaDraftState.mockResolvedValue(rsa)
    mocks.databases.push(contextDatabase(approval({
      kind: 'rsa_create_draft', payload: { campaignId: '1', adGroupId: '2', headlines: ['One'], descriptions: ['Two'], finalUrl: 'https://example.test' },
      proposedState: rsa,
    })).db, transitionDatabase().db)
    await expect(reconcileGoogleMutation(approvalId)).resolves.toBe('confirmed')

    mocks.databases.push(contextDatabase(approval({ kind: 'keyword_status', payload: { campaignId: '1' } })).db)
    await expect(reconcileGoogleMutation(approvalId)).rejects.toThrow('keyword update has incomplete context')
    mocks.databases.push(contextDatabase(approval({ kind: 'ad_status', payload: { campaignId: '1' } })).db)
    await expect(reconcileGoogleMutation(approvalId)).rejects.toThrow('ad update has incomplete context')
    mocks.databases.push(contextDatabase(approval({ kind: 'rsa_create_draft', payload: { campaignId: '1' } })).db)
    await expect(reconcileGoogleMutation(approvalId)).rejects.toThrow('RSA creation has incomplete context')
  })

  it('rejects unsupported mutation kinds without altering the approval', async () => {
    mocks.databases.push(contextDatabase(approval({ kind: 'unknown_kind' })).db)
    await expect(reconcileGoogleMutation(approvalId)).rejects.toThrow('Unsupported ambiguous mutation kind')
  })
})
