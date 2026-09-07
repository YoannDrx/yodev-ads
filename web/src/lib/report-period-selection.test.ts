import { describe, expect, it } from 'vitest'
import { describeReportPeriod, reportPeriodFromForm, reportPeriodSelectionSchema, resolveReportPeriod, storedReportPeriod } from './report-period-selection'

describe('Stored calendar report periods', () => {
  it.each([7, 30, 90])('resolves a legacy %s-day selection to complete account-local dates', (periodDays) => {
    const selected = storedReportPeriod({ periodDays })
    const window = resolveReportPeriod(selected, new Date('2026-03-10T01:00:00Z'), 'America/New_York')
    expect(window.days).toBe(periodDays)
    expect(window.through).toBe('2026-03-08')
    expect(window.timezone).toBe('America/New_York')
  })
  it.each([['2026-03-05', 28], ['2024-03-05', 29]])('uses the whole preceding February at %s', (date, days) => {
    const window = resolveReportPeriod({ period: 'previous_month' }, new Date(`${date}T12:00:00Z`), 'Europe/Paris')
    expect(window.days).toBe(days)
    expect(window.from).toBe(`${date.slice(0, 4)}-02-01`)
    expect(window.through).toBe(`${date.slice(0, 4)}-02-${days}`)
  })
  it('parses custom form dates and gives stored explicit config precedence over legacy days', () => {
    const config = reportPeriodFromForm({ period: 'custom', periodFrom: '2026-08-01', periodThrough: '2026-08-12' })
    expect(storedReportPeriod({ periodConfig: config, periodDays: 30 })).toEqual(config)
    expect(resolveReportPeriod(config, new Date('2026-09-01T12:00:00Z'), 'Europe/Paris').days).toBe(12)
    expect(describeReportPeriod(config, 'fr')).toBe('2026-08-01 → 2026-08-12')
  })
  it('rejects future, incomplete, expired, reversed and non-calendar dates', () => {
    for (const [from, through] of [['2026-09-01', '2026-09-01'], ['2022-01-01', '2022-01-03'], ['2026-08-20', '2026-08-01'], ['2026-02-30', '2026-03-01']]) {
      expect(() => resolveReportPeriod({ period: 'custom', from, through }, new Date('2026-09-01T12:00:00Z'), 'Europe/Paris')).toThrow()
    }
    expect(() => reportPeriodFromForm({ period: 'custom' })).toThrow()
    expect(() => storedReportPeriod({ periodDays: 45 })).toThrow()
    expect(() => reportPeriodSelectionSchema.parse({ period: '30', from: '2026-08-01' })).toThrow()
  })
  it('keeps numeric form compatibility and localizes period labels', () => {
    expect(reportPeriodFromForm({ periodDays: '90' })).toEqual({ period: '90' })
    expect(reportPeriodFromForm({})).toEqual({ period: '30' })
    expect(describeReportPeriod({ period: 'previous_month' }, 'en')).toBe('Previous calendar month')
    expect(describeReportPeriod({ period: 'previous_month' }, 'fr')).toBe('Mois civil précédent')
    expect(describeReportPeriod({ period: '7' }, 'en')).toBe('7 completed days')
    expect(describeReportPeriod({ period: '7' }, 'fr')).toBe('7 jours complets')
  })
})
