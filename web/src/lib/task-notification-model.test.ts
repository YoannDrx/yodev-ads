import { describe, expect, it } from 'vitest'
import { normalizedMentionHandles, taskDigestEmail, taskDigestRunKey, taskMentionEmail } from './task-notification-model'

describe('task notification model', () => {
  it('creates timezone-aware daily and Monday weekly digest keys', () => {
    const monday = new Date('2026-08-10T06:15:00Z')
    expect(taskDigestRunKey({ cadence: 'daily', digestHour: 8, timezone: 'Europe/Paris' }, monday)).toBe('daily:2026-08-10')
    expect(taskDigestRunKey({ cadence: 'weekly', digestHour: 8, timezone: 'Europe/Paris' }, monday)).toBe('weekly:2026-08-10')
    expect(taskDigestRunKey({ cadence: 'weekly', digestHour: 9, timezone: 'Europe/Paris' }, monday)).toBeNull()
  })

  it('normalizes deduplicated handles', () => {
    expect(normalizedMentionHandles(['@Alice', '@bob', '@alice'])).toEqual(['alice', 'bob'])
  })

  it('escapes user-controlled email content', () => {
    const mention = taskMentionEmail({ locale: 'fr', displayName: '<Alice>', taskTitle: 'ACME & Co', comment: '<script>x</script>', taskUrl: 'https://ads.yodev.fr/tasks' })
    expect(mention.html).toContain('&lt;script&gt;')
    expect(mention.html).not.toContain('<script>')
    const digest = taskDigestEmail({ locale: 'en', displayName: 'Alice', workspaceName: 'ACME', timezone: 'Europe/Paris', total: 1, taskUrl: 'https://ads.yodev.fr/tasks', tasks: [{ title: '<Task>', status: 'todo', dueAt: null }] })
    expect(digest.html).toContain('&lt;Task&gt;')
  })

  it.each(['fr', 'en'])('describes an exact total and a bounded preview in %s', (locale) => {
    const email = taskDigestEmail({ locale, displayName: '<Member>', workspaceName: 'Agency & Co', timezone: 'America/Montreal', total: 521,
      taskUrl: 'https://ads.yodev.fr/tasks?assignee=member&status=open', tasks: Array.from({ length: 50 }, () => ({ title: '<Review>', status: 'in_progress', dueAt: new Date('2026-09-08T02:30:00Z') })) })
    expect(email.subject).toContain('521')
    expect(email.html).toContain(locale === 'fr' ? 'Aperçu : 50 tâches sur 521' : 'Preview: 50 of 521')
    expect(email.html).toContain(locale === 'fr' ? 'En cours' : 'In progress')
    expect(email.html).not.toContain('in_progress')
    expect(email.html).toContain('22:30')
    expect(email.html).toContain(locale === 'fr' ? '7 sept.' : '7 Sept')
    expect(email.html).toContain('America/Montreal')
    expect(email.html).toContain('Agency &amp; Co')
    expect(email.html).toContain('assignee=member&amp;status=open')
    expect(email.html.match(/<li /g)).toHaveLength(50)
  })

  it('distinguishes a complete digest and rejects an inconsistent total', () => {
    const input = { locale: 'en', displayName: 'Member', workspaceName: 'Agency', timezone: 'UTC', total: 1, taskUrl: '/tasks', tasks: [{ title: 'Review', status: 'blocked', dueAt: null }] }
    expect(taskDigestEmail(input).html).toContain('All 1 tasks are listed below')
    expect(taskDigestEmail(input).html).not.toContain('Preview:')
    expect(() => taskDigestEmail({ ...input, total: 0 })).toThrow('Invalid task digest total')
  })
})
