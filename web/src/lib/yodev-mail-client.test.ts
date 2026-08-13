import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/jobs', () => ({ NonRetryableJobError: class NonRetryableJobError extends Error {} }))
import { sendOperationsAlertWithYodevMail, YodevMailAmbiguousError } from './yodev-mail-client'

describe('Mail by Yodev operations transport', () => {
  beforeEach(() => {
    process.env.YODEV_MAIL_API_KEY = 'ym_test_secret'
    process.env.YODEV_MAIL_OPERATIONS_TEMPLATE_ID = '00000000-0000-4000-8000-000000000001'
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    delete process.env.YODEV_MAIL_API_KEY
    delete process.env.YODEV_MAIL_OPERATIONS_TEMPLATE_ID
  })

  it('uses a stable idempotency key and the approved template contract', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ data: { id: '00000000-0000-4000-8000-000000000002', status: 'simulated' } }), { status: 202 }))
    await sendOperationsAlertWithYodevMail({ kind: 'job_dead_letter', sourceId: 'job-1', title: 'Job', description: 'Failed', recipient: 'ops@example.test', operationsUrl: 'https://ads.yodev.fr/operations' })
    const [, init] = vi.mocked(fetch).mock.calls[0]
    expect(new Headers(init?.headers).get('idempotency-key')).toBe('operations-alert:job_dead_letter:job-1')
    expect(JSON.parse(String(init?.body))).toMatchObject({
      from: { email: 'ads@yodev.fr', name: 'Ads by Yodev' },
      category: 'operations_alert',
      metadata: { referenceId: 'job-1' },
      content: { variables: { sourceId: 'job-1' } },
    })
  })

  it('classifies network and malformed success results as ambiguous without calling Resend', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error('timeout'))
    await expect(sendOperationsAlertWithYodevMail({ kind: 'mutation_ambiguous', sourceId: 'a-1', title: 'Mutation', description: 'Unknown', recipient: 'ops@example.test', operationsUrl: 'https://ads.yodev.fr/operations' })).rejects.toBeInstanceOf(YodevMailAmbiguousError)
  })

  it('distinguishes definitive and transient HTTP failures', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 'template_not_approved' } }), { status: 403 }))
    await expect(sendOperationsAlertWithYodevMail({ kind: 'stripe_webhook_failed', sourceId: 'evt-1', title: 'Stripe', description: 'Failed', recipient: 'ops@example.test', operationsUrl: 'https://ads.yodev.fr/operations' })).rejects.toThrow('rejeté')
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 'rate_limit_exceeded' } }), { status: 429 }))
    await expect(sendOperationsAlertWithYodevMail({ kind: 'stripe_webhook_failed', sourceId: 'evt-2', title: 'Stripe', description: 'Failed', recipient: 'ops@example.test', operationsUrl: 'https://ads.yodev.fr/operations' })).rejects.toThrow('transitoire')
  })
})
