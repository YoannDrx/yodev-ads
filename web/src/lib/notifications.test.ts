import { describe, expect, it } from 'vitest'
import { alertEmailHtml, teamsMessageHtml, webhookBody } from '@/lib/notifications'

const payload = {
  workspaceId: 'workspace-1',
  eventKey: 'incident:1',
  severity: 'critical' as const,
  title: 'Dépense <sans> conversion',
  description: 'Coût > 100 & aucune conversion',
  clientName: 'ACME & Associés',
}

describe('notification rendering', () => {
  it('builds a connector-neutral webhook payload', () => {
    expect(webhookBody(payload)).toMatchObject({
      severity: 'critical',
      eventKey: 'incident:1',
      title: 'Dépense <sans> conversion',
    })
  })

  it('escapes user and Google Ads data in HTML emails', () => {
    const html = alertEmailHtml(payload)
    expect(html).toContain('Dépense &lt;sans&gt; conversion')
    expect(html).toContain('ACME &amp; Associés')
    expect(html).not.toContain('<sans>')
  })

  it('localizes email and webhook copy in English', () => {
    const englishPayload = { ...payload, locale: 'en' as const }
    expect(webhookBody(englishPayload).text).toContain('Critical incident')
    const html = alertEmailHtml(englishPayload)
    expect(html).toContain('Account:')
    expect(html).toContain('Automatic, traceable notification')
    expect(html).not.toContain('Compte :')
  })

  it('escapes Google Ads data in Teams HTML and localizes its account label', () => {
    const html = teamsMessageHtml({ ...payload, locale: 'en' as const })
    expect(html).toContain('Dépense &lt;sans&gt; conversion')
    expect(html).toContain('ACME &amp; Associés')
    expect(html).toContain('Account:')
    expect(html).not.toContain('<sans>')
  })
})
