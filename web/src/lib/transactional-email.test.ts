import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ claim: vi.fn(), accepted: vi.fn(), failed: vi.fn() }))
vi.mock('@/lib/transactional-email-deliveries', () => ({
  claimTransactionalEmailDelivery: mocks.claim,
  markTransactionalEmailAccepted: mocks.accepted,
  markTransactionalEmailFailure: mocks.failed,
}))

import { hasTransactionalEmailTransport, plainTextFromHtml, sendTransactionalEmail, YodevMailAmbiguousError } from './transactional-email'
import { runWithTransactionalEmailRetryGeneration } from './transactional-email-context'

const messageId = '00000000-0000-4000-8000-000000000002'

describe('YoDevMail transactional transport', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.YODEV_MAIL_API_KEY = 'ym_test_secret'
    process.env.YODEV_MAIL_RECIPIENT_HASH_SECRET = 'hash-secret'
    mocks.claim.mockResolvedValue({ claimed: true, delivery: { id: 'delivery-1', providerMessageId: null, status: 'pending' } })
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    delete process.env.YODEV_MAIL_API_KEY
    delete process.env.YODEV_MAIL_API_URL
    delete process.env.YODEV_MAIL_RECIPIENT_HASH_SECRET
    vi.unstubAllGlobals()
  })

  it('submits rendered content with an idempotency key and records acceptance', async () => {
    vi.mocked(fetch).mockImplementation(async () => new Response(JSON.stringify({ data: { id: messageId, status: 'queued' } }), { status: 202 }))
    await expect(sendTransactionalEmail({
      from: 'Ads <ads@example.test>', to: ' OWNER@example.test ', subject: 'Subject', html: '<p>Hello &amp; welcome</p>',
      idempotencyKey: 'lifecycle:1', category: 'Lifecycle Payment', workspaceId: '00000000-0000-4000-8000-000000000001', referenceId: 'invoice-1',
    })).resolves.toMatchObject({ provider: 'yodev_mail', providerMessageId: messageId })

    const [url, init] = vi.mocked(fetch).mock.calls[0]
    expect(url).toBe('https://api.mail.yodev.fr/v1/emails')
    expect(new Headers(init?.headers).get('idempotency-key')).toBe('lifecycle:1')
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer ym_test_secret')
    expect(JSON.parse(String(init?.body))).toMatchObject({
      from: { name: 'Ads', email: 'ads@example.test' }, to: { email: 'owner@example.test' }, category: 'lifecycle_payment',
      content: { subject: 'Subject', text: 'Hello & welcome' },
      metadata: { referenceId: 'invoice-1', workspaceId: '00000000-0000-4000-8000-000000000001' },
    })
    expect(mocks.accepted).toHaveBeenCalledWith('delivery-1', messageId, 'queued')
    expect(mocks.claim).toHaveBeenCalledWith(expect.objectContaining({
      businessKey: 'lifecycle:1',
      contentHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      recipientHash: expect.stringMatching(/^[0-9a-f]{64}$/),
    }))
  })

  it('fans out recipients without exposing one recipient to another', async () => {
    vi.mocked(fetch).mockImplementation(async () => new Response(JSON.stringify({ data: { id: messageId, status: 'queued' } }), { status: 202 }))
    await sendTransactionalEmail({
      from: 'ads@example.test', to: ['a@example.test', 'b@example.test'], subject: 'Report', html: '<p>Report</p>',
      idempotencyKey: 'report:1', category: 'scheduled_report',
    })
    expect(fetch).toHaveBeenCalledTimes(2)
    const bodies = vi.mocked(fetch).mock.calls.map(([, init]) => JSON.parse(String(init?.body)))
    expect(bodies.map((body) => body.to.email)).toEqual(['a@example.test', 'b@example.test'])
    const keys = vi.mocked(fetch).mock.calls.map(([, init]) => new Headers(init?.headers).get('idempotency-key'))
    expect(new Set(keys).size).toBe(2)
  })

  it('uses a new audited generation only for an explicit manual retry', async () => {
    vi.mocked(fetch).mockImplementation(async () => new Response(JSON.stringify({ data: { id: messageId, status: 'queued' } }), { status: 202 }))
    await runWithTransactionalEmailRetryGeneration({ manualRetryGeneration: 2 }, () => sendTransactionalEmail({
      from: 'ads@example.test', to: 'a@example.test', subject: 'Retry', html: '<p>Retry</p>',
      idempotencyKey: 'support:message-1', category: 'support_reply',
    }))
    expect(mocks.claim).toHaveBeenCalledWith(expect.objectContaining({ businessKey: 'support:message-1:manual-retry:2' }))
    expect(new Headers(vi.mocked(fetch).mock.calls[0]?.[1]?.headers).get('idempotency-key')).toBe('support:message-1:manual-retry:2')
  })

  it('classifies ambiguous, transient and definitive failures', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error('timeout'))
    const input = { from: 'ads@example.test', to: 'a@example.test', subject: 'x', html: '<p>x</p>', idempotencyKey: 'x:1', category: 'test' }
    await expect(sendTransactionalEmail(input)).rejects.toBeInstanceOf(YodevMailAmbiguousError)
    expect(mocks.failed).toHaveBeenLastCalledWith('delivery-1', 'ambiguous', expect.any(Error))
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 'rate_limited' } }), { status: 429 }))
    await expect(sendTransactionalEmail({ ...input, idempotencyKey: 'x:2' })).rejects.toThrow('transient')
    expect(mocks.failed).toHaveBeenLastCalledWith('delivery-1', 'pending', 'rate_limited')
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 'forbidden' } }), { status: 403 }))
    await expect(sendTransactionalEmail({ ...input, idempotencyKey: 'x:3' })).rejects.toThrow('rejected')
    expect(mocks.failed).toHaveBeenLastCalledWith('delivery-1', 'failed', 'forbidden')
  })

  it('fails closed without YoDevMail and strips unsafe markup from plain text', async () => {
    delete process.env.YODEV_MAIL_API_KEY
    expect(hasTransactionalEmailTransport()).toBe(false)
    expect(plainTextFromHtml('<style>x</style><script>alert(1)</script><p>A &lt; B</p>')).toBe('A < B')
    await expect(sendTransactionalEmail({ from: 'a', to: 'b', subject: 's', html: '<p>x</p>', idempotencyKey: 'x:4', category: 'test' }))
      .rejects.toThrow('YODEV_MAIL_API_KEY absent')
  })
})
