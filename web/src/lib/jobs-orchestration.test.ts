import { beforeEach, describe, expect, it, vi } from 'vitest'
import { databaseDouble } from '../../test/fluent-db'

const transactionMock = vi.hoisted(() => ({
  databases: [] as unknown[],
  run: vi.fn(async (callback: (db: unknown) => unknown) => callback(transactionMock.databases.shift())),
}))

vi.mock('@/db/transactions', () => ({ withSystemTransaction: transactionMock.run }))

import {
  claimNextJob,
  completeJob,
  enqueueJob,
  enqueueJobs,
  failJob,
  type ClaimedJob,
} from './jobs'

function queuedJob(overrides: Partial<ClaimedJob> = {}): ClaimedJob {
  return {
    id: '00000000-0000-4000-8000-000000000001', workspaceId: null, type: 'monitoring.scan', payload: {},
    priority: 100, status: 'queued', availableAt: new Date('2026-08-12T00:00:00Z'), leaseOwner: null,
    leaseExpiresAt: null, attemptCount: 0, maximumAttempts: 5, deduplicationKey: 'job:1', lastError: null,
    deadLetteredAt: null, completedAt: null, createdAt: new Date('2026-08-12T00:00:00Z'),
    updatedAt: new Date('2026-08-12T00:00:00Z'), ...overrides,
  }
}

describe('durable job orchestration', () => {
  beforeEach(() => {
    transactionMock.databases = []
    transactionMock.run.mockClear()
  })

  it('inserts a new job and resolves a concurrent duplicate', async () => {
    const created = queuedJob()
    const first = databaseDouble({ statementResults: [[created]] })
    transactionMock.databases.push(first.db)
    await expect(enqueueJob({ type: 'monitoring.scan', deduplicationKey: 'job:1' })).resolves.toEqual({ job: created, created: true })
    expect(first.capture.values[0]).toMatchObject({ type: 'monitoring.scan', priority: 100, maximumAttempts: 5 })

    const duplicate = databaseDouble({ statementResults: [[], [created]] })
    transactionMock.databases.push(duplicate.db)
    await expect(enqueueJob({ type: 'monitoring.scan', deduplicationKey: 'job:1' })).resolves.toEqual({ job: created, created: false })
  })

  it('rejects invalid deduplication and unresolved duplicate states', async () => {
    await expect(enqueueJob({ type: 'monitoring.scan', deduplicationKey: 'x'.repeat(241) })).rejects.toThrow('too long')
    const unresolved = databaseDouble({ statementResults: [[], []] })
    transactionMock.databases.push(unresolved.db)
    await expect(enqueueJob({ type: 'monitoring.scan', deduplicationKey: 'missing' })).rejects.toThrow('resolve deduplicated')
  })

  it('bulk-enqueues jobs with defaults and handles an empty request', async () => {
    await expect(enqueueJobs([])).resolves.toEqual({ requested: 0, created: 0 })
    await expect(enqueueJobs([{ type: 'retention.run', deduplicationKey: 'x'.repeat(241) }])).rejects.toThrow('too long')
    const bulk = databaseDouble({ statementResults: [[{ id: '1' }, { id: '2' }]] })
    transactionMock.databases.push(bulk.db)
    await expect(enqueueJobs([
      { type: 'retention.run', deduplicationKey: 'retention:1' },
      { type: 'secrets.rotate', deduplicationKey: 'secrets:1', priority: 10, maximumAttempts: 2 },
    ])).resolves.toEqual({ requested: 2, created: 2 })
    expect(bulk.capture.values[0]).toHaveLength(2)
  })

  it('claims a due job with a lease and records its attempt', async () => {
    const now = new Date('2026-08-12T10:00:00Z')
    const candidate = queuedJob()
    const claimed = queuedJob({ status: 'running', leaseOwner: 'worker-1', attemptCount: 1, leaseExpiresAt: new Date('2026-08-12T10:05:00Z') })
    const database = databaseDouble({ statementResults: [[candidate], [claimed], []] })
    transactionMock.databases.push(database.db)
    await expect(claimNextJob('worker-1', now, 300_000, ['notification.deliver'])).resolves.toEqual(claimed)
    expect(database.capture.sets[0]).toMatchObject({ status: 'running', leaseOwner: 'worker-1', leaseExpiresAt: new Date('2026-08-12T10:05:00Z') })
    expect(database.capture.values[0]).toMatchObject({ jobId: claimed.id, attempt: 1, workerId: 'worker-1' })
  })

  it('rejects invalid workers and returns null when no work can be claimed', async () => {
    await expect(claimNextJob('')).rejects.toThrow('Invalid worker ID')
    const database = databaseDouble({ statementResults: [[]] })
    transactionMock.databases.push(database.db)
    await expect(claimNextJob('worker-1')).resolves.toBeNull()
  })

  it('completes only a job owned by the current worker', async () => {
    const job = queuedJob({ status: 'running', leaseOwner: 'worker-1', attemptCount: 1 })
    const success = databaseDouble({ statementResults: [[{ id: job.id }], []] })
    transactionMock.databases.push(success.db)
    await expect(completeJob(job, 'worker-1', new Date('2026-08-12T10:02:00Z'), 'message-1')).resolves.toBe(true)
    expect(success.capture.sets[0]).toMatchObject({ status: 'completed', leaseOwner: null, lastError: null })
    expect(success.capture.sets[1]).toMatchObject({ state: 'completed', providerMessageId: 'message-1' })

    const lostLease = databaseDouble({ statementResults: [[]] })
    transactionMock.databases.push(lostLease.db)
    await expect(completeJob(job, 'worker-2')).resolves.toBe(false)
  })

  it('retries with backoff and dead-letters terminal failures', async () => {
    const now = new Date('2026-08-12T10:00:00Z')
    const job = queuedJob({ status: 'running', leaseOwner: 'worker-1', attemptCount: 2 })
    const retry = databaseDouble({ statementResults: [[{ id: job.id }], []] })
    transactionMock.databases.push(retry.db)
    await expect(failJob(job, 'worker-1', new Error('temporary'), { now })).resolves.toMatchObject({
      updated: true, deadLettered: false, nextAttemptAt: new Date('2026-08-12T10:05:00Z'),
    })
    expect(retry.capture.sets[0]).toMatchObject({ status: 'retrying', lastError: 'temporary' })

    const terminalJob = queuedJob({ status: 'running', leaseOwner: 'worker-1', attemptCount: 5 })
    const terminal = databaseDouble({ statementResults: [[{ id: terminalJob.id }], []] })
    transactionMock.databases.push(terminal.db)
    await expect(failJob(terminalJob, 'worker-1', 'fatal', { now })).resolves.toEqual({ updated: true, deadLettered: true, nextAttemptAt: null })
    expect(terminal.capture.sets[0]).toMatchObject({ status: 'dead_letter', lastError: 'fatal', deadLetteredAt: now })

    const stale = databaseDouble({ statementResults: [[]] })
    transactionMock.databases.push(stale.db)
    await expect(failJob(job, 'other', 'lost', { forceDeadLetter: true, now })).resolves.toEqual({ updated: false, deadLettered: true })
  })
})
