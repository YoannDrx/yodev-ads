import { describe, expect, it } from 'vitest'
import { calendarDates, shiftCalendarDate } from './calendar-window'
import { metricSyncPlan } from './metric-sync-plan'

const base = { today: '2026-09-07', conversionLookbackDays: null, hasCoverage: false, oldestMetricDate: null }
describe('resumable metric history planning', () => {
  it('backfills ninety completed days plus the partial current day, without gaps or overlaps', () => {
    const chunks = metricSyncPlan(base)
    const dates = chunks.flatMap((chunk) => calendarDates(chunk)).sort()
    expect(dates).toEqual(calendarDates({ from: '2026-06-09', through: base.today }))
    expect(new Set(dates).size).toBe(91)
    expect(chunks.every((chunk) => calendarDates(chunk).length <= 7)).toBe(true)
    expect(chunks[0].through).toBe(base.today)
    expect(chunks[0].priority).toBe(35)
  })
  it('adapts daily rereads to observed windows while retaining previous-month coverage', () => {
    const short = metricSyncPlan({ ...base, conversionLookbackDays: 7, hasCoverage: true })
    expect(short.at(-1)?.from).toBe(shiftCalendarDate(base.today, -32))
    const long = metricSyncPlan({ ...base, conversionLookbackDays: 90, hasCoverage: true })
    expect(long.at(-1)?.from).toBe(shiftCalendarDate(base.today, -92))
    const initial = metricSyncPlan({ ...base, conversionLookbackDays: 7 })
    expect(initial.at(-1)?.from).toBe(shiftCalendarDate(base.today, -90))
  })
  it('rotates through retained older history rather than treating it as permanently closed', () => {
    const input = { ...base, hasCoverage: true, oldestMetricDate: '2024-01-01' }
    const first = metricSyncPlan(input).at(-1)!
    const second = metricSyncPlan({ ...input, today: '2026-09-08' }).at(-1)!
    expect(first.reason).toBe('historical_review')
    expect(first.from >= shiftCalendarDate(base.today, -729)).toBe(true)
    expect(first.through < shiftCalendarDate(base.today, -90)).toBe(true)
    expect(first.from).not.toBe(second.from)
  })
  it('freezes explicit repair dates and refuses future, excessive or invalid windows', () => {
    const requestedWindow = { from: '2026-08-29', through: '2026-09-02' }
    expect(metricSyncPlan({ ...base, requestedWindow })).toEqual([{ ...requestedWindow, reason: 'backfill', priority: 40 }])
    for (const requestedWindow of [{ from: '2020-01-01', through: '2020-01-02' }, { from: '2026-09-07', through: '2026-09-08' }]) {
      expect(() => metricSyncPlan({ ...base, requestedWindow })).toThrow('retained history')
    }
    for (const conversionLookbackDays of [-1, 1.5, 730]) expect(() => metricSyncPlan({ ...base, conversionLookbackDays })).toThrow()
  })
})
