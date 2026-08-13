import { beforeEach, describe, expect, it, vi } from 'vitest'
import { databaseDouble } from '../../test/fluent-db'

const mocks = vi.hoisted(() => ({
  databases: [] as unknown[],
  contexts: [] as unknown[],
  scheduleObservation: vi.fn(),
  transaction: vi.fn(async (context: unknown, callback: (db: unknown) => unknown) => {
    mocks.contexts.push(context)
    return callback(mocks.databases.shift())
  }),
}))

vi.mock('@/db/transactions', () => ({ withTenantTransaction: mocks.transaction }))
vi.mock('@/lib/mutation-observations', () => ({ scheduleMutationObservationWithDatabase: mocks.scheduleObservation }))

import {
  addGoogleApprovalComment,
  completeGoogleMutationExecution,
  createAtomicGoogleApprovalBatch,
  createGoogleApprovalRequest,
  createGoogleMutationExecution,
  deleteWorkspaceGoogleConnection,
  failGoogleMutationExecution,
  loadAtomicGoogleApprovalSources,
  markGoogleApprovalDrifted,
  markGoogleMutationSubmitted,
  rejectGoogleApproval,
  voteAndClaimGoogleApproval,
  type GoogleApprovalClient,
  type GoogleApprovalRecord,
} from './google-approval-management'

const workspaceId = '00000000-0000-4000-8000-000000000001'
const clientId = '00000000-0000-4000-8000-000000000002'
const approvalId = '00000000-0000-4000-8000-000000000003'
const secondApprovalId = '00000000-0000-4000-8000-000000000004'
const executionId = '00000000-0000-4000-8000-000000000005'
const connectionId = '00000000-0000-4000-8000-000000000006'
const actorUserId = 'user-1'
const now = new Date('2026-08-12T08:00:00.000Z')

function approvalDatabase(input: {
  statementResults?: unknown[]
  approval?: unknown
} = {}) {
  return databaseDouble({
    statementResults: input.statementResults,
    query: { approvalRequests: { findFirst: vi.fn(async () => input.approval) } },
  })
}

function pending(overrides: Record<string, unknown> = {}) {
  return {
    id: approvalId,
    workspaceId,
    clientId,
    requestedBy: 'requester-1',
    kind: 'campaign_status',
    title: 'Pause campaign',
    payload: { campaignId: '123' },
    expectedState: { status: 'ENABLED' },
    proposedState: { status: 'PAUSED' },
    impactPreview: null,
    observationWindowDays: 7,
    resourceName: 'customers/1/campaigns/123',
    expectedStateHash: 'hash',
    requiredApprovals: 1,
    validationRequestId: 'validate-1',
    executionRequestId: null,
    status: 'pending',
    executionState: 'pending',
    reconciliationState: 'not_required',
    expiresAt: new Date('2026-08-13T08:00:00.000Z'),
    ...overrides,
  }
}

const draft = {
  clientId,
  kind: 'campaign_status',
  title: 'Pause campaign',
  payload: { campaignId: '123', status: 'PAUSED' },
  resourceName: 'customers/1/campaigns/123',
  expectedState: { status: 'ENABLED' },
  proposedState: { status: 'PAUSED' },
  impactPreview: undefined,
  observationWindowDays: 7,
  requiredApprovals: 1,
  validationRequestId: 'validate-1',
}

