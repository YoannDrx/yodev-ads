import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { analyticalSnapshotData, analyticalSnapshotState, type AnalyticalSnapshot } from './analytical-model'
import { metricCoverage } from './metric-coverage'
import { qualifiedMutationObservation } from './mutation-observation'

const now = new Date('2026-09-07T09:00:00Z')
const client = { timezone: 'Europe/Paris', currencyCode: 'EUR' }
const row: AnalyticalSnapshot = { family: 'campaigns', contractVersion: 1, periodFrom: '2026-08-08', periodThrough: '2026-09-06', ...client,
  sourceVersion: 'version', observedAt: now, collectedAt: now, payload: [] }

describe('persisted analytical qualification', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(now) })
  afterEach(() => vi.useRealTimers())
  it('distinguishes a successfully empty snapshot from a cold cache and an old value', () => {
    expect(analyticalSnapshotState(undefined, client, now)).toBe('unavailable')
    expect(analyticalSnapshotState(row, client, now)).toBe('available')
    expect(analyticalSnapshotData([row], 'campaigns', client)).toEqual([])
    expect(analyticalSnapshotState({ ...row, observedAt: new Date('2026-09-05T00:00:00Z') }, client, now)).toBe('stale')
    expect(analyticalSnapshotState({ ...row, periodFrom: '2026-08-07', periodThrough: '2026-09-05' }, client, now)).toBe('stale')
  })
  it('invalidates incompatible timezone, currency, contract and malformed values', () => {
    for (const change of [{ timezone: 'UTC' }, { currencyCode: 'USD' }, { contractVersion: 2 }, { periodFrom: '2026-08-40' }, { periodFrom: '2026-08-09', periodThrough: '2026-09-07' }, { observedAt: new Date('2099-01-01') }]) {
      expect(analyticalSnapshotState({ ...row, ...change }, client, now)).toBe('unavailable')
      expect(analyticalSnapshotData([{ ...row, ...change }], 'campaigns', client)).toBeUndefined()
    }
    expect(analyticalSnapshotData([{ ...row, payload: null }], 'campaigns', client)).toBeUndefined()
  })
  it('reports exact gaps, partial dates and legacy rows without certifying them', () => {
    const coverage = metricCoverage({ window: { from: '2026-09-01', through: '2026-09-07' }, timezone: client.timezone, now, rows: [
      { metricDate: '2026-09-01', timezone: client.timezone, coverageStatus: 'complete', sourceVersion: 'v1' },
      { metricDate: '2026-09-02', timezone: client.timezone, coverageStatus: 'legacy' },
      { metricDate: '2026-09-03', timezone: 'UTC', coverageStatus: 'complete', sourceVersion: 'v2' },
      { metricDate: '2026-09-05', timezone: client.timezone, coverageStatus: 'partial', sourceVersion: 'v3' },
      { metricDate: '2026-09-06', timezone: client.timezone, coverageStatus: 'complete', sourceVersion: 'v4' },
      { metricDate: '2026-09-07', timezone: client.timezone, coverageStatus: 'complete', sourceVersion: 'v5' },
    ] })
    expect(coverage).toMatchObject({ state: 'incomplete', completeDays: 2, expectedDays: 7, missingDates: ['2026-09-04'], unqualifiedDates: ['2026-09-02', '2026-09-03'], partialDates: ['2026-09-05', '2026-09-07'], sourceVersions: ['v1', 'v4'] })
  })
  it('qualifies old completed observations on read without mutating stored evidence', () => {
    const metrics = { dataPoints: 7, expectedDataPoints: 7, costMicros: '100', impressions: '10', clicks: '5', conversions: '1', conversionValueMicros: '500' }
    const stored = { status: 'completed', baselineMetrics: metrics, observedMetrics: metrics, outcome: { deltasPercent: { cost: 200 } } }
    expect(qualifiedMutationObservation(stored)).toMatchObject({ status: 'insufficient_data', outcome: { deltasPercent: { cost: null } } })
    expect(stored.outcome.deltasPercent.cost).toBe(200)
    expect(qualifiedMutationObservation({ ...stored, observedMetrics: null })).toMatchObject({ status: 'insufficient_data', outcome: null })
    expect(qualifiedMutationObservation({ ...stored, baselineMetrics: { ...metrics, coverageVersion: 1 }, observedMetrics: { ...metrics, coverageVersion: 1 } })).toMatchObject({ status: 'completed', outcome: { deltasPercent: { cost: 0 } } })
  })
})
