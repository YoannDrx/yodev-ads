import { describe, expect, it } from 'vitest'
import { alertEmailHtml, webhookBody } from '@/lib/notifications'

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
})
