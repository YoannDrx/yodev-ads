import { createHmac } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/db/transactions', () => ({ withSystemTransaction: vi.fn() }))
import { verifyAndParseYodevMailWebhook } from './yodev-mail-webhook'

describe('Mail by Yodev webhook verification', () => {
  const secret = 'test-webhook-secret'
  const now = new Date('2026-08-13T12:00:00.000Z')
  const timestamp = String(Math.floor(now.getTime() / 1000))
  const body = JSON.stringify({ id: '00000000-0000-4000-8000-000000000001', type: 'email.delivered', created_at: '2026-08-13T11:59:59.000Z', data: { message_id: '00000000-0000-4000-8000-000000000002' } })
  const signature = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')

  it('verifies before parsing and retains only the minimal event contract', () => {
    expect(verifyAndParseYodevMailWebhook({ body, signature, timestamp, secret, now })).toMatchObject({ type: 'email.delivered', data: { message_id: '00000000-0000-4000-8000-000000000002' } })
  })

  it('rejects stale events and invalid signatures', () => {
    expect(() => verifyAndParseYodevMailWebhook({ body, signature: 'bad', timestamp, secret, now })).toThrow('invalid_signature')
    expect(() => verifyAndParseYodevMailWebhook({ body, signature, timestamp, secret, now: new Date(now.getTime() + 6 * 60_000) })).toThrow('stale_timestamp')
  })
})
