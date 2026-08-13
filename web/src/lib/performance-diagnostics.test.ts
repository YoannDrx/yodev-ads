import { describe, expect, it } from 'vitest'
import { analyzePerformanceChanges, type DailyPerformancePoint } from './performance-diagnostics'

function history(days: number, changeLastSeven = false): DailyPerformancePoint[] {
  return Array.from({ length: days }, (_, index) => {
    const date = new Date(Date.UTC(2026, 7, 12 - (days - 1 - index)))
    const uplift = changeLastSeven && index >= days - 7 ? 2 : 1
    return {
      metricDate: date.toISOString().slice(0, 10),
      costMicros: String(10_000_000 * uplift),
      impressions: String(1_000 * uplift),
      clicks: String(100 * uplift),
      conversions: String(10 * uplift),
      conversionValueMicros: String(50_000_000 * uplift),
    }
  })
}

describe('performance change diagnostics', () => {
  it('builds 7-day, 30-day and equivalent-weekday comparisons', () => {
    const result = analyzePerformanceChanges(history(70, true))
    expect(result.asOf).toBe('2026-08-12')
    expect(result.comparisons.map((comparison) => comparison.kind)).toEqual(['rolling_7', 'rolling_30', 'equivalent_weekdays'])
    expect(result.comparisons[0]).toMatchObject({ available: true, currentCoverage: 1, previousCoverage: 1 })
    expect(result.comparisons[0].changes.conversions).toBe(1)
    expect(result.findings.find((finding) => finding.id === 'rolling_7:conversions:increase')).toMatchObject({
      confidence: 'high', changePercent: 1,
    })
    expect(result.findings[0]?.description).toContain('sans attribution causale')
  })

  it('marks incomplete comparison windows unavailable instead of filling missing days', () => {
    const result = analyzePerformanceChanges(history(10))
    expect(result.comparisons[0].available).toBe(false)
    expect(result.comparisons[1].available).toBe(false)
    expect(result.findings).toEqual([])
  })

  it('does not flag low-volume or sub-threshold noise', () => {
    const rows = history(70).map((point, index) => ({
      ...point,
      clicks: index >= 63 ? '3' : '2',
      conversions: '0',
      costMicros: index >= 63 ? '1100000' : '1000000',
      conversionValueMicros: '0',
    }))
    const result = analyzePerformanceChanges(rows)
    expect(result.findings.filter((finding) => finding.metric === 'clicks' || finding.metric === 'costMicros')).toEqual([])
  })

  it('returns an explicit empty state when no daily history exists', () => {
    expect(analyzePerformanceChanges([])).toEqual({ asOf: null, comparisons: [], findings: [] })
  })

  it('localizes comparison labels and deterministic findings in English', () => {
    const result = analyzePerformanceChanges(history(70, true), 'en')
    expect(result.comparisons.map((comparison) => comparison.label)).toEqual([
      '7 days vs previous period',
      '30 days vs previous period',
      '7 days vs average of 4 equivalent weeks',
    ])
    expect(result.findings.find((finding) => finding.metric === 'clicks')).toMatchObject({
      title: 'Clicks up 100.0%',
      description: expect.stringContaining('without automatic causal attribution'),
    })
  })
})
