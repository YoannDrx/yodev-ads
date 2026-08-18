import { beforeEach, describe, expect, it, vi } from 'vitest'
import { databaseDouble } from '../../test/fluent-db'

const mocks = vi.hoisted(() => ({
  databases: [] as unknown[],
  transaction: vi.fn(async (callback: (db: unknown) => unknown) => callback(mocks.databases.shift())),
}))

vi.mock('@/db/transactions', () => ({ withSystemTransaction: mocks.transaction }))

import {
  claimTransactionalEmailDelivery,
  markTransactionalEmailAccepted,
  markTransactionalEmailFailure,
} from './transactional-email-deliveries'

const now = new Date('2026-08-16T12:00:00.000Z')
const base = {
  id: '00000000-0000-4000-8000-000000000001',
  workspaceId: null,
  category: 'authentication',
  businessKey: 'magic-link:request-1',
  recipientHash: 'a'.repeat(64),
  contentHash: 'b'.repeat(64),
  providerMessageId: null,
  status: 'pending',
  attemptCount: 0,
  lastError: null,
  acceptedAt: null,
  deliveredAt: null,
  terminalAt: null,
  lastEventAt: null,
  createdAt: now,
  updatedAt: now,
}

describe('transactional email delivery registry', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.databases = []
  })

  it('claims a new logical delivery and increments its attempt atomically', async () => {
    const claimed = { ...base, status: 'submitting', attemptCount: 1 }
    const database = databaseDouble({ statementResults: [[base], [claimed]] })
    mocks.databases.push(database.db)

    await expect(claimTransactionalEmailDelivery({
      category: base.category,
      businessKey: base.businessKey,
      recipientHash: base.recipientHash,
      contentHash: base.contentHash,
      now,
    })).resolves.toEqual({ delivery: claimed, claimed: true })
    expect(database.capture.values[0]).toMatchObject({
      category: base.category,
      businessKey: base.businessKey,
      recipientHash: base.recipientHash,
      contentHash: base.contentHash,
    })
    expect(database.capture.sets[0]).toMatchObject({ status: 'submitting', lastError: null, updatedAt: now })
  })

  it('does not resubmit an accepted delivery', async () => {
    const accepted = { ...base, status: 'accepted', providerMessageId: '00000000-0000-4000-8000-000000000002' }
    const database = databaseDouble({
      statementResults: [[]],
      query: { transactionalEmailDeliveries: { findFirst: vi.fn(async () => accepted) } },
    })
    mocks.databases.push(database.db)

    await expect(claimTransactionalEmailDelivery({
      category: base.category,
      businessKey: base.businessKey,
      recipientHash: base.recipientHash,
      contentHash: base.contentHash,
      now,
    })).resolves.toEqual({ delivery: accepted, claimed: false })
    expect(database.capture.sets).toHaveLength(0)
  })

  it('does not automatically resubmit a terminal failed delivery', async () => {
    const failed = { ...base, status: 'failed', terminalAt: now, lastError: 'forbidden' }
    const database = databaseDouble({
      statementResults: [[]],
      query: { transactionalEmailDeliveries: { findFirst: vi.fn(async () => failed) } },
    })
    mocks.databases.push(database.db)

    await expect(claimTransactionalEmailDelivery({
      category: base.category,
      businessKey: base.businessKey,
      recipientHash: base.recipientHash,
      contentHash: base.contentHash,
      now,
    })).resolves.toEqual({ delivery: failed, claimed: false })
    expect(database.capture.sets).toHaveLength(0)
  })

  it('rejects reuse of a business key with different content', async () => {
    const database = databaseDouble({
      statementResults: [[]],
      query: { transactionalEmailDeliveries: { findFirst: vi.fn(async () => base) } },
    })
    mocks.databases.push(database.db)

    await expect(claimTransactionalEmailDelivery({
      category: base.category,
      businessKey: base.businessKey,
      recipientHash: base.recipientHash,
      contentHash: 'c'.repeat(64),
      now,
    })).rejects.toMatchObject({ name: 'Error', message: expect.stringContaining('idempotency key conflicts') })
  })

  it.each([
    ['recipientHash', 'c'.repeat(64)],
    ['category', 'another_category'],
  ] as const)('rejects reuse of a business key with a different %s', async (field, value) => {
    const database = databaseDouble({
      statementResults: [[]],
      query: { transactionalEmailDeliveries: { findFirst: vi.fn(async () => base) } },
    })
    mocks.databases.push(database.db)
    await expect(claimTransactionalEmailDelivery({
      category: field === 'category' ? value : base.category,
      businessKey: base.businessKey,
      recipientHash: field === 'recipientHash' ? value : base.recipientHash,
      contentHash: base.contentHash,
      now,
    })).rejects.toThrow('idempotency key conflicts')
  })

  it('fails when an insert conflict cannot be resolved', async () => {
    const database = databaseDouble({
      statementResults: [[]],
      query: { transactionalEmailDeliveries: { findFirst: vi.fn(async () => undefined) } },
    })
    mocks.databases.push(database.db)
    await expect(claimTransactionalEmailDelivery({
      category: base.category,
      businessKey: base.businessKey,
      recipientHash: base.recipientHash,
      contentHash: base.contentHash,
    })).rejects.toThrow('Unable to resolve')
  })

  it('returns the existing delivery if another worker owns a fresh submission', async () => {
    const submitting = { ...base, status: 'submitting', updatedAt: now }
    const database = databaseDouble({
      statementResults: [[], []],
      query: { transactionalEmailDeliveries: { findFirst: vi.fn(async () => submitting) } },
    })
    mocks.databases.push(database.db)
    await expect(claimTransactionalEmailDelivery({
      category: base.category,
      businessKey: base.businessKey,
      recipientHash: base.recipientHash,
      contentHash: base.contentHash,
      now,
    })).resolves.toEqual({ delivery: submitting, claimed: false })
  })

  it('records retryable, ambiguous, terminal and accepted outcomes distinctly', async () => {
    const retryable = databaseDouble()
    const ambiguous = databaseDouble()
    const terminal = databaseDouble()
    const accepted = databaseDouble()
    mocks.databases.push(retryable.db, ambiguous.db, terminal.db, accepted.db)

    await markTransactionalEmailFailure(base.id, 'pending', 'rate_limited', now)
    await markTransactionalEmailFailure(base.id, 'ambiguous', 'timeout', now)
    await markTransactionalEmailFailure(base.id, 'failed', 'forbidden', now)
    await markTransactionalEmailAccepted(base.id, '00000000-0000-4000-8000-000000000002', 'queued', now)

    expect(retryable.capture.sets[0]).toMatchObject({ status: 'pending', terminalAt: null })
    expect(ambiguous.capture.sets[0]).toMatchObject({ status: 'ambiguous', terminalAt: null })
    expect(terminal.capture.sets[0]).toMatchObject({ status: 'failed', terminalAt: now })
    expect(accepted.capture.sets[0]).toMatchObject({ status: 'accepted', acceptedAt: now, lastError: null })
  })

  it.each([
    ['delivered', 'delivered', true, null],
    ['hard_bounced', 'hard_bounced', true, 'yodevmail_hard_bounced'],
    ['complained', 'complained', true, 'yodevmail_complained'],
    ['suppressed', 'suppressed', true, 'yodevmail_suppressed'],
    ['failed', 'failed', true, 'yodevmail_failed'],
    ['soft_bounced', 'failed', true, 'yodevmail_soft_bounced'],
    ['unknown', 'ambiguous', false, 'yodevmail_unknown'],
    ['sent', 'sent', false, null],
    ['queued', 'accepted', false, null],
  ] as const)('maps provider status %s to %s', async (providerStatus, status, terminal, lastError) => {
    const database = databaseDouble()
    mocks.databases.push(database.db)
    await markTransactionalEmailAccepted(base.id, '00000000-0000-4000-8000-000000000002', providerStatus, now)
    expect(database.capture.sets[0]).toMatchObject({
      status,
      deliveredAt: status === 'delivered' ? now : null,
      terminalAt: terminal ? now : null,
      lastError,
    })
  })

  it('records Error instances and uses an execution timestamp when none is supplied', async () => {
    const database = databaseDouble()
    mocks.databases.push(database.db)
    await markTransactionalEmailFailure(base.id, 'failed', new Error('provider rejected'))
    expect(database.capture.sets[0]).toMatchObject({ status: 'failed', lastError: 'provider rejected' })
    expect((database.capture.sets[0] as Record<string, unknown>).updatedAt).toBeInstanceOf(Date)
  })
})
