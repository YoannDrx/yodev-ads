export type DailyPerformancePoint = {
  metricDate: string
  costMicros: string
  impressions: string
  clicks: string
  conversions: string
  conversionValueMicros: string
}

export type PerformanceMetric = 'costMicros' | 'impressions' | 'clicks' | 'conversions' | 'conversionValueMicros'
export type ComparisonKind = 'rolling_7' | 'rolling_30' | 'equivalent_weekdays'

type Totals = Record<PerformanceMetric, number>

export type PerformanceComparison = {
  kind: ComparisonKind
  label: string
  current: Totals
  previous: Totals
  currentCoverage: number
  previousCoverage: number
  available: boolean
  changes: Record<PerformanceMetric, number | null>
}

export type PerformanceChangeFinding = {
  id: string
  comparison: ComparisonKind
  metric: PerformanceMetric
  direction: 'increase' | 'decrease'
  changePercent: number
  confidence: 'low' | 'medium' | 'high'
  title: string
  description: string
}

const metrics: PerformanceMetric[] = ['costMicros', 'impressions', 'clicks', 'conversions', 'conversionValueMicros']
const emptyTotals = (): Totals => ({ costMicros: 0, impressions: 0, clicks: 0, conversions: 0, conversionValueMicros: 0 })

function utcDate(value: string) {
  const date = new Date(`${value}T00:00:00.000Z`)
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid performance date: ${value}`)
  return date
}

function dateKey(date: Date) {
  return date.toISOString().slice(0, 10)
}

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * 24 * 60 * 60_000)
}

function aggregate(points: Map<string, DailyPerformancePoint>, from: Date, through: Date) {
  const totals = emptyTotals()
  let observedDays = 0
  for (let date = from; date <= through; date = addDays(date, 1)) {
    const point = points.get(dateKey(date))
    if (!point) continue
    observedDays += 1
    totals.costMicros += Number(point.costMicros)
    totals.impressions += Number(point.impressions)
    totals.clicks += Number(point.clicks)
    totals.conversions += Number(point.conversions)
    totals.conversionValueMicros += Number(point.conversionValueMicros)
  }
  const expectedDays = Math.round((through.getTime() - from.getTime()) / (24 * 60 * 60_000)) + 1
  return { totals, coverage: observedDays / expectedDays }
}

function changes(current: Totals, previous: Totals) {
  return Object.fromEntries(metrics.map((metric) => [
    metric,
    previous[metric] === 0 ? null : (current[metric] - previous[metric]) / previous[metric],
  ])) as Record<PerformanceMetric, number | null>
}

function rollingComparison(points: Map<string, DailyPerformancePoint>, asOf: Date, days: 7 | 30, locale: 'fr' | 'en'): PerformanceComparison {
  const currentFrom = addDays(asOf, -(days - 1))
  const previousThrough = addDays(currentFrom, -1)
  const previousFrom = addDays(previousThrough, -(days - 1))
  const current = aggregate(points, currentFrom, asOf)
  const previous = aggregate(points, previousFrom, previousThrough)
  return {
    kind: days === 7 ? 'rolling_7' : 'rolling_30',
    label: locale === 'en' ? `${days} days vs previous period` : `${days} jours vs période précédente`,
    current: current.totals,
    previous: previous.totals,
    currentCoverage: current.coverage,
    previousCoverage: previous.coverage,
    available: current.coverage >= 0.7 && previous.coverage >= 0.7,
    changes: changes(current.totals, previous.totals),
  }
}

function equivalentWeekdayComparison(points: Map<string, DailyPerformancePoint>, asOf: Date, locale: 'fr' | 'en'): PerformanceComparison {
  const currentFrom = addDays(asOf, -6)
  const baselineThrough = addDays(currentFrom, -1)
  const baselineFrom = addDays(baselineThrough, -27)
  const current = aggregate(points, currentFrom, asOf)
  const baseline = aggregate(points, baselineFrom, baselineThrough)
  const normalized = Object.fromEntries(metrics.map((metric) => [metric, baseline.totals[metric] / 4])) as Totals
  return {
    kind: 'equivalent_weekdays',
    label: locale === 'en' ? '7 days vs average of 4 equivalent weeks' : '7 jours vs moyenne des 4 semaines équivalentes',
    current: current.totals,
    previous: normalized,
    currentCoverage: current.coverage,
    previousCoverage: baseline.coverage,
    available: current.coverage >= 0.7 && baseline.coverage >= 0.7,
    changes: changes(current.totals, normalized),
  }
}

function sufficientBaseline(metric: PerformanceMetric, comparison: PerformanceComparison) {
  const baseline = comparison.previous[metric]
  if (metric === 'impressions') return baseline >= 100
  if (metric === 'clicks') return baseline >= 20
  if (metric === 'conversions') return baseline >= 3
  return baseline >= 1_000_000
}

function findingConfidence(comparison: PerformanceComparison) {
  const coverage = Math.min(comparison.currentCoverage, comparison.previousCoverage)
  const volume = Math.max(comparison.current.clicks, comparison.previous.clicks)
  const conversions = Math.max(comparison.current.conversions, comparison.previous.conversions)
  if (coverage >= 0.9 && (volume >= 100 || conversions >= 10)) return 'high' as const
  if (coverage >= 0.75 && (volume >= 30 || conversions >= 3)) return 'medium' as const
  return 'low' as const
}

const metricLabels: Record<'fr' | 'en', Record<PerformanceMetric, string>> = {
  fr: { costMicros: 'Dépense', impressions: 'Impressions', clicks: 'Clics', conversions: 'Conversions', conversionValueMicros: 'Valeur de conversion' },
  en: { costMicros: 'Spend', impressions: 'Impressions', clicks: 'Clicks', conversions: 'Conversions', conversionValueMicros: 'Conversion value' },
}

export function analyzePerformanceChanges(history: DailyPerformancePoint[], locale: 'fr' | 'en' = 'fr') {
  if (history.length === 0) return { asOf: null, comparisons: [] as PerformanceComparison[], findings: [] as PerformanceChangeFinding[] }
  const points = new Map(history.map((point) => [point.metricDate, point]))
  const latestDate = [...points.keys()].sort().at(-1)!
  const asOf = utcDate(latestDate)
  const comparisons = [
    rollingComparison(points, asOf, 7, locale),
    rollingComparison(points, asOf, 30, locale),
    equivalentWeekdayComparison(points, asOf, locale),
  ]
  const findings = comparisons.flatMap<PerformanceChangeFinding>((comparison) => {
    if (!comparison.available) return []
    return metrics.flatMap<PerformanceChangeFinding>((metric) => {
      const changePercent = comparison.changes[metric]
      if (changePercent === null || Math.abs(changePercent) < 0.2 || !sufficientBaseline(metric, comparison)) return []
      const direction = changePercent > 0 ? 'increase' as const : 'decrease' as const
      return [{
        id: `${comparison.kind}:${metric}:${direction}`,
        comparison: comparison.kind,
        metric,
        direction,
        changePercent,
        confidence: findingConfidence(comparison),
        title: locale === 'en' ? `${metricLabels.en[metric]} ${direction === 'increase' ? 'up' : 'down'} ${Math.abs(changePercent * 100).toFixed(1)}%` : `${metricLabels.fr[metric]} en ${direction === 'increase' ? 'hausse' : 'baisse'} de ${Math.abs(changePercent * 100).toFixed(1)} %`,
        description: locale === 'en' ? `${comparison.label}. Deterministic statistical signal without automatic causal attribution; compare it with the timeline and business context.` : `${comparison.label}. Signal statistique déterministe, sans attribution causale automatique ; rapprochez-le de la timeline et du contexte métier.`,
      }]
    })
  })
  return { asOf: latestDate, comparisons, findings }
}
