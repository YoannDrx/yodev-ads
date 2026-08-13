import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ send: vi.fn() }))
vi.mock('resend', () => ({ Resend: class { emails = { send: mocks.send } } }))

import { escapeHtml, reportOtpEmailHtml, sendReportOtpEmail } from './report-otp'

describe('report OTP email', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.RESEND_API_KEY = 're_test'
    mocks.send.mockResolvedValue({ data: { id: 'email-1' }, error: null })
  })
  afterEach(() => {
    delete process.env.RESEND_API_KEY
    delete process.env.NOTIFICATION_FROM_EMAIL
  })

  it('escapes client-controlled branding content', () => {
    expect(escapeHtml(`<script>alert('x')</script>`)).toBe('&lt;script&gt;alert(&#039;x&#039;)&lt;/script&gt;')
    const html = reportOtpEmailHtml({ otp: '123456', clientName: '<Acme & Co>' })
    expect(html).toContain('123456')
    expect(html).toContain('&lt;Acme &amp; Co&gt;')
    expect(html).not.toContain('<Acme')
    expect(reportOtpEmailHtml({ otp: '123456', clientName: 'ACME', locale: 'en' })).toContain('Verify your email address')
  })

  it('sends the OTP with the configured sender and propagates provider failures', async () => {
    process.env.NOTIFICATION_FROM_EMAIL = 'Rapports <reports@example.test>'
    await sendReportOtpEmail({ email: 'client@example.test', otp: '123456', clientName: 'ACME' })
    expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({
      from: 'Rapports <reports@example.test>', to: 'client@example.test', subject: 'Code de vérification · ACME',
    }))
    await sendReportOtpEmail({ email: 'client@example.test', otp: '123456', clientName: 'ACME', locale: 'en' })
    expect(mocks.send).toHaveBeenLastCalledWith(expect.objectContaining({ subject: 'Verification code · ACME' }))
    mocks.send.mockResolvedValueOnce({ data: null, error: { message: 'provider down' } })
    await expect(sendReportOtpEmail({ email: 'client@example.test', otp: '123456', clientName: 'ACME' })).rejects.toThrow('provider down')
  })

  it('fails closed without email transport configuration', async () => {
    delete process.env.RESEND_API_KEY
    await expect(sendReportOtpEmail({ email: 'client@example.test', otp: '123456', clientName: 'ACME' })).rejects.toThrow('configuré')
    await expect(sendReportOtpEmail({ email: 'client@example.test', otp: '123456', clientName: 'ACME', locale: 'en' })).rejects.toThrow('configured')
  })
})
