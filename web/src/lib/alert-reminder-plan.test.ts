import { describe, expect, it } from 'vitest'
import { alertReminderDueAt, alertReminderEventKey } from './alert-reminder-plan'

const incident = { status: 'open', createdAt: new Date('2026-10-24T23:00:00Z'), lastNotifiedAt: null, snoozedUntil: null }

describe('independent incident reminder clock', () => {
  it.each([4, 12, 24])('schedules %i elapsed hours from the last acceptance through DST', (hours) => {
    expect(alertReminderDueAt(incident, hours)!.getTime() - incident.createdAt.getTime()).toBe(hours * 3_600_000)
    const accepted = new Date('2026-10-25T06:01:00Z')
    expect(alertReminderDueAt({ ...incident, lastNotifiedAt: accepted }, hours)!.getTime()).toBe(accepted.getTime() + hours * 3_600_000)
  })
  it('postpones until snooze ends and suppresses acknowledged, resolved or disabled reminders', () => {
    const snoozedUntil = new Date('2026-10-26T10:00:00Z')
    expect(alertReminderDueAt({ ...incident, status: 'snoozed', snoozedUntil }, 4)).toEqual(snoozedUntil)
    for (const status of ['acknowledged', 'resolved', 'unknown']) expect(alertReminderDueAt({ ...incident, status }, 4)).toBeNull()
    expect(alertReminderDueAt(incident, null)).toBeNull()
    expect(alertReminderDueAt({ ...incident, status: 'snoozed' }, 4)).toBeNull()
  })
  it('keeps an overdue occurrence stable across scheduler ticks and within the database limit', () => {
    const due = alertReminderDueAt(incident, 4)!
    const key = alertReminderEventKey('00000000-0000-4000-8000-000000000001', due)
    expect(key.length).toBeLessThanOrEqual(180)
    expect(key).toBe(alertReminderEventKey('00000000-0000-4000-8000-000000000001', new Date(due)))
  })
})
