import { createHmac } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { databaseDouble } from '../../test/fluent-db'

const mocks = vi.hoisted(() => ({
  database: undefined as unknown,
  transaction: vi.fn(async (callback: (db: unknown) => unknown) => callback(mocks.database)),
}))

vi.mock('@/db/transactions', () => ({ withSystemTransaction: mocks.transaction }))
import { recordYodevMailEvent, verifyAndParseYodevMailWebhook } from './yodev-mail-webhook'

describe('Mail by Yodev webhook verification', () => {
  const secret = 'test-webhook-secret'
  const now = new Date('2026-08-13T12:00:00.000Z')
  const timestamp = String(Math.floor(now.getTime() / 1000))
  const body = JSON.stringify({ id: '00000000-0000-4000-8000-000000000001', type: 'email.delivered', created_at: '2026-08-13T11:59:59.000Z', data: { message_id: '00000000-0000-4000-8000-000000000002' } })
  const signature = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')

  beforeEach(() => vi.clearAllMocks())

  it('verifies before parsing and retains only the minimal event contract', () => {
    expect(verifyAndParseYodevMailWebhook({ body, signature, timestamp, secret, now })).toMatchObject({ type: 'email.delivered', data: { message_id: '00000000-0000-4000-8000-000000000002' } })
  })

  it('rejects stale events and invalid signatures', () => {
    expect(() => verifyAndParseYodevMailWebhook({ body, signature: 'bad', timestamp, secret, now })).toThrow('invalid_signature')
    expect(() => verifyAndParseYodevMailWebhook({ body, signature, timestamp, secret, now: new Date(now.getTime() + 6 * 60_000) })).toThrow('stale_timestamp')
  })

  it('rejects malformed and future timestamps before parsing the body', () => {
    expect(() => verifyAndParseYodevMailWebhook({ body: 'not-json', signature, timestamp: 'invalid', secret, now }))
      .toThrow('invalid_timestamp')
    const future = String(Math.floor((now.getTime() + 2 * 60_000) / 1000))
    const futureSignature = createHmac('sha256', secret).update(`${future}.${body}`).digest('hex')
    expect(() => verifyAndParseYodevMailWebhook({ body, signature: futureSignature, timestamp: future, secret, now }))
      .toThrow('stale_timestamp')
  })

  it('deduplicates immutable provider events before touching a delivery', async () => {
    mocks.database = databaseDouble({ statementResults: [[]] }).db
    await expect(recordYodevMailEvent({
      id: '00000000-0000-4000-8000-000000000011',
      type: 'email.sent',
      created_at: now,
      data: { message_id: '00000000-0000-4000-8000-000000000012' },
    })).resolves.toEqual({ duplicate: true, orphan: false })
  })

  it('correlates delivery state and lets a complaint supersede an earlier delivery', async () => {
    const deliveredAt = new Date('2026-08-13T11:55:00.000Z')
    const complainedAt = new Date('2026-08-13T11:59:00.000Z')
    const delivery = {
      id: '00000000-0000-4000-8000-000000000021',
      category: 'lifecycle',
      deliveredAt,
    }
    const database = databaseDouble({
      statementResults: [[{ eventId: '00000000-0000-4000-8000-000000000022' }], [], []],
      query: {
        transactionalEmailDeliveries: { findFirst: vi.fn(async () => delivery) },
        yodevMailEvents: { findMany: vi.fn(async () => [
          { type: 'email.complained', occurredAt: complainedAt },
          { type: 'email.delivered', occurredAt: deliveredAt },
        ]) },
      },
    })
    mocks.database = database.db

    await expect(recordYodevMailEvent({
      id: '00000000-0000-4000-8000-000000000022',
      type: 'email.complained',
      created_at: complainedAt,
      data: { message_id: '00000000-0000-4000-8000-000000000023' },
    })).resolves.toMatchObject({ duplicate: false, orphan: false, status: 'complained' })
    expect(database.capture.sets[0]).toMatchObject({
      status: 'complained',
      deliveredAt,
      terminalAt: complainedAt,
      lastEventAt: complainedAt,
      lastError: 'email.complained',
    })
    expect(database.capture.values.at(-1)).toMatchObject({ type: 'operations.alert' })
  })

  it('alerts on an orphan provider message without leaking delivery details in the response', async () => {
    const database = databaseDouble({
      statementResults: [[{ eventId: '00000000-0000-4000-8000-000000000031' }], []],
      query: { transactionalEmailDeliveries: { findFirst: vi.fn(async () => null) } },
    })
    mocks.database = database.db
    const result = await recordYodevMailEvent({
      id: '00000000-0000-4000-8000-000000000031',
      type: 'email.failed',
      created_at: now,
      data: { message_id: '00000000-0000-4000-8000-000000000032' },
    })
    expect(result).toEqual({ duplicate: false, orphan: true })
    expect(database.capture.values.at(-1)).toMatchObject({ type: 'operations.alert' })
  })

  it('uses the determining terminal event when older events arrive after a failure', async () => {
    const failedAt = new Date('2026-08-13T11:58:00.000Z')
    const lateQueuedAt = new Date('2026-08-13T11:59:00.000Z')
    const delivery = { id: '00000000-0000-4000-8000-000000000041', category: 'authentication', deliveredAt: null }
    const database = databaseDouble({
      statementResults: [[{ eventId: '00000000-0000-4000-8000-000000000042' }], [], []],
      query: {
        transactionalEmailDeliveries: { findFirst: vi.fn(async () => delivery) },
        yodevMailEvents: { findMany: vi.fn(async () => [
          { type: 'email.queued', occurredAt: lateQueuedAt },
          { type: 'email.failed', occurredAt: failedAt },
        ]) },
      },
    })
    mocks.database = database.db

    await expect(recordYodevMailEvent({
      id: '00000000-0000-4000-8000-000000000042',
      type: 'email.queued',
      created_at: lateQueuedAt,
      data: { message_id: '00000000-0000-4000-8000-000000000043' },
    })).resolves.toMatchObject({ status: 'failed' })
    expect(database.capture.sets[0]).toMatchObject({
      status: 'failed', terminalAt: failedAt, lastEventAt: lateQueuedAt, lastError: 'email.failed',
    })
  })

  it.each([
    ['hard_bounced', ['email.hard_bounced'], true, 'email.hard_bounced'],
    ['suppressed', ['email.suppressed'], true, 'email.suppressed'],
    ['delivered', ['email.delivered'], true, null],
    ['failed', ['email.soft_bounced'], true, 'email.soft_bounced'],
    ['sent', ['email.sent'], false, null],
    ['accepted', ['email.queued'], false, null],
  ] as const)('reduces provider history to %s deterministically', async (expectedStatus, eventTypes, terminal, lastError) => {
    const occurredAt = new Date('2026-08-13T11:58:00.000Z')
    const delivery = { id: '00000000-0000-4000-8000-000000000051', category: 'authentication', deliveredAt: null }
    const database = databaseDouble({
      statementResults: [[{ eventId: '00000000-0000-4000-8000-000000000052' }], [], []],
      query: {
        transactionalEmailDeliveries: { findFirst: vi.fn(async () => delivery) },
        yodevMailEvents: { findMany: vi.fn(async () => eventTypes.map((type) => ({ type, occurredAt }))) },
      },
    })
    mocks.database = database.db
    const type = eventTypes[0]
    await expect(recordYodevMailEvent({
      id: '00000000-0000-4000-8000-000000000052',
      type,
      created_at: occurredAt,
      data: { message_id: '00000000-0000-4000-8000-000000000053' },
    })).resolves.toMatchObject({ status: expectedStatus })
    expect(database.capture.sets[0]).toMatchObject({
      status: expectedStatus,
      terminalAt: terminal ? occurredAt : null,
      lastError,
    })
  })
})
