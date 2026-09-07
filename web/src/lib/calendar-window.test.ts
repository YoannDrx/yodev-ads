import { describe, expect, it } from 'vitest'
import { accountCalendarDate, assertCalendarDate, calendarDates, reportCalendarWindow, shiftCalendarDate, splitCalendarWindow } from './calendar-window'

describe('account-local calendar windows', () => {
  it.each(['2026-02-29', '2026-13-01', '2026-04-31', '2026-1-01', 'invalid'])('rejects impossible or noncanonical date %s', (date) => expect(() => assertCalendarDate(date)).toThrow('Invalid'))
  it('handles leap years and year boundaries without elapsed-hour arithmetic', () => {
    expect(shiftCalendarDate('2024-03-01', -1)).toBe('2024-02-29')
    expect(shiftCalendarDate('2026-01-01', -1)).toBe('2025-12-31')
    expect(() => shiftCalendarDate('2026-01-01', 1.5)).toThrow()
    expect(() => shiftCalendarDate('2026-01-01', 10000)).toThrow()
  })
  it('uses the account day on both sides of midnight and DST transitions', () => {
    const midnight = new Date('2026-03-29T00:30:00Z')
    expect(accountCalendarDate(midnight, 'Europe/Paris')).toBe('2026-03-29')
    expect(accountCalendarDate(midnight, 'America/Los_Angeles')).toBe('2026-03-28')
    for (const instant of ['2026-03-29T01:30:00Z', '2026-10-25T01:30:00Z']) {
      const today = accountCalendarDate(new Date(instant), 'Europe/Paris')
      expect(calendarDates({ from: shiftCalendarDate(today, -6), through: today })).toHaveLength(7)
    }
    expect(() => accountCalendarDate(midnight, 'Invalid/Timezone')).toThrow()
    expect(() => accountCalendarDate(new Date('invalid'), 'UTC')).toThrow()
  })
  it('partitions every date exactly once and refuses unbounded ranges', () => {
    const window = { from: '2026-06-09', through: '2026-09-07' }
    const dates = calendarDates(window)
    expect(splitCalendarWindow(window).flatMap((chunk) => calendarDates(chunk))).toEqual(dates)
    expect(dates).toHaveLength(91)
    expect(() => calendarDates({ from: window.through, through: window.from })).toThrow()
    expect(() => calendarDates({ from: '2020-01-01', through: '2026-01-01' })).toThrow()
    expect(() => splitCalendarWindow(window, 0)).toThrow()
  })
  it('defines 7/30/90 reports on complete account-local days', () => {
    for (const period of ['7', '30', '90'] as const) {
      const result = reportCalendarWindow({ period, now: new Date('2026-09-07T01:00:00Z'), timezone: 'Europe/Paris' })
      expect(result.days).toBe(Number(period))
      expect(result.through).toBe('2026-09-06')
    }
  })
  it('resolves the previous month and bounds custom reports by retention and the completed day', () => {
    const base = { now: new Date('2024-03-01T12:00:00Z'), timezone: 'UTC' }
    expect(reportCalendarWindow({ ...base, period: 'previous_month' })).toMatchObject({ from: '2024-02-01', through: '2024-02-29', days: 29 })
    expect(reportCalendarWindow({ ...base, period: 'custom', custom: { from: '2024-02-01', through: '2024-02-12' } }).days).toBe(12)
    expect(() => reportCalendarWindow({ ...base, period: 'custom' })).toThrow()
    expect(() => reportCalendarWindow({ ...base, period: 'custom', custom: { from: '2024-03-01', through: '2024-03-01' } })).toThrow()
    expect(() => reportCalendarWindow({ ...base, period: 'custom', custom: { from: '2020-01-01', through: '2020-01-01' } })).toThrow()
  })
})
