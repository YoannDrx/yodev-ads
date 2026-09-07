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
  it('measures all intermediate stages independently with observed-only medians', () => {
    const workspaces = ['a', 'b', 'c'].map((id) => ({ id, createdAt: new Date('2026-08-03') }))
    const result = activationCohorts(workspaces, [
      { workspaceId: 'a', milestone: 'accounts_synced', occurredAt: new Date('2026-08-04') },
      { workspaceId: 'a', milestone: 'accounts_selected', occurredAt: new Date('2026-08-05') },
      { workspaceId: 'b', milestone: 'accounts_selected', occurredAt: new Date('2026-08-07') },
      { workspaceId: 'b', milestone: 'first_qualified_analysis', occurredAt: new Date('2026-08-08') },
      { workspaceId: 'b', milestone: 'first_qualified_analysis', occurredAt: new Date('2026-08-09') },
      { workspaceId: 'a', milestone: 'first_monitor', occurredAt: new Date('2026-08-10') },
      { workspaceId: 'a', milestone: 'legal_accepted', occurredAt: new Date('2026-08-03') },
      { workspaceId: 'c', milestone: 'first_analysis', occurredAt: new Date('2026-08-04') },
      { workspaceId: 'c', milestone: 'first_monitor', occurredAt: new Date('2026-08-02') },
      { workspaceId: 'c', milestone: 'legal_accepted', occurredAt: new Date('2026-08-20') },
      { workspaceId: 'foreign', milestone: 'first_monitor', occurredAt: new Date('2026-08-04') },
    ], new Date('2026-08-12T00:00:00Z'), 2)
    expect(result.cohorts[0]).toMatchObject({ workspaces: 3, googleConnected: 0, accountsSynced: 1, accountsSelected: 2, firstAnalysis: 1, firstMonitor: 1, firstReport: 0, legalAccepted: 1, paid: 0 })
    expect(result.medianDaysByStage).toEqual({ googleConnected: null, accountsSynced: 1, accountsSelected: 3, firstAnalysis: 5, firstMonitor: 7, firstReport: null, legalAccepted: 0, paid: null })
    expect(result.asOf).toBe('2026-08-12T00:00:00.000Z')
  })

  it('keeps UTC Monday boundaries over a year change and excludes older cohort conversions', () => {
    const result = activationCohorts([
      { id: 'old', createdAt: new Date('2025-12-21T23:59:59Z') },
      { id: 'sunday', createdAt: new Date('2025-12-28T23:59:59Z') },
      { id: 'monday', createdAt: new Date('2025-12-29T00:00:00Z') },
    ], [
      { workspaceId: 'old', milestone: 'first_qualified_analysis', occurredAt: new Date('2026-01-02') },
      { workspaceId: 'monday', milestone: 'first_qualified_analysis', occurredAt: new Date('2026-01-02') },
    ], new Date('2026-01-02T12:00:00Z'), 2)
    expect(result.cohorts.map(({ weekStart, workspaces, firstAnalysis }) => ({ weekStart, workspaces, firstAnalysis }))).toEqual([
      { weekStart: '2025-12-22', workspaces: 1, firstAnalysis: 0 }, { weekStart: '2025-12-29', workspaces: 1, firstAnalysis: 1 },
    ])
    expect(result.medianDaysByStage.firstAnalysis).toBe(4)
  })

})
