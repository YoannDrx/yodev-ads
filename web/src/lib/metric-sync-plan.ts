import { calendarDates, MAXIMUM_HISTORY_DAYS, shiftCalendarDate, splitCalendarWindow, type CalendarWindow } from '@/lib/calendar-window'

export type MetricSyncWindow = CalendarWindow & { reason: 'recent' | 'backfill' | 'historical_review'; priority: number }

export function metricSyncPlan(input: { today: string; conversionLookbackDays: number | null; hasCoverage: boolean; oldestMetricDate: string | null; requestedWindow?: CalendarWindow }) {
  const earliest = shiftCalendarDate(input.today, -(MAXIMUM_HISTORY_DAYS - 1))
  if (input.requestedWindow) {
    calendarDates(input.requestedWindow)
    if (input.requestedWindow.from < earliest || input.requestedWindow.through > input.today) throw new Error('Metric repair window is outside retained history')
    return splitCalendarWindow(input.requestedWindow).reverse().map((window) => ({ ...window, reason: 'backfill' as const, priority: 40 }))
  }
  const lookback = input.conversionLookbackDays
  if (lookback !== null && (!Number.isInteger(lookback) || lookback < 0 || lookback > MAXIMUM_HISTORY_DAYS - 1)) throw new Error('Invalid conversion lookback window')
  // At least 32 prior days include the end of the previous month. Two extra
  // days allow ingestion lag beyond an observed conversion window. Unknown
  // settings retain the conservative 90-day reconciliation default.
  const recentDays = lookback === null ? 90 : Math.min(MAXIMUM_HISTORY_DAYS - 1, Math.max(32, lookback + 2))
  const from = shiftCalendarDate(input.today, -(input.hasCoverage ? recentDays : Math.max(90, recentDays)))
  const windows: MetricSyncWindow[] = splitCalendarWindow({ from, through: input.today }).reverse().map((window) => ({
    ...window, reason: input.hasCoverage ? 'recent' : 'backfill', priority: window.through >= shiftCalendarDate(input.today, -7) ? 35 : 45,
  }))
  // Revisit retained older dates continuously; no historical date is silently
  // declared final merely because it left the ordinary conversion window.
  if (input.oldestMetricDate && input.oldestMetricDate < from) {
    const historical = splitCalendarWindow({ from: input.oldestMetricDate < earliest ? earliest : input.oldestMetricDate, through: shiftCalendarDate(from, -1) })
    if (historical.length) {
      const day = Math.floor(Date.parse(`${input.today}T00:00:00Z`) / 86_400_000)
      windows.push({ ...historical[day % historical.length], reason: 'historical_review', priority: 80 })
    }
  }
  return windows
}
