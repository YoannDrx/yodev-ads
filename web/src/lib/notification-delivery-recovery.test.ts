import { beforeEach, describe, expect, it, vi } from 'vitest'
import { databaseDouble } from '../../test/fluent-db'
const mocks = vi.hoisted(() => ({ db: undefined as unknown, transaction: vi.fn(async (fn: (db: unknown) => unknown) => fn(mocks.db)) }))
vi.mock('@/db/transactions', () => ({ withSystemTransaction: mocks.transaction }))
import { recoverNotificationDeliveries } from './notification-delivery-recovery'
const now = new Date('2026-09-07T00:00:00Z')
const delivery = {
  id: '00000000-0000-4000-8000-000000000001', workspaceId: '00000000-0000-4000-8000-000000000002',
  incidentId: '00000000-0000-4000-8000-000000000003', attemptCount: 1, eventKey: 'fixture-event', payload: {},
  leaseExpiresAt: new Date(now.getTime() - 1), dispatchStartedAt: null, providerMessageId: null,
}
describe('interrupted notification recovery', () => {
  beforeEach(() => vi.clearAllMocks())
  it('requeues an unsent expired attempt and closes an orphaned outbox gap atomically', async () => {
    const db = databaseDouble({ statementResults: [[{ delivery, kind: 'webhook' }], [], [], [delivery]] })
    mocks.db = db.db
    expect(await recoverNotificationDeliveries(now)).toEqual({ recovered: 1, reconciled: 0, ambiguous: 0, orphaned: 1 })
    expect(db.capture.sets[0]).toMatchObject({ status: 'retrying', nextAttemptAt: now })
    expect(db.capture.values[1]).toMatchObject({ type: 'notification.deliver', payload: { deliveryId: delivery.id } })
  })
  it.each([true, false])('quarantines a dispatched or legacy webhook (dispatch marker: %s)', async (marked) => {
    const db = databaseDouble({ statementResults: [[{ delivery: { ...delivery, dispatchStartedAt: marked ? now : null, leaseExpiresAt: marked ? delivery.leaseExpiresAt : null }, kind: 'webhook' }]] })
    mocks.db = db.db
    expect(await recoverNotificationDeliveries(now)).toMatchObject({ ambiguous: 1 })
    expect(db.capture.sets[0]).toMatchObject({ status: 'ambiguous', nextAttemptAt: null, terminalAt: null })
    expect(db.capture.values[0]).toMatchObject({ type: 'operations.alert', payload: { sourceId: delivery.id } })
  })
  it('recovers email acceptance and the incident clock from durable provider evidence without sending', async () => {
    const acceptedAt = new Date(now.getTime() - 10_000)
    const db = databaseDouble({ statementResults: [[{ delivery: { ...delivery, payload: { deliveryKey: 'channel-specific-key' }, dispatchStartedAt: acceptedAt }, kind: 'email' }]],
      query: { transactionalEmailDeliveries: { findFirst: async () => ({ status: 'accepted', providerMessageId: 'mail-proof', acceptedAt }) } },
    })
    mocks.db = db.db
    expect(await recoverNotificationDeliveries(now)).toMatchObject({ reconciled: 1, ambiguous: 0 })
    expect(db.capture.sets[0]).toMatchObject({ status: 'accepted', providerMessageId: 'mail-proof', terminalAt: acceptedAt })
    expect(db.capture.sets[1]).toMatchObject({ lastNotifiedAt: expect.anything() })
  })
  it('does not attribute a shared legacy email receipt to another channel', async () => {
    const lookup = vi.fn(async () => ({ status: 'accepted', providerMessageId: 'other-channel' }))
    const db = databaseDouble({ statementResults: [[{ delivery: { ...delivery, leaseExpiresAt: null }, kind: 'email' }]],
      query: { transactionalEmailDeliveries: { findFirst: lookup } },
    })
    mocks.db = db.db
    expect(await recoverNotificationDeliveries(now)).toMatchObject({ reconciled: 0, ambiguous: 1 })
    expect(lookup).not.toHaveBeenCalled()
  })
  it('makes an exhausted unsent attempt terminal and rejects unbounded batches', async () => {
    const db = databaseDouble({ statementResults: [[{ delivery: { ...delivery, attemptCount: 5 }, kind: 'webhook' }]] })
    mocks.db = db.db
    await recoverNotificationDeliveries(now)
    expect(db.capture.sets[0]).toMatchObject({ status: 'dead_letter', terminalAt: now })
    expect(db.capture.values[0]).toMatchObject({ type: 'operations.alert' })
    await expect(recoverNotificationDeliveries(now, 101)).rejects.toThrow('Invalid notification recovery limit')
  })
})
