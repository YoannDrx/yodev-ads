import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ send: vi.fn(), enqueue: vi.fn(), encrypt: vi.fn(), decrypt: vi.fn() }))
vi.mock('@/lib/transactional-email', () => ({ sendTransactionalEmail: mocks.send }))
vi.mock('@/lib/jobs', () => ({ enqueueJob: mocks.enqueue, NonRetryableJobError: class NonRetryableJobError extends Error {} }))
vi.mock('@/lib/crypto', () => ({ encryptSecret: mocks.encrypt, decryptSecret: mocks.decrypt }))

import { deliverQueuedAuthEmail, sendAuthEmail } from './auth-emails'

describe('authentication email delivery', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.send.mockResolvedValue({ provider: 'yodev_mail', providerMessageId: 'message-1' })
    mocks.enqueue.mockResolvedValue({ created: true })
    mocks.encrypt.mockImplementation((value: string) => `encrypted:${value}`)
    mocks.decrypt.mockImplementation((value: string) => value.replace(/^encrypted:/, ''))
  })

  it('delivers rendered content through YoDevMail and preserves caller idempotency', async () => {
    process.env.AUTH_FROM_EMAIL = 'Auth <auth@example.test>'
    await expect(sendAuthEmail({
      to: ' Owner@Example.TEST ', kind: 'email_verification', actionUrl: 'https://ads.example.test/verify',
      locale: 'en', idempotencyKey: 'auth:verify:1',
    })).resolves.toEqual({ providerMessageId: 'message-1' })
    expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({
      from: 'Auth <auth@example.test>', to: 'owner@example.test', subject: 'Verify your email',
      idempotencyKey: 'auth:verify:1', category: 'auth_email_verification', referenceId: 'auth:verify:1',
    }))
    expect(mocks.enqueue).toHaveBeenCalledWith(expect.objectContaining({
      type: 'auth.email_deliver', deduplicationKey: expect.stringMatching(/^auth-email:[a-f0-9]{64}$/),
      payload: { envelope: expect.stringMatching(/^encrypted:/) }, priority: 20,
    }))
  })

  it('derives a stable business key from the logical Better Auth request', async () => {
    const input = {
      to: 'owner@example.test', kind: 'organization_invitation', actionUrl: 'https://ads.example.test/invite', organizationName: 'Agency',
    } as const
    await sendAuthEmail(input)
    await sendAuthEmail(input)
    const firstKey = mocks.send.mock.calls[0]?.[0].idempotencyKey
    expect(firstKey).toMatch(/^auth:organization_invitation:[a-f0-9]{64}$/)
    expect(mocks.send.mock.calls[1]?.[0].idempotencyKey).toBe(firstKey)
  })

  it('keeps provider failures opaque while the durable job remains queued', async () => {
    mocks.send.mockRejectedValueOnce(new Error('YoDevMail unavailable'))
    await expect(sendAuthEmail({ to: 'owner@example.test', kind: 'password_reset', actionUrl: 'https://ads.example.test/reset' }))
      .resolves.toEqual({ providerMessageId: null, queued: true })
    expect(mocks.enqueue).toHaveBeenCalledTimes(1)
  })

  it('decrypts and submits a queued authentication email without creating another job', async () => {
    const input = {
      to: 'owner@example.test', kind: 'magic_link', actionUrl: 'https://ads.example.test/magic',
      locale: 'fr', idempotencyKey: 'auth:magic:1',
    }
    await expect(deliverQueuedAuthEmail({ envelope: `encrypted:${JSON.stringify(input)}` }))
      .resolves.toEqual({ providerMessageId: 'message-1' })
    expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({ idempotencyKey: 'auth:magic:1' }))
    expect(mocks.enqueue).not.toHaveBeenCalled()
  })
})
