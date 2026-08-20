import { beforeEach, describe, expect, it, vi } from 'vitest'
import { databaseDouble } from '../../test/fluent-db'

const mocks = vi.hoisted(() => ({
  database: undefined as unknown,
  transaction: vi.fn(async (callback: (db: unknown) => unknown) => callback(mocks.database)),
}))

vi.mock('@/db/transactions', () => ({ withSystemTransaction: mocks.transaction }))

import { releaseOperationalIssues } from './release-operational-readiness'

describe('release operational readiness', () => {
  beforeEach(() => vi.clearAllMocks())

  it('is ready only when durable work and provider reconciliation queues are clear', async () => {
    mocks.database = databaseDouble({ statementResults: Array.from({ length: 6 }, () => [{ total: 0 }]) }).db
    await expect(releaseOperationalIssues(new Date('2026-08-18T12:00:00Z'))).resolves.toEqual([])
  })

  it('reports every unresolved operational family without exposing tenant details', async () => {
    mocks.database = databaseDouble({ statementResults: Array.from({ length: 6 }, (_, index) => [{ total: index + 1 }]) }).db
    await expect(releaseOperationalIssues(new Date('2026-08-18T12:00:00Z'))).resolves.toEqual([
      expect.objectContaining({ code: 'queue.dead_letters' }),
      expect.objectContaining({ code: 'queue.due_jobs' }),
      expect.objectContaining({ code: 'stripe.failed_webhooks' }),
      expect.objectContaining({ code: 'stripe.reconciliation_required' }),
      expect.objectContaining({ code: 'email.unresolved_deliveries' }),
      expect.objectContaining({ code: 'google.unresolved_mutations' }),
    ])
  })
})
