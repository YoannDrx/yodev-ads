import { describe, expect, it } from 'vitest'
import { assertTimeZone, normalizeReportRecipients, reportScheduleRunKey, scheduledReportEmail } from './report-scheduling'

describe('scheduled reports', () => {
  it('schedules weekly and monthly runs in the configured timezone', () => {
    const now = new Date('2026-08-12T06:15:00Z') // Wednesday 08:15 in Paris
    expect(reportScheduleRunKey({ cadence: 'weekly', scheduleWeekday: 3, scheduleMonthday: null, sendHour: 8, timezone: 'Europe/Paris' }, now)).toBe('weekly:2026-08-12')
    expect(reportScheduleRunKey({ cadence: 'weekly', scheduleWeekday: 2, scheduleMonthday: null, sendHour: 8, timezone: 'Europe/Paris' }, now)).toBeNull()
    expect(reportScheduleRunKey({ cadence: 'monthly', scheduleWeekday: null, scheduleMonthday: 12, sendHour: 9, timezone: 'Europe/Paris' }, now)).toBeNull()
    expect(reportScheduleRunKey({ cadence: 'monthly', scheduleWeekday: null, scheduleMonthday: 12, sendHour: 8, timezone: 'Europe/Paris' }, now)).toBe('monthly:2026-08-12')
  })

  it('normalizes recipients and rejects invalid timezones', () => {
    expect(normalizeReportRecipients('Alice@Example.com, bob@example.com\nalice@example.com')).toEqual(['alice@example.com', 'bob@example.com'])
    expect(assertTimeZone('Europe/Paris')).toBe('Europe/Paris')
    expect(() => assertTimeZone('Mars/Olympus')).toThrow('invalide')
  })

  it('escapes branded email content and never interpolates raw markup', () => {
    const email = scheduledReportEmail({ locale: 'fr', brandName: '<Yodev>', reportName: 'Bilan & plan', clientName: 'ACME "France"', reportUrl: 'https://ads.yodev.fr/r/a' })
    expect(email.subject).toBe('Bilan & plan · ACME "France"')
    expect(email.html).toContain('&lt;Yodev&gt;')
    expect(email.html).toContain('Bilan &amp; plan')
    expect(email.html).not.toContain('<Yodev>')
  })
})
