import { beforeEach, describe, expect, it, vi } from 'vitest'
import { databaseDouble } from '../../test/fluent-db'

const mocks = vi.hoisted(() => ({
  databases: [] as unknown[],
  contexts: [] as unknown[],
  transaction: vi.fn(async (context: unknown, callback: (db: unknown) => unknown) => {
    mocks.contexts.push(context)
    return callback(mocks.databases.shift())
  }),
  systemTransaction: vi.fn(async (callback: (db: unknown) => unknown) => callback(mocks.databases.shift())),
}))

vi.mock('@/db/transactions', () => ({
  withTenantTransaction: mocks.transaction,
  withSystemTransaction: mocks.systemTransaction,
}))
vi.mock('@/lib/workspace-actor-guard', () => ({ withWorkspaceActorTransaction: (context: unknown, callback: (db: unknown) => unknown) => mocks.transaction(context, callback) }))
vi.mock('@/lib/crypto', () => ({ encryptSecret: (value: string) => `encrypted:${value}` }))

import {
  claimWorkspaceDeletionCancellation,
  createWorkspaceExportRequest,
  finalizeWorkspaceDeletionCancellation,
  markWorkspaceDeletionPending,
} from './workspace-lifecycle-management'

const workspaceId = '00000000-0000-4000-8000-000000000001'
const requestId = '00000000-0000-4000-8000-000000000002'
const exportId = '00000000-0000-4000-8000-000000000003'
const actorUserId = 'user-1'
const now = new Date('2026-08-12T08:00:00.000Z')
const cancellation = { id: requestId, previousAccessState: 'active', status: 'cancelling', purgeAt: new Date('2026-09-11') }

function lifecycleDatabase(input: {
  statementResults?: unknown[]
  exportJob?: unknown
  deletionRequest?: unknown
  accessState?: string
  clocks?: Date[]
} = {}) {
  const result = databaseDouble({
    statementResults: input.statementResults,
    query: {
      workspaces: { findFirst: vi.fn(async () => ({ accessState: input.accessState ?? 'active' })) },
      exportJobs: { findFirst: vi.fn(async () => input.exportJob) },
      deletionRequests: { findFirst: vi.fn(async () => input.deletionRequest) },
    },
  })
  const clocks = [...(input.clocks ?? [now])]
  result.db.execute = vi.fn(async () => ({ rows: [{ now: clocks.length > 1 ? clocks.shift() : clocks[0] }] })) as unknown as typeof result.db.execute
  return result
}