describe('Google approval management', () => {
  beforeEach(() => {
    mocks.databases = []
    mocks.contexts = []
    vi.clearAllMocks()
  })

  it('creates an expiring approval with immutable state hash and audit evidence', async () => {
    const created = pending()
    const database = approvalDatabase({ statementResults: [[created]] })
    mocks.databases.push(database.db)
    await expect(createGoogleApprovalRequest({ workspaceId, actorUserId, ...draft, now })).resolves.toEqual(created)
    expect(database.capture.values[0]).toMatchObject({
      workspaceId, requestedBy: actorUserId, expiresAt: new Date('2026-08-13T08:00:00.000Z'),
      expectedStateHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    })
    expect(database.capture.values[1]).toMatchObject({ action: 'approval.requested', entityId: approvalId })
  })

  it('fails closed when approval insertion returns no row', async () => {
    mocks.databases.push(approvalDatabase({ statementResults: [[]] }).db)
    await expect(createGoogleApprovalRequest({ workspaceId, actorUserId, ...draft, now })).rejects.toThrow('création de la demande')
  })

  it('loads only complete, unvoted, same-client and unexpired atomic batch sources', async () => {
    const left = pending()
    const right = pending({ id: secondApprovalId })
    mocks.databases.push(approvalDatabase({ statementResults: [[[right, left][0], [right, left][1]], []] }).db)
    await expect(loadAtomicGoogleApprovalSources({
      workspaceId, actorUserId, approvalIds: [approvalId, secondApprovalId], now,
    })).resolves.toEqual([left, right])

    mocks.databases.push(
      approvalDatabase({ statementResults: [[left], []] }).db,
      approvalDatabase({ statementResults: [[left, right], [{ id: 'vote' }]] }).db,
      approvalDatabase({ statementResults: [[left, { ...right, clientId: secondApprovalId }], []] }).db,
      approvalDatabase({ statementResults: [[left, { ...right, expiresAt: now }], []] }).db,
    )
    const input = { workspaceId, actorUserId, approvalIds: [approvalId, secondApprovalId], now }
    await expect(loadAtomicGoogleApprovalSources(input)).rejects.toThrow('introuvable')
    await expect(loadAtomicGoogleApprovalSources(input)).rejects.toThrow('déjà reçu un vote')
    await expect(loadAtomicGoogleApprovalSources(input)).rejects.toThrow('même client')
    await expect(loadAtomicGoogleApprovalSources(input)).rejects.toThrow('expiré')
  })

  it('creates an atomic batch and claims every source with compare-and-set', async () => {
    const batch = pending({ id: secondApprovalId, kind: 'atomic_change_batch' })
    const database = approvalDatabase({ statementResults: [[batch], [{ id: approvalId }, { id: secondApprovalId }]] })
    mocks.databases.push(database.db)
    await createAtomicGoogleApprovalBatch({
      workspaceId, actorUserId, ...draft, kind: 'atomic_change_batch', sourceApprovalIds: [approvalId, secondApprovalId],
      operationCount: 2, now,
    })
    expect(database.capture.sets[0]).toMatchObject({ status: 'batched', executionState: 'batched', updatedAt: now })
    expect(database.capture.values[1]).toMatchObject({ action: 'approval.atomic_batch_requested', entityId: secondApprovalId })
  })

  it('rolls back an atomic batch if insertion fails or a source changed', async () => {
    mocks.databases.push(
      approvalDatabase({ statementResults: [[]] }).db,
      approvalDatabase({ statementResults: [[pending()], [{ id: approvalId }]] }).db,
    )
    const input = {
      workspaceId, actorUserId, ...draft, kind: 'atomic_change_batch',
      sourceApprovalIds: [approvalId, secondApprovalId], operationCount: 2, now,
    }
    await expect(createAtomicGoogleApprovalBatch(input)).rejects.toThrow('création du batch')
    await expect(createAtomicGoogleApprovalBatch(input)).rejects.toThrow('a changé')
  })

  it('expires before voting and enforces the self-approval policy', async () => {
    const expiredDb = approvalDatabase({ statementResults: [[pending({ expiresAt: new Date('2026-08-12T07:59:59.000Z') })]] })
    const selfDb = approvalDatabase({ statementResults: [[pending({ requestedBy: actorUserId })]] })
    mocks.databases.push(expiredDb.db, selfDb.db)
    const input = { workspaceId, actorUserId, approvalId, allowSelfApproval: false, assertKindAllowed: vi.fn(), now }
    await expect(voteAndClaimGoogleApproval(input)).resolves.toEqual({ outcome: 'expired' })
    expect(expiredDb.capture.sets[0]).toMatchObject({ status: 'expired', executionState: 'failed' })
    await expect(voteAndClaimGoogleApproval(input)).rejects.toThrow('auto-approbation')
  })

  it('records a partial vote or atomically claims the final approval', async () => {
    const waitingDb = approvalDatabase({ statementResults: [[pending({ requiredApprovals: 2 })], [{ id: 'vote-1' }], [{ count: 1 }]] })
    const claimed = pending({ status: 'executing', executionState: 'claimed' })
    const claimedDb = approvalDatabase({ statementResults: [[pending()], [{ id: 'vote-2' }], [{ count: 1 }], [claimed]] })
    mocks.databases.push(waitingDb.db, claimedDb.db)
    const input = { workspaceId, actorUserId, approvalId, allowSelfApproval: true, assertKindAllowed: vi.fn(), now }
    await expect(voteAndClaimGoogleApproval(input)).resolves.toEqual({ outcome: 'waiting', message: 'Approbation enregistrée (1/2).' })
    expect(waitingDb.capture.values).toContainEqual(expect.objectContaining({ action: 'approval.vote_recorded' }))
    await expect(voteAndClaimGoogleApproval(input)).resolves.toEqual({ outcome: 'claimed', claimed })
    expect(claimedDb.capture.sets[0]).toMatchObject({ status: 'executing', executionState: 'claimed' })
  })

  it('rejects missing requests, unsupported kinds, duplicate votes and lost claims', async () => {
    mocks.databases.push(
      approvalDatabase({ statementResults: [[]] }).db,
      approvalDatabase({ statementResults: [[pending({ kind: 'unsupported' })]] }).db,
      approvalDatabase({ statementResults: [[pending()], []] }).db,
      approvalDatabase({ statementResults: [[pending()], [{ id: 'vote' }], [{ count: 1 }], []] }).db,
    )
    const base = { workspaceId, actorUserId, approvalId, allowSelfApproval: true, now }
    await expect(voteAndClaimGoogleApproval({ ...base, assertKindAllowed: vi.fn() })).rejects.toThrow('déjà été traitée')
    await expect(voteAndClaimGoogleApproval({ ...base, assertKindAllowed: () => { throw new Error('unsupported') } })).rejects.toThrow('unsupported')
    await expect(voteAndClaimGoogleApproval({ ...base, assertKindAllowed: vi.fn() })).rejects.toThrow('déjà voté')
    await expect(voteAndClaimGoogleApproval({ ...base, assertKindAllowed: vi.fn() })).rejects.toThrow('déjà été traitée')
  })

  it('marks drift only from the executing state', async () => {
    const success = approvalDatabase({ statementResults: [[{ id: approvalId }]] })
    const lost = approvalDatabase({ statementResults: [[]] })
    mocks.databases.push(success.db, lost.db)
    await expect(markGoogleApprovalDrifted({ workspaceId, actorUserId, approvalId, now })).resolves.toEqual({ id: approvalId })
    await expect(markGoogleApprovalDrifted({ workspaceId, actorUserId, approvalId, now })).rejects.toThrow('ne peut plus')
  })

  it('numbers mutation attempts and requires an inserted execution row', async () => {
    const success = approvalDatabase({ statementResults: [[{ count: 2 }], [{ id: executionId }]] })
    const failure = approvalDatabase({ statementResults: [[{ count: 0 }], []] })
    mocks.databases.push(success.db, failure.db)
    await expect(createGoogleMutationExecution({ workspaceId, actorUserId, approvalId })).resolves.toEqual({ id: executionId })
    expect(success.capture.values[0]).toMatchObject({ approvalId, attempt: 3, state: 'claimed' })
    await expect(createGoogleMutationExecution({ workspaceId, actorUserId, approvalId })).rejects.toThrow('tentative de mutation')
  })

  it('persists validated then submitted states with strict compare-and-set', async () => {
    const success = approvalDatabase({ statementResults: [[{ id: executionId }], [{ id: executionId }]] })
    const validationLost = approvalDatabase({ statementResults: [[]] })
    const submissionLost = approvalDatabase({ statementResults: [[{ id: executionId }], []] })
    mocks.databases.push(success.db, validationLost.db, submissionLost.db)
    const input = { workspaceId, actorUserId, executionId, validationRequestId: 'validate-2', now }
    await expect(markGoogleMutationSubmitted(input)).resolves.toBeUndefined()
    expect(success.capture.sets).toEqual([
      { state: 'validated', validationRequestId: 'validate-2', updatedAt: now },
      { state: 'submitted', submittedAt: now, updatedAt: now },
    ])
    await expect(markGoogleMutationSubmitted(input)).rejects.toThrow('ne peut plus être validée')
    await expect(markGoogleMutationSubmitted(input)).rejects.toThrow('ne peut plus être soumise')
  })

  it('finalizes confirmed mutations and schedules post-mutation observation', async () => {
    const database = approvalDatabase({ statementResults: [[{ id: approvalId }], [{ id: executionId }]] })
    mocks.databases.push(database.db)
    const approval = pending({ status: 'executing' }) as unknown as GoogleApprovalRecord
    const client = { id: clientId, timezone: 'Europe/Paris' } as unknown as GoogleApprovalClient
    await completeGoogleMutationExecution({
      workspaceId, actorUserId, approval, client, executionId, confirmed: true,
      reconciledState: { status: 'PAUSED' }, executionRequestId: 'mutate-1', executionValidationRequestId: 'validate-2', now,
    })
    expect(database.capture.sets[0]).toMatchObject({ status: 'executed', executionState: 'confirmed', executedAt: now })
    expect(database.capture.sets[1]).toMatchObject({ state: 'confirmed', googleRequestId: 'mutate-1', confirmedAt: now })
    expect(database.capture.values[0]).toMatchObject({ action: 'approval.executed' })
    expect(mocks.scheduleObservation).toHaveBeenCalledWith(database.db, { approval, client, executedAt: now })
  })

  it('records ambiguous completion without scheduling observation and fails closed on lost CAS', async () => {
    const ambiguousDb = approvalDatabase({ statementResults: [[{ id: approvalId }], [{ id: executionId }]] })
    const approvalLost = approvalDatabase({ statementResults: [[]] })
    const executionLost = approvalDatabase({ statementResults: [[{ id: approvalId }], []] })
    mocks.databases.push(ambiguousDb.db, approvalLost.db, executionLost.db)
    const approval = pending({ status: 'executing' }) as unknown as GoogleApprovalRecord
    const client = { id: clientId, timezone: 'Europe/Paris' } as unknown as GoogleApprovalClient
    const input = {
      workspaceId, actorUserId, approval, client, executionId, confirmed: false,
      reconciledState: { status: 'ENABLED' }, executionRequestId: null, executionValidationRequestId: 'validate-2', now,
    }
    await completeGoogleMutationExecution(input)
    expect(ambiguousDb.capture.values[0]).toMatchObject({ action: 'approval.execution_ambiguous' })
    expect(mocks.scheduleObservation).not.toHaveBeenCalled()
    await expect(completeGoogleMutationExecution(input)).rejects.toThrow('approbation ne peut plus')
    await expect(completeGoogleMutationExecution(input)).rejects.toThrow('tentative de mutation ne peut plus')
  })

  it('classifies execution failures without overwriting non-executing approvals', async () => {
    const database = approvalDatabase()
    mocks.databases.push(database.db)
    await failGoogleMutationExecution({
      workspaceId, actorUserId, approvalId, executionId, ambiguous: true, errorMessage: 'timeout', now,
    })
    expect(database.capture.sets[0]).toMatchObject({ state: 'ambiguous', errorMessage: 'timeout' })
    expect(database.capture.sets[1]).toMatchObject({ status: 'ambiguous', reconciliationState: 'pending' })
  })

  it('rejects and comments on tenant approvals with audit evidence', async () => {
    const rejected = approvalDatabase({ statementResults: [[pending({ status: 'rejected' })]] })
    const comment = approvalDatabase({ approval: { id: approvalId } })
    const missingComment = approvalDatabase()
    mocks.databases.push(rejected.db, comment.db, missingComment.db)
    await rejectGoogleApproval({ workspaceId, actorUserId, approvalId, now })
    expect(rejected.capture.values[0]).toMatchObject({ action: 'approval.rejected' })
    await addGoogleApprovalComment({ workspaceId, actorUserId, approvalId, body: 'Looks good' })
    expect(comment.capture.values).toEqual(expect.arrayContaining([
      expect.objectContaining({ approvalId, authorUserId: actorUserId, body: 'Looks good' }),
      expect.objectContaining({ action: 'approval.comment_added' }),
    ]))
    await expect(addGoogleApprovalComment({ workspaceId, actorUserId, approvalId, body: 'x' })).rejects.toThrow('introuvable')
  })

  it('rejects already processed approvals and deletes only the scoped Google connection', async () => {
    mocks.databases.push(approvalDatabase({ statementResults: [[]] }).db)
    await expect(rejectGoogleApproval({ workspaceId, actorUserId, approvalId, now })).rejects.toThrow('déjà été traitée')

    const database = approvalDatabase()
    mocks.databases.push(database.db)
    await deleteWorkspaceGoogleConnection({ workspaceId, actorUserId, connectionId, managerCustomerId: '123-456-7890' })
    expect(database.capture.values[0]).toMatchObject({
      action: 'google_ads.disconnected', entityId: connectionId, metadata: { managerCustomerId: '123-456-7890' },
    })
  })
})
