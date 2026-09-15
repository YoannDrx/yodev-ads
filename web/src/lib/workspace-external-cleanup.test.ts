import { beforeEach, describe, expect, it, vi } from 'vitest'
import { databaseDouble } from '../../test/fluent-db'
import { jobs, workspaceDomainCleanupReservations } from '@/db/schema'
import type { ClaimedJob } from '@/lib/jobs'

const mocks = vi.hoisted(() => ({ database: undefined as unknown, del: vi.fn(), remove: vi.fn() }))
vi.mock('@/db/transactions', () => ({
  withSystemTransaction: (callback: (db: unknown) => unknown) => callback(mocks.database),
  withPurgeTransaction: vi.fn(),
}))
vi.mock('@vercel/blob', async (original) => ({ ...await original<typeof import('@vercel/blob')>(), del: mocks.del }))
vi.mock('@/lib/domain-cleanup-receipts', () => ({ DomainCleanupAttemptUnresolved: class extends Error {}, removeDomainWithCleanupReceipt: ({ hostname, admitInTransaction }: { hostname: string; admitInTransaction: (db: unknown) => Promise<void> }) => mocks.remove(hostname, () => admitInTransaction(mocks.database)) }))
import { BlobNotFoundError, BlobStoreNotFoundError } from '@vercel/blob'
import { runWorkspaceExternalCleanup } from './workspace-deletion'

const input = { workspaceHash: 'a'.repeat(64), logoUrl: 'https://store.public.blob.vercel-storage.com/logo.png', hostnames: ['reports.example.test'] }
const job = { id: '00000000-0000-4000-8000-000000000001', workspaceId: null, type: 'workspace.external_cleanup', leaseOwner: 'worker', attemptCount: 1 } as ClaimedJob

function fixture(options: { current?: boolean; payload?: unknown; completed?: boolean; clock?: boolean; reserved?: boolean; assigned?: boolean } = {}) {
  let current = options.current !== false
  const tombstone = { id: 'tombstone', externalCleanupStatus: options.completed ? 'completed' : 'pending', externalCleanupCompletedAt: options.completed ? new Date() : null }
  const database = databaseDouble()
  const select = () => ({ from: (table: unknown) => databaseDouble({ statementResults: [table === jobs
    ? (current ? [{ ...job, payload: options.payload ?? input, leaseExpiresAt: new Date(Date.now() + 60_000) }] : [])
    : table === workspaceDomainCleanupReservations ? (options.reserved === false ? [] : [{ id: 'reservation' }]) : [{ ...tombstone }]] }).db.select() })
  const update = () => ({ set: (values: Record<string, unknown>) => {
    Object.assign(tombstone, values)
    return (database.db.update() as { set: (values: unknown) => unknown }).set(values)
  } })
  mocks.database = { ...database.db, select, update, query: { workspaceDomains: { findFirst: async () => options.assigned ? { id: 'assigned' } : undefined } }, execute: async () => ({ rows: [{ active: options.clock !== false }] }) }
  return { capture: database.capture, lose: () => { current = false }, tombstone }
}

describe('external cleanup job admission and receipts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.del.mockResolvedValue(undefined)
    mocks.remove.mockImplementation(async (_hostname: string, admit: () => Promise<void>) => { await admit(); return { removed: true } })
  })

  it('records successful cleanup with repeated provider admission', async () => {
    const f = fixture()
    await expect(runWorkspaceExternalCleanup(input, job)).resolves.toMatchObject({ deletedLogo: true, removedDomains: 1 })
    expect(mocks.del).toHaveBeenCalledOnce()
    expect(mocks.remove).toHaveBeenCalledWith(input.hostnames[0], expect.any(Function))
    expect(f.capture.sets.at(-1)).toMatchObject({ externalCleanupStatus: 'completed', externalCleanupError: null })
  })

  it('reconciles an existing receipt without repeating any provider operation', async () => {
    const f = fixture({ completed: true })
    await expect(runWorkspaceExternalCleanup(input, job)).resolves.toMatchObject({ skipped: 'already_completed' })
    expect(mocks.del).not.toHaveBeenCalled(); expect(mocks.remove).not.toHaveBeenCalled(); expect(f.capture.sets).toEqual([])
  })

  it.each([{ current: false }, { clock: false }, { reserved: false }, { assigned: true }, { payload: { ...input, hostnames: ['foreign.example.test'] } }])('refuses stale job or changed payload before provider: %j', async (options) => {
    const f = fixture(options)
    await expect(runWorkspaceExternalCleanup(input, job)).rejects.toThrow()
    expect(mocks.del).not.toHaveBeenCalled(); expect(mocks.remove).not.toHaveBeenCalled(); expect(f.capture.sets).toEqual([])
  })

  it.each([{ workspaceId: 'foreign' }, { type: 'workspace.purge' }, { leaseOwner: null }])('requires the global claimed cleanup job: %j', async (override) => {
    fixture()
    await expect(runWorkspaceExternalCleanup(input, { ...job, ...override })).rejects.toThrow('claimed global job')
    expect(mocks.del).not.toHaveBeenCalled()
  })

  it('does not continue or write failure after losing the attempt during Blob deletion', async () => {
    const f = fixture(); mocks.del.mockImplementationOnce(async () => f.lose())
    await expect(runWorkspaceExternalCleanup(input, job)).rejects.toThrow('lease lost')
    expect(f.capture.sets).toHaveLength(1); expect(f.capture.sets[0]).toMatchObject({ externalCleanupStatus: 'running' })
  })

  it('does not overwrite a successor receipt after the last provider response', async () => {
    const f = fixture()
    mocks.remove.mockImplementationOnce(async (_host: string, admit: () => Promise<void>) => { await admit(); f.lose(); f.tombstone.externalCleanupStatus = 'completed' })
    await expect(runWorkspaceExternalCleanup(input, job)).rejects.toThrow('lease lost')
    expect(f.capture.sets).toHaveLength(1)
  })

  it('tolerates a typed missing Blob and confirmed domain absence', async () => {
    fixture(); mocks.del.mockRejectedValueOnce(new BlobNotFoundError())
    await expect(runWorkspaceExternalCleanup(input, job)).resolves.toMatchObject({ deletedLogo: true, removedDomains: 1 })
  })

  it.each(['domain', 'blob', 'store'])('records a safe failure for misleading %s absence', async (kind) => {
    const f = fixture()
    if (kind === 'domain') mocks.remove.mockRejectedValueOnce(new Error('404 not found private-token'))
    else mocks.del.mockRejectedValueOnce(kind === 'store' ? new BlobStoreNotFoundError() : new Error('404 not found private-token'))
    await expect(runWorkspaceExternalCleanup(input, job)).rejects.toThrow()
    expect(f.capture.sets.at(-1)).toMatchObject({ externalCleanupStatus: 'failed', externalCleanupCompletedAt: null, externalCleanupError: 'External cleanup could not be confirmed. Retry or contact support.' })
    expect(JSON.stringify(f.capture.sets)).not.toContain('private-token')
  })
})
