import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ send: vi.fn() }))
vi.mock('resend', () => ({ Resend: class { emails = { send: mocks.send } } }))

import { sendAuthEmail } from './auth-emails'

describe('authentication email delivery', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.RESEND_API_KEY = 're_test'
    vi.stubGlobal('fetch', vi.fn())
    mocks.send.mockResolvedValue({ data: { id: 'message-1' }, error: null })
  })
  afterEach(() => {
    delete process.env.RESEND_API_KEY
    delete process.env.AUTH_FROM_EMAIL
    delete process.env.LIFECYCLE_FROM_EMAIL
    delete process.env.POSTMARK_SERVER_TOKEN
    delete process.env.POSTMARK_MESSAGE_STREAM
    vi.unstubAllGlobals()
  })

  it('delivers through the configured sender and preserves caller idempotency', async () => {
    process.env.AUTH_FROM_EMAIL = 'Auth <auth@example.test>'
    await expect(sendAuthEmail({
      to: ' Owner@Example.TEST ', kind: 'email_verification', actionUrl: 'https://ads.example.test/verify',
      locale: 'en', idempotencyKey: 'auth:verify:1',
    })).resolves.toEqual({ providerMessageId: 'message-1' })
    expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({
      from: 'Auth <auth@example.test>', to: 'owner@example.test', subject: 'Verify your email',
      headers: { 'X-Entity-Ref-ID': 'auth:verify:1' },
    }), { idempotencyKey: 'auth:verify:1' })
  })

  it('uses safe defaults and returns a nullable provider id', async () => {
    process.env.LIFECYCLE_FROM_EMAIL = 'Lifecycle <life@example.test>'
    mocks.send.mockResolvedValueOnce({ data: null, error: null })
    await expect(sendAuthEmail({
      to: 'owner@example.test', kind: 'organization_invitation', actionUrl: 'https://ads.example.test/invite', organizationName: 'Agency',
    })).resolves.toEqual({ providerMessageId: null })
    expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({ from: 'Lifecycle <life@example.test>' }), expect.objectContaining({ idempotencyKey: expect.stringMatching(/^auth:organization_invitation:/) }))
  })

  it('fails closed without transport configuration and surfaces provider errors', async () => {
    delete process.env.RESEND_API_KEY
    await expect(sendAuthEmail({ to: 'owner@example.test', kind: 'password_reset', actionUrl: 'https://ads.example.test/reset' })).rejects.toThrow('POSTMARK_SERVER_TOKEN or RESEND_API_KEY')
    process.env.RESEND_API_KEY = 're_test'
    mocks.send.mockResolvedValueOnce({ data: null, error: { message: 'provider unavailable' } })
    await expect(sendAuthEmail({ to: 'owner@example.test', kind: 'password_reset', actionUrl: 'https://ads.example.test/reset' })).rejects.toThrow('provider unavailable')
  })

  it('prefers Postmark without exposing the token and disables tracking', async () => {
    process.env.POSTMARK_SERVER_TOKEN = 'postmark-secret'
    process.env.AUTH_FROM_EMAIL = 'Ads by Yodev <hello@yodev.fr>'
    const fetchMock = vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ ErrorCode: 0, MessageID: 'postmark-1' }), { status: 200 }))
    await expect(sendAuthEmail({
      to: 'owner@example.test', kind: 'magic_link', actionUrl: 'https://ads.example.test/magic', idempotencyKey: 'auth:magic:1',
    })).resolves.toEqual({ providerMessageId: 'postmark-1' })
    expect(fetchMock).toHaveBeenCalledWith('https://api.postmarkapp.com/email', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ 'x-postmark-server-token': 'postmark-secret' }),
    }))
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body))
    expect(body).toMatchObject({ TrackOpens: false, TrackLinks: 'None', Tag: 'magic_link', Metadata: { idempotencyKey: 'auth:magic:1' } })
  })
})
