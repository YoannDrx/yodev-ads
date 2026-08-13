import { describe, expect, it } from 'vitest'
import { alertNotificationEvent, alertNotificationEventKey } from './alert-notification-events'

const now = new Date('2026-08-12T12:00:00Z')
const existing = {
  status: 'open', severity: 'warning', createdAt: new Date('2026-08-10T12:00:00Z'),
  lastNotifiedAt: new Date('2026-08-12T00:00:00Z'),
}

describe('alert notification lifecycle', () => {
  it('notifies only meaningful lifecycle transitions before reminders', () => {
    expect(alertNotificationEvent({ existing: null, nextSeverity: 'warning', reminderIntervalHours: 24, now })).toBe('opened')
    expect(alertNotificationEvent({ existing: { ...existing, status: 'resolved' }, nextSeverity: 'warning', reminderIntervalHours: 24, now })).toBe('reopened')
    expect(alertNotificationEvent({ existing, nextSeverity: 'critical', reminderIntervalHours: 24, now })).toBe('severity_increased')
  })

  it('sends a due reminder only for unresolved, non-acknowledged incidents', () => {
    expect(alertNotificationEvent({ existing, nextSeverity: 'warning', reminderIntervalHours: 12, now })).toBe('reminder')
    expect(alertNotificationEvent({ existing, nextSeverity: 'warning', reminderIntervalHours: 24, now })).toBeNull()
    expect(alertNotificationEvent({ existing: { ...existing, status: 'acknowledged' }, nextSeverity: 'warning', reminderIntervalHours: 12, now })).toBeNull()
    expect(alertNotificationEvent({ existing: { ...existing, status: 'snoozed' }, nextSeverity: 'warning', reminderIntervalHours: 12, now })).toBeNull()
  })

  it('deduplicates concurrent reminders in the same configured interval', () => {
    const input = { fingerprint: 'fp', incidentId: 'incident', event: 'reminder' as const, reminderIntervalHours: 12, now }
    expect(alertNotificationEventKey(input)).toBe(alertNotificationEventKey({ ...input, now: new Date(now.getTime() + 1_000) }))
    expect(() => alertNotificationEventKey({ ...input, reminderIntervalHours: null })).toThrow('requires an interval')
  })
})
