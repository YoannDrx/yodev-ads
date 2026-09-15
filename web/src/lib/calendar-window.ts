/** Calendar dates are account-local labels, never instants at a fixed UTC offset. */
export type CalendarWindow = { from: string; through: string }
const DAY_MS = 86_400_000
export const MAXIMUM_HISTORY_DAYS = 730

export function assertCalendarDate(value: string) {
  const date = new Date(`${value}T00:00:00.000Z`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error('Invalid calendar date')
  }
  return value
}

export function accountCalendarDate(now: Date, timezone: string) {
  if (!Number.isFinite(now.getTime())) throw new Error('Invalid calendar instant')
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(now).map((part) => [part.type, part.value]))
  return assertCalendarDate(`${parts.year}-${parts.month}-${parts.day}`)
}

export function shiftCalendarDate(value: string, days: number) {
  assertCalendarDate(value)
  if (!Number.isInteger(days) || Math.abs(days) > MAXIMUM_HISTORY_DAYS * 2) throw new Error('Invalid calendar day offset')
  return assertCalendarDate(new Date(Date.parse(`${value}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10))
}

export function calendarDates(window: CalendarWindow, maximumDays = MAXIMUM_HISTORY_DAYS) {
  assertCalendarDate(window.from)
  assertCalendarDate(window.through)
  const count = Math.round((Date.parse(`${window.through}T00:00:00Z`) - Date.parse(`${window.from}T00:00:00Z`)) / DAY_MS) + 1
  if (!Number.isInteger(maximumDays) || maximumDays < 1 || maximumDays > MAXIMUM_HISTORY_DAYS || count < 1 || count > maximumDays) throw new Error('Invalid calendar window')
  return Array.from({ length: count }, (_, index) => shiftCalendarDate(window.from, index))
}

export function splitCalendarWindow(window: CalendarWindow, chunkDays = 7) {
  if (!Number.isInteger(chunkDays) || chunkDays < 1 || chunkDays > 31) throw new Error('Invalid metric chunk size')
  const dates = calendarDates(window)
  const chunks: CalendarWindow[] = []
  for (let index = 0; index < dates.length; index += chunkDays) chunks.push({ from: dates[index], through: dates[Math.min(index + chunkDays - 1, dates.length - 1)] })
  return chunks
}

export function reportCalendarWindow(input: { period: '7' | '30' | '90' | 'previous_month' | 'custom'; now: Date; timezone: string; custom?: CalendarWindow }) {
  const today = accountCalendarDate(input.now, input.timezone)
  let window: CalendarWindow
  if (input.period === 'custom') {
    if (!input.custom) throw new Error('A custom report requires dates')
    window = input.custom
  } else if (input.period === 'previous_month') {
    const through = shiftCalendarDate(`${today.slice(0, 7)}-01`, -1)
    window = { from: `${through.slice(0, 7)}-01`, through }
  } else {
    const days = Number(input.period)
    if (![7, 30, 90].includes(days)) throw new Error('Unsupported report period')
    window = { from: shiftCalendarDate(today, -days), through: shiftCalendarDate(today, -1) }
  }
  const dates = calendarDates(window)
  if (window.through >= today || window.from < shiftCalendarDate(today, -(MAXIMUM_HISTORY_DAYS - 1))) throw new Error('Report dates must be completed days within retained history')
  return { ...window, timezone: input.timezone, days: dates.length, today }
}
