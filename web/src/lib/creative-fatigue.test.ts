import { describe, expect, it } from 'vitest'
import { creativeFatigueSignal } from './creative-fatigue'

describe('creative fatigue signal', () => {
  it('requires meaningful volume before producing a signal', () => {
    expect(creativeFatigueSignal({ current: { impressions: 900, clicks: 5, conversions: 0, conversionValue: 0 }, previous: { impressions: 2_000, clicks: 100, conversions: 2, conversionValue: 10 }, performanceLabel: 'LOW' }).status).toBe('insufficient_data')
  })

  it('flags a material CTR decline without asserting causality', () => {
    expect(creativeFatigueSignal({ current: { impressions: 10_000, clicks: 200, conversions: 4, conversionValue: 40 }, previous: { impressions: 10_000, clicks: 400, conversions: 8, conversionValue: 80 }, performanceLabel: 'LOW' })).toMatchObject({ status: 'review', confidence: 'high', ctrChange: -0.5 })
  })

  it('keeps stable assets out of the review queue', () => {
    expect(creativeFatigueSignal({ current: { impressions: 2_000, clicks: 80, conversions: 2, conversionValue: 20 }, previous: { impressions: 2_000, clicks: 75, conversions: 2, conversionValue: 20 }, performanceLabel: 'GOOD' }).status).toBe('stable')
  })
})