describe('workspace lifecycle management', () => {
  beforeEach(() => {
    mocks.databases = []
    mocks.contexts = []
    vi.clearAllMocks()
  })

  it('serializes, creates and audits an export request', async () => {
    const database = lifecycleDatabase({ statementResults: [[{ id: exportId }]] })
    mocks.databases.push(database.db)
    await expect(createWorkspaceExportRequest({ workspaceId, actorUserId })).resolves.toEqual({ id: exportId })
    expect(database.capture.values[0]).toMatchObject({ workspaceId, requestedBy: actorUserId })
    expect(database.capture.values[1]).toMatchObject({
      action: 'workspace.export_requested', entityId: exportId, metadata: { retentionDays: 7 },
    })
  })

  it('rejects duplicate and failed export creation', async () => {
    mocks.databases.push(
      lifecycleDatabase({ statementResults: [[]], exportJob: { id: exportId } }).db,
      lifecycleDatabase({ statementResults: [[]] }).db,
    )
    await expect(createWorkspaceExportRequest({ workspaceId, actorUserId })).rejects.toThrow('export est déjà en cours')
    await expect(createWorkspaceExportRequest({ workspaceId, actorUserId })).rejects.toThrow('création de l’export')
  })

  it('claims deletion state before revoking every tenant access path', async () => {
    const database = lifecycleDatabase({ statementResults: [[{ id: workspaceId }]] })
    const cleanup = lifecycleDatabase()
    mocks.databases.push(database.db, cleanup.db)
    const result = await markWorkspaceDeletionPending({
      workspaceId,
      actorUserId,
      previousAccessState: 'active',
      googleRevocationConfirmed: true,
      stripeCancellationQueued: false,
      now,
    })
    expect(result).toEqual({ requestedAt: now, purgeAt: new Date('2026-09-11T08:00:00.000Z') })
    expect(database.capture.sets[0]).toMatchObject({
      accessState: 'deletion_pending', mutationsEnabled: false, deletionRequestedAt: now,
    })
    expect(database.capture.sets).toEqual(expect.arrayContaining([
      expect.objectContaining({ revokedAt: now }),
      expect.objectContaining({ active: false, expiresAt: now }),
      expect.objectContaining({
        enabled: false,
        encryptedDestination: 'encrypted:revoked',
        destinationHint: 'revoked',
      }),
      expect.objectContaining({ mentionNotifications: false, digestCadence: 'none' }),
      expect.objectContaining({ status: 'cancelled', leaseOwner: null }),
    ]))
    expect(database.capture.values).toContainEqual(expect.objectContaining({
      action: 'workspace.deletion_requested',
      metadata: expect.objectContaining({ googleRevocationConfirmed: true, stripeCancellationQueued: false }),
    }))
    expect(mocks.systemTransaction).toHaveBeenCalledOnce()
  })

  it('fails closed before revocations when workspace lifecycle CAS loses', async () => {
    const database = lifecycleDatabase({ statementResults: [[]] })
    mocks.databases.push(database.db)
    await expect(markWorkspaceDeletionPending({
      workspaceId, actorUserId, previousAccessState: 'active', googleRevocationConfirmed: false,
      stripeCancellationQueued: true, now,
    })).rejects.toThrow('état de l’espace a changé')
    expect(database.capture.sets).toHaveLength(1)
  })

  it('atomically claims a pending deletion cancellation before purge', async () => {
    const request = { id: requestId, previousAccessState: 'active', status: 'cancelling', purgeAt: new Date('2026-09-11') }
    const database = lifecycleDatabase({ statementResults: [[request]], accessState: 'deletion_pending', deletionRequest: { ...request, status: 'pending' } })
    mocks.databases.push(database.db)
    await expect(claimWorkspaceDeletionCancellation({ workspaceId, actorUserId, now })).resolves.toEqual(request)
    expect(database.capture.sets[0]).toEqual({ status: 'cancelling' })
  })

  it('resumes a previously claimed cancellation after a provider failure', async () => {
    const request = { id: requestId, previousAccessState: 'active', status: 'cancelling', purgeAt: new Date('2026-09-11') }
    const database = lifecycleDatabase({ statementResults: [[]], deletionRequest: request, accessState: 'deletion_pending' })
    mocks.databases.push(database.db)
    await expect(claimWorkspaceDeletionCancellation({ workspaceId, actorUserId, now })).resolves.toEqual(request)
  })

  it('rejects cancellation after purge claim or deadline', async () => {
    mocks.databases.push(lifecycleDatabase({ statementResults: [[]], accessState: 'deletion_pending' }).db)
    await expect(claimWorkspaceDeletionCancellation({ workspaceId, actorUserId, now }))
      .rejects.toThrow('ne peut plus être annulée')
  })

  it('restores lifecycle and finalizes only a claimed cancellation', async () => {
    const database = lifecycleDatabase({ statementResults: [[{ id: workspaceId }], [{ id: requestId }]], accessState: 'deletion_pending', deletionRequest: cancellation })
    mocks.databases.push(database.db)
    await finalizeWorkspaceDeletionCancellation({
      workspaceId, actorUserId, requestId, previousAccessState: 'active', now,
    })
    expect(database.capture.sets[0]).toMatchObject({
      accessState: 'active', deletionRequestedAt: null, purgeAt: null, updatedAt: now,
    })
    expect(database.capture.sets[1]).toEqual({ status: 'cancelled', cancelledAt: now })
    expect(database.capture.values[0]).toMatchObject({
      action: 'workspace.deletion_cancelled',
      metadata: { googleReconnectRequired: true, apiKeysRemainRevoked: true },
    })
  })

  it('rolls back finalization when workspace or request CAS loses', async () => {
    mocks.databases.push(
      lifecycleDatabase({ statementResults: [[]], accessState: 'deletion_pending', deletionRequest: cancellation }).db,
      lifecycleDatabase({ statementResults: [[{ id: workspaceId }], []], accessState: 'deletion_pending', deletionRequest: cancellation }).db,
    )
    const input = { workspaceId, actorUserId, requestId, previousAccessState: 'active' as const, now }
    await expect(finalizeWorkspaceDeletionCancellation(input)).rejects.toThrow('ne peut plus être restauré')
    await expect(finalizeWorkspaceDeletionCancellation(input)).rejects.toThrow('n’est plus en cours')
  })

  it.each(['internal', 'deletion_pending', 'deleted'])('refuses a new deletion in %s before writing', async (accessState) => {
    const database = lifecycleDatabase({ accessState })
    mocks.databases.push(database.db)
    await expect(markWorkspaceDeletionPending({ workspaceId, actorUserId, previousAccessState: 'active', googleRevocationConfirmed: false, stripeCancellationQueued: false })).rejects.toThrow()
    expect(database.capture.sets).toHaveLength(0)
  })

  it('rejects a deleted workspace export before creating a job', async () => {
    const database = lifecycleDatabase({ accessState: 'deleted' })
    mocks.databases.push(database.db)
    await expect(createWorkspaceExportRequest({ workspaceId, actorUserId })).rejects.toThrow('indisponible')
    expect(database.capture.values).toHaveLength(0)
  })

  it('uses the database clock for a new deletion after acquiring its locks', async () => {
    const database = lifecycleDatabase({ statementResults: [[{ id: workspaceId }]], clocks: [now] })
    mocks.databases.push(database.db, lifecycleDatabase().db)
    const result = await markWorkspaceDeletionPending({ workspaceId, actorUserId, previousAccessState: 'active', googleRevocationConfirmed: false, stripeCancellationQueued: true })
    expect(result.requestedAt).toEqual(now)
    expect(result.purgeAt.getTime() - now.getTime()).toBe(30 * 24 * 60 * 60_000)
    expect(mocks.contexts[0]).toMatchObject({ permission: 'workspace:delete', workspaceId, actorUserId })
  })

  it('refuses acceptance after a lock wait even with a caller timestamp in the past', async () => {
    const database = lifecycleDatabase({ accessState: 'deletion_pending', deletionRequest: { ...cancellation, status: 'pending', purgeAt: now } })
    mocks.databases.push(database.db)
    await expect(claimWorkspaceDeletionCancellation({ workspaceId, actorUserId, now: new Date('2000-01-01') })).rejects.toThrow('ne peut plus')
    expect(database.capture.sets).toHaveLength(0)
  })

  it('rejects an acceptance whose update crosses the deadline', async () => {
    const database = lifecycleDatabase({ accessState: 'deletion_pending', deletionRequest: { ...cancellation, status: 'pending' }, statementResults: [[cancellation]], clocks: [now, cancellation.purgeAt] })
    mocks.databases.push(database.db)
    await expect(claimWorkspaceDeletionCancellation({ workspaceId, actorUserId })).rejects.toThrow('ne peut plus')
  })

  it('resumes an already accepted cancellation after the original deadline', async () => {
    const database = lifecycleDatabase({ accessState: 'deletion_pending', deletionRequest: cancellation, clocks: [new Date('2027-01-01')] })
    mocks.databases.push(database.db)
    await expect(claimWorkspaceDeletionCancellation({ workspaceId, actorUserId })).resolves.toEqual(cancellation)
    expect(database.capture.sets).toHaveLength(0)
  })

  it.each(['internal', 'deleted', 'suspended'])('rejects a forged restoration state %s', async (previousAccessState) => {
    const database = lifecycleDatabase({ accessState: 'deletion_pending', deletionRequest: cancellation })
    mocks.databases.push(database.db)
    await expect(finalizeWorkspaceDeletionCancellation({ workspaceId, actorUserId, requestId, previousAccessState: previousAccessState as 'internal' | 'deleted' | 'suspended' })).rejects.toThrow('restauration')
    expect(database.capture.sets).toHaveLength(0)
  })

  it('does not finalize a different or unclaimed deletion request', async () => {
    for (const request of [{ ...cancellation, id: exportId }, { ...cancellation, status: 'pending' }]) {
      const database = lifecycleDatabase({ accessState: 'deletion_pending', deletionRequest: request })
      mocks.databases.push(database.db)
      await expect(finalizeWorkspaceDeletionCancellation({ workspaceId, actorUserId, requestId, previousAccessState: 'active' })).rejects.toThrow('en cours d’annulation')
      expect(database.capture.sets).toHaveLength(0)
    }
  })

})
