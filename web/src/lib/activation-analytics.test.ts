import { describe, expect, it } from 'vitest'
import { activationCohorts } from '@/lib/activation-analytics'

describe('activationCohorts', () => {
  it('groups workspaces by ISO week and counts later conversions in their signup cohort', () => {
    const result = activationCohorts([
      { id: 'a', createdAt: new Date('2026-08-03T10:00:00Z') },
      { id: 'b', createdAt: new Date('2026-08-05T10:00:00Z') },
    ], [
      { workspaceId: 'a', milestone: 'google_connected', occurredAt: new Date('2026-08-04T10:00:00Z') },
      { workspaceId: 'a', milestone: 'first_report_published', occurredAt: new Date('2026-08-10T10:00:00Z') },
      { workspaceId: 'a', milestone: 'paid_conversion', occurredAt: new Date('2026-08-17T10:00:00Z') },
    ], new Date('2026-08-19T10:00:00Z'), 3)
    expect(result.cohorts[0]).toMatchObject({ weekStart: '2026-08-03', workspaces: 2, googleConnected: 1, firstReport: 1, paid: 1 })
    expect(result.medianDaysToFirstReport).toBe(7)
    expect(result.medianDaysToPaid).toBe(14)
  })

  it('keeps empty weeks and returns null medians without conversions', () => {
    const result = activationCohorts([], [], new Date('2026-08-12T10:00:00Z'), 3)
    expect(result.cohorts).toHaveLength(3)
    expect(result.cohorts.every((cohort) => cohort.workspaces === 0)).toBe(true)
    expect(result.medianDaysToFirstReport).toBeNull()
    expect(result.medianDaysToPaid).toBeNull()
  })

  it('keeps the earliest milestone and rejects invalid ranges', () => {
    const workspace = { id: 'a', createdAt: new Date('2026-08-03T00:00:00Z') }
    const result = activationCohorts([workspace], [
      { workspaceId: 'a', milestone: 'first_report_published', occurredAt: new Date('2026-08-08T00:00:00Z') },
      { workspaceId: 'a', milestone: 'first_report_published', occurredAt: new Date('2026-08-05T00:00:00Z') },
    ], new Date('2026-08-05T00:00:00Z'), 1)
    expect(result.medianDaysToFirstReport).toBe(2)
    expect(() => activationCohorts([], [], new Date(), 0)).toThrow(/range/)
  })

  it('does not count a legacy schedule marker, future events or events before signup', () => {
    const now = new Date('2026-08-12T12:00:00Z'), createdAt = new Date('2026-08-03T10:00:00Z')
    const result = activationCohorts([{ id: 'a', createdAt }, { id: 'future', createdAt: new Date('2026-08-13') }, { id: 'invalid', createdAt: new Date(NaN) }], [
      { workspaceId: 'a', milestone: 'first_report', occurredAt: new Date('2026-08-04') },
      { workspaceId: 'a', milestone: 'first_report_published', occurredAt: new Date('2026-08-13') },
      { workspaceId: 'a', milestone: 'paid_conversion', occurredAt: new Date('2026-08-02') },
      { workspaceId: 'a', milestone: 'google_connected', occurredAt: new Date(NaN) },
    ], now, 2)
    expect(result.cohorts[0]).toMatchObject({ workspaces: 1, firstReport: 0, paid: 0, googleConnected: 0 })
    expect(result.cohorts[1].workspaces).toBe(0)
    expect(result.medianDaysToFirstReport).toBeNull()
    expect(() => activationCohorts([], [], new Date(NaN))).toThrow(/reference date/)
  })

  it('keeps a valid publication even when an earlier duplicate predates signup', () => {
    const result = activationCohorts([{ id: 'a', createdAt: new Date('2026-08-03') }], [
      { workspaceId: 'a', milestone: 'first_report_published', occurredAt: new Date('2026-08-02') },
      { workspaceId: 'a', milestone: 'first_report_published', occurredAt: new Date('2026-08-04') },
    ], new Date('2026-08-12'), 2)
    expect(result.cohorts[0].firstReport).toBe(1)
    expect(result.medianDaysToFirstReport).toBe(1)
  })
})
