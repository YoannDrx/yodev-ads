export type MutationObservationMetrics = {
  dataPoints: number
  expectedDataPoints: number
  costMicros: string
  impressions: string
  clicks: string
  conversions: string
  conversionValueMicros: string
}

function localDate(date: Date, timezone: string) {
  const values = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date).map((part) => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

function shiftDate(date: string, days: number) {
  const shifted = new Date(`${date}T12:00:00.000Z`)
  shifted.setUTCDate(shifted.getUTCDate() + days)
  return shifted.toISOString().slice(0, 10)
}

export function mutationObservationCalendar(executedAt: Date, timezone: string, windowDays = 7) {
  if (!Number.isInteger(windowDays) || windowDays < 1 || windowDays > 30) throw new Error('Invalid observation window')
  const executionDate = localDate(executedAt, timezone)
  return {
    baselineFrom: shiftDate(executionDate, -windowDays),
    baselineThrough: shiftDate(executionDate, -1),
    observationFrom: shiftDate(executionDate, 1),
    observationThrough: shiftDate(executionDate, windowDays),
    availableAt: new Date(`${shiftDate(executionDate, windowDays + 1)}T12:00:00.000Z`),
  }
}

function percentageDelta(beforeRaw: string, afterRaw: string) {
  const before = Number(beforeRaw)
  const after = Number(afterRaw)
  if (!Number.isFinite(before) || !Number.isFinite(after) || before === 0) return null
  return Math.round(((after - before) / before) * 10_000) / 100
}

export function mutationObservationOutcome(baseline: MutationObservationMetrics, observed: MutationObservationMetrics) {
  const complete = baseline.dataPoints >= baseline.expectedDataPoints && observed.dataPoints >= observed.expectedDataPoints
  return {
    state: complete ? 'completed' : 'insufficient_data',
    coverage: {
      baseline: baseline.expectedDataPoints ? baseline.dataPoints / baseline.expectedDataPoints : 0,
      observed: observed.expectedDataPoints ? observed.dataPoints / observed.expectedDataPoints : 0,
    },
    deltasPercent: {
      cost: percentageDelta(baseline.costMicros, observed.costMicros),
      impressions: percentageDelta(baseline.impressions, observed.impressions),
      clicks: percentageDelta(baseline.clicks, observed.clicks),
      conversions: percentageDelta(baseline.conversions, observed.conversions),
      conversionValue: percentageDelta(baseline.conversionValueMicros, observed.conversionValueMicros),
    },
  }
}
