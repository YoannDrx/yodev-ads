import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { databaseDouble } from '../../test/fluent-db'
import type { ClaimedJob } from './jobs'

const mocks = vi.hoisted(() => ({ databases: [] as unknown[], remove: vi.fn() }))
vi.mock('@/db/transactions', () => ({ withSystemTransaction: (callback: (db: unknown) => unknown) => callback(mocks.databases.shift()) }))
vi.mock('@/lib/vercel-domains', () => ({ removeVercelProjectDomain: mocks.remove }))
import { DomainCleanupAttemptUnresolved, domainCleanupProviderScope, removeDomainWithCleanupReceipt } from './domain-cleanup-receipts'
const job = { id: '00000000-0000-4000-8000-000000000001', leaseOwner: 'worker', attemptCount: 1 } as ClaimedJob
const input = () => ({ hostname: 'reports.example.test', workspaceHash: 'a'.repeat(64), job, admitInTransaction: vi.fn(async () => {}) })
function claim(confirmed?: unknown, inserted = true) {
  return databaseDouble({ query: { domainCleanupAttempts: { findMany: vi.fn(async () => confirmed ? [{ ...confirmed as object, state: 'confirmed', providerScopeHash: domainCleanupProviderScope() }] : []) } }, statementResults: [inserted ? [{ id: 'attempt' }] : []] })
}

describe('durable domain cleanup receipts', () => {
  afterEach(() => vi.unstubAllEnvs())
  beforeEach(() => {
    vi.clearAllMocks(); mocks.databases = []
    mocks.remove.mockImplementation(async (_hostname: string, beforeRequest: () => Promise<void>) => { await beforeRequest(); return { name: 'reports.example.test', removed: true, alreadyAbsent: false } })
  })

  it('commits the intent before dispatch and records the confirmed result separately', async () => {
    const prepared = claim(), finished = databaseDouble({ statementResults: [[{ id: 'attempt' }]] })
    mocks.databases.push(prepared.db, {}, finished.db)
    const context = input()
    await expect(removeDomainWithCleanupReceipt(context)).resolves.toEqual({ reconciled: false, attemptId: 'attempt' })
    expect(prepared.capture.values[0]).toMatchObject({ hostname: context.hostname, workspaceHash: context.workspaceHash, jobId: job.id, jobAttempt: 1, leaseOwner: 'worker' })
    expect(finished.capture.sets[0]).toMatchObject({ state: 'confirmed', alreadyAbsent: false })
    expect(context.admitInTransaction).toHaveBeenCalledTimes(3)
  })

  it('uses a confirmed receipt without dispatching or rewriting it', async () => {
    mocks.databases.push(claim({ id: 'previous' }).db)
    await expect(removeDomainWithCleanupReceipt(input())).resolves.toEqual({ reconciled: true, attemptId: 'previous' })
    expect(mocks.remove).not.toHaveBeenCalled()
  })

  it('refuses a duplicate unresolved attempt before transport', async () => {
    mocks.databases.push(claim(undefined, false).db)
    await expect(removeDomainWithCleanupReceipt(input())).rejects.toBeInstanceOf(DomainCleanupAttemptUnresolved)
    expect(mocks.remove).not.toHaveBeenCalled()
  })

  it('distinguishes refusal before dispatch from an ambiguous submitted request', async () => {
    const finished = databaseDouble({ statementResults: [[{ id: 'attempt' }]] }), context = input()
    context.admitInTransaction.mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('Lease lost'))
    mocks.databases.push(claim().db, {}, finished.db)
    await expect(removeDomainWithCleanupReceipt(context)).rejects.toThrow('Lease lost')
    expect(finished.capture.sets[0]).toMatchObject({ state: 'not_submitted', alreadyAbsent: null })
  })

  it('records only ambiguous status for a transport failure after admission', async () => {
    const finished = databaseDouble({ statementResults: [[{ id: 'attempt' }]] })
    mocks.databases.push(claim().db, {}, finished.db)
    mocks.remove.mockImplementationOnce(async (_host: string, beforeRequest: () => Promise<void>) => { await beforeRequest(); throw new Error('private provider response') })
    await expect(removeDomainWithCleanupReceipt(input())).rejects.toThrow('private provider response')
    expect(finished.capture.sets[0]).toMatchObject({ state: 'ambiguous', alreadyAbsent: null })
    expect(JSON.stringify(finished.capture.sets)).not.toContain('private')
  })

  it('refuses a provider target changed between recording intent and transport', async () => {
    const finished = databaseDouble({ statementResults: [[{ id: 'attempt' }]] }), context = input()
    context.admitInTransaction.mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined)
      .mockImplementationOnce(async () => { vi.stubEnv('VERCEL_PROJECT_ID', 'changed-project') })
    mocks.databases.push(claim().db, {}, finished.db)
    await expect(removeDomainWithCleanupReceipt(context)).rejects.toThrow('configuration changed')
    expect(finished.capture.sets[0]).toMatchObject({ state: 'not_submitted' })
  })

  it('does not report a successful removal when its receipt could not be persisted', async () => {
    mocks.databases.push(claim().db, {}, databaseDouble().db)
    await expect(removeDomainWithCleanupReceipt(input())).rejects.toThrow('receipt could not be recorded')
  })
})
