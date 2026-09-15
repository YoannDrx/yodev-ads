import { accountCalendarDate, calendarDates, type CalendarWindow } from '@/lib/calendar-window'

export function metricCoverage(input: { window: CalendarWindow; timezone: string; currencyCode?: string; now?: Date; rows: Array<{
  metricDate: string; timezone?: string | null; currencyCode?: string; coverageStatus?: string; sourceVersion?: string | null; collectedAt?: Date;
}> }) {
  const dates = calendarDates(input.window)
  const today = accountCalendarDate(input.now ?? new Date(), input.timezone)
  const byDate = new Map(input.rows.map((row) => [row.metricDate, row]))
  const missingDates: string[] = [], partialDates: string[] = [], unqualifiedDates: string[] = [], versions = new Set<string>()
  let completeDays = 0
  for (const date of dates) {
    const row = byDate.get(date)
    if (!row) missingDates.push(date)
    else if (row.timezone !== input.timezone || (input.currencyCode && row.currencyCode !== input.currencyCode) || !row.sourceVersion || !['complete', 'partial'].includes(row.coverageStatus ?? '')) unqualifiedDates.push(date)
    else if (row.coverageStatus === 'partial' || date >= today) partialDates.push(date)
    else { completeDays++; versions.add(row.sourceVersion) }
  }
  return { state: completeDays === dates.length ? 'complete' as const : 'incomplete' as const, timezone: input.timezone,
    from: input.window.from, through: input.window.through, expectedDays: dates.length, completeDays,
    missingDates, partialDates, unqualifiedDates, sourceVersions: [...versions].sort() }
}
