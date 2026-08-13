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
    const digest = taskDigestEmail({ locale: 'en', displayName: 'Alice', taskUrl: 'https://ads.yodev.fr/tasks', tasks: [{ title: '<Task>', status: 'todo', dueAt: null }] })
    expect(digest.html).toContain('&lt;Task&gt;')
  })
})
