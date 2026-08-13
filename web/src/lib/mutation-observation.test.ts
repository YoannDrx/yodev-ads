import { describe, expect, it } from 'vitest'
import { mutationObservationCalendar, mutationObservationOutcome, type MutationObservationMetrics } from './mutation-observation'

const metrics = (overrides: Partial<MutationObservationMetrics> = {}): MutationObservationMetrics => ({
  dataPoints: 7, expectedDataPoints: 7, costMicros: '100', impressions: '1000', clicks: '100', conversions: '10', conversionValueMicros: '500', ...overrides,
})

describe('mutation observation', () => {
  it('uses complete local calendar days before and after execution', () => {
    expect(mutationObservationCalendar(new Date('2026-03-29T22:30:00Z'), 'Europe/Paris', 7)).toMatchObject({
      baselineFrom: '2026-03-23', baselineThrough: '2026-03-29', observationFrom: '2026-03-31', observationThrough: '2026-04-06',
    })
  })

  it('computes deterministic deltas without inventing a percentage from zero', () => {
    expect(mutationObservationOutcome(metrics(), metrics({ costMicros: '120', conversions: '12' }))).toEqual(expect.objectContaining({
      state: 'completed', deltasPercent: expect.objectContaining({ cost: 20, conversions: 20 }),
    }))
    expect(mutationObservationOutcome(metrics({ costMicros: '0' }), metrics())).toEqual(expect.objectContaining({
      deltasPercent: expect.objectContaining({ cost: null }),
    }))
  })

  it('marks incomplete daily series explicitly', () => {
    expect(mutationObservationOutcome(metrics(), metrics({ dataPoints: 5 }))).toEqual(expect.objectContaining({ state: 'insufficient_data' }))
  })
})
