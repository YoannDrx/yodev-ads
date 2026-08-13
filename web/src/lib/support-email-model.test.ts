import { describe, expect, it } from 'vitest'
import { supportEmail } from '@/lib/support-email-model'

describe('supportEmail', () => {
  it('localizes customer notifications', () => {
    expect(supportEmail({ kind: 'support_reply', locale: 'en', subject: 'OAuth', workspaceName: 'Studio', status: 'awaiting_customer', url: 'https://example.test/support' }).subject).toContain('support replied')
  })

  it('escapes all tenant-controlled values', () => {
    const email = supportEmail({ kind: 'new_ticket', locale: 'fr', subject: '<script>', workspaceName: '<img>', message: '<b>hello</b>', status: 'open', url: 'https://example.test/?a=1&b=2' })
    expect(email.html).not.toContain('<script>')
    expect(email.html).not.toContain('<img>')
    expect(email.html).toContain('&lt;b&gt;hello&lt;/b&gt;')
    expect(email.html).toContain('a=1&amp;b=2')
  })
})
