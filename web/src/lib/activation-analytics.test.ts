import { describe, expect, it } from 'vitest'
import { activationCohorts } from '@/lib/activation-analytics'

describe('activationCohorts', () => {
  it('groups workspaces by ISO week and counts later conversions in their signup cohort', () => {
    const result = activationCohorts([
      { id: 'a', createdAt: new Date('2026-08-03T10:00:00Z') },
      { id: 'b', createdAt: new Date('2026-08-05T10:00:00Z') },
    ], [
      { workspaceId: 'a', milestone: 'google_connected', occurredAt: new Date('2026-08-04T10:00:00Z') },
      { workspaceId: 'a', milestone: 'first_report', occurredAt: new Date('2026-08-10T10:00:00Z') },
      { workspaceId: 'a', milestone: 'paid_conversion', occurredAt: new Date('2026-08-17T10:00:00Z') },
    ], new Date('2026-08-12T10:00:00Z'), 2)
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
      { workspaceId: 'a', milestone: 'first_report', occurredAt: new Date('2026-08-08T00:00:00Z') },
      { workspaceId: 'a', milestone: 'first_report', occurredAt: new Date('2026-08-05T00:00:00Z') },
    ], new Date('2026-08-05T00:00:00Z'), 1)
    expect(result.medianDaysToFirstReport).toBe(2)
    expect(() => activationCohorts([], [], new Date(), 0)).toThrow(/range/)
  })
})
