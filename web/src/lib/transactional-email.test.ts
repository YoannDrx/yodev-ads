import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ send: vi.fn() }))
vi.mock('resend', () => ({ Resend: class { emails = { send: mocks.send } } }))

import { hasTransactionalEmailTransport, plainTextFromHtml, sendTransactionalEmail } from './transactional-email'

describe('transactional email transport', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    delete process.env.POSTMARK_SERVER_TOKEN
    delete process.env.POSTMARK_MESSAGE_STREAM
    delete process.env.RESEND_API_KEY
    vi.unstubAllGlobals()
  })

  it('prefers Postmark, disables tracking and records idempotency metadata', async () => {
    process.env.POSTMARK_SERVER_TOKEN = 'postmark-secret'
    process.env.RESEND_API_KEY = 're_fallback'
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ ErrorCode: 0, MessageID: 'pm-1' }), { status: 200 }))

    await expect(sendTransactionalEmail({
      from: 'Ads <ads@example.test>',
      to: [' OWNER@example.test '],
      subject: 'Subject',
      html: '<p>Hello &amp; welcome</p>',
      idempotencyKey: 'job:1',
      tag: 'Lifecycle Payment',
    })).resolves.toEqual({ provider: 'postmark', providerMessageId: 'pm-1' })

    const body = JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body))
    expect(body).toMatchObject({
      To: 'owner@example.test',
      TextBody: 'Hello & welcome',
      TrackOpens: false,
      TrackLinks: 'None',
      Tag: 'lifecycle_payment',
      Metadata: { idempotencyKey: 'job:1' },
    })
    expect(mocks.send).not.toHaveBeenCalled()
  })

  it('falls back to Resend with provider idempotency', async () => {
    process.env.RESEND_API_KEY = 're_test'
    mocks.send.mockResolvedValue({ data: { id: 're-1' }, error: null })
    await expect(sendTransactionalEmail({
      from: 'Ads <ads@example.test>', to: 'OWNER@example.test', subject: 'Subject', html: '<p>Hello</p>', idempotencyKey: 'job:2',
    })).resolves.toEqual({ provider: 'resend', providerMessageId: 're-1' })
    expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({
      to: 'owner@example.test', headers: { 'X-Entity-Ref-ID': 'job:2' },
    }), { idempotencyKey: 'job:2' })
  })

  it('fails closed without a provider and strips unsafe markup from plain text', async () => {
    expect(hasTransactionalEmailTransport()).toBe(false)
    expect(plainTextFromHtml('<style>x</style><script>alert(1)</script><p>A &lt; B</p>')).toBe('A < B')
    await expect(sendTransactionalEmail({ from: 'a', to: 'b', subject: 's', html: '<p>x</p>' }))
      .rejects.toThrow('POSTMARK_SERVER_TOKEN or RESEND_API_KEY absent')
  })
})
