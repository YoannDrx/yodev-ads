import { describe, expect, it } from 'vitest'
import { buildPacingBudgetRecommendations, computePacing, pacingCalendar, type PacingCampaign, type PacingGoal } from './pacing'

const goal: PacingGoal = {
  primaryKpi: 'cpa',
  monthlyBudgetMicros: 310_000_000,
  targetCpaMicros: 50_000_000,
  targetRoas: null,
  targetConversions: null,
  targetConversionValueMicros: null,
}

const strongCampaign: PacingCampaign = {
  id: '1', name: 'Search gagnante', status: 'ENABLED', budgetResourceName: 'budgets/1', budgetMicros: '50000000',
  clicks: '100', costMicros: '100000000', conversions: 4, conversionValueMicros: '400000000',
  searchBudgetLostImpressionShare: 0.2, searchRankLostImpressionShare: 0.1,
}

const weakCampaign: PacingCampaign = {
  id: '2', name: 'Search faible', status: 'ENABLED', budgetResourceName: 'budgets/2', budgetMicros: '40000000',
  clicks: '120', costMicros: '120000000', conversions: 1, conversionValueMicros: '20000000',
  searchBudgetLostImpressionShare: 0.05, searchRankLostImpressionShare: 0.4,
}

describe('monthly pacing', () => {
  it('handles short months, leap years and client timezones', () => {
    expect(pacingCalendar(new Date('2028-03-01T00:30:00Z'), 'America/New_York')).toMatchObject({ year: 2028, month: 2, elapsedDays: 29, daysInMonth: 29, through: '2028-02-29' })
    expect(pacingCalendar(new Date('2026-05-01T00:30:00Z'), 'America/Los_Angeles')).toMatchObject({ month: 4, elapsedDays: 30, daysInMonth: 30 })
  })

  it('computes expected spend, variance and forecast', () => {
    expect(computePacing({ monthlyBudgetMicros: 3_100, actualSpendMicros: 900, elapsedDays: 10, daysInMonth: 31, observedDays: 10 })).toEqual({
      status: 'on_track', actualSpendMicros: 900, expectedSpendMicros: 1000, varianceMicros: -100, variancePercent: -0.1, forecastMicros: 2790,
    })
    expect(computePacing({ monthlyBudgetMicros: 3_100, actualSpendMicros: 700, elapsedDays: 10, daysInMonth: 31, observedDays: 10 }).status).toBe('under')
    expect(computePacing({ monthlyBudgetMicros: 3_100, actualSpendMicros: 1_200, elapsedDays: 10, daysInMonth: 31, observedDays: 10 }).status).toBe('over')
  })

  it('signals missing data instead of manufacturing a recommendation', () => {
    expect(computePacing({ monthlyBudgetMicros: 3_100, actualSpendMicros: 0, elapsedDays: 10, daysInMonth: 31, observedDays: 0 }).status).toBe('missing_data')
    expect(computePacing({ monthlyBudgetMicros: 0, actualSpendMicros: 0, elapsedDays: 10, daysInMonth: 31, observedDays: 10 }).status).toBe('missing_data')
    expect(computePacing({ monthlyBudgetMicros: 3_100, actualSpendMicros: 0, elapsedDays: 0, daysInMonth: 31, observedDays: 10 }).status).toBe('missing_data')
  })

  it('requires an objective, its matching target and enough collected history', () => {
    const pacing = computePacing({ monthlyBudgetMicros: 310_000_000, actualSpendMicros: 70_000_000, elapsedDays: 10, daysInMonth: 31, observedDays: 10 })
    expect(buildPacingBudgetRecommendations({ goal: null, pacing, campaigns: [strongCampaign], observedDays: 10, remainingDays: 21 }).state).toBe('missing_goal')
    expect(buildPacingBudgetRecommendations({ goal: { ...goal, targetCpaMicros: null }, pacing, campaigns: [strongCampaign], observedDays: 10, remainingDays: 21 }).state).toBe('missing_target')
    expect(buildPacingBudgetRecommendations({ goal, pacing, campaigns: [strongCampaign], observedDays: 6, remainingDays: 21 }).state).toBe('insufficient_history')
    expect(buildPacingBudgetRecommendations({ goal, pacing: null, campaigns: [strongCampaign], observedDays: 10, remainingDays: 21 }).state).toBe('missing_forecast')
    const unavailableForecast = { ...pacing, forecastMicros: null } as ReturnType<typeof computePacing>
    expect(buildPacingBudgetRecommendations({ goal, pacing: unavailableForecast, campaigns: [strongCampaign], observedDays: 10, remainingDays: 21 }).state).toBe('missing_forecast')
    const missingPacing = computePacing({ monthlyBudgetMicros: 310_000_000, actualSpendMicros: 0, elapsedDays: 10, daysInMonth: 31, observedDays: 0 })
    expect(buildPacingBudgetRecommendations({ goal, pacing: missingPacing, campaigns: [strongCampaign], observedDays: 10, remainingDays: 21 }).state).toBe('missing_forecast')
  })

  it('supports each KPI target and rejects non-comparable or insufficient campaign rows', () => {
    const pacing = { status: 'over' as const, actualSpendMicros: 1, expectedSpendMicros: 1, varianceMicros: 1, variancePercent: 1, forecastMicros: 400_000_000 }
    const variants: PacingGoal[] = [
      { ...goal, primaryKpi: 'roas', targetCpaMicros: null, targetRoas: 2 },
      { ...goal, primaryKpi: 'conversions', targetCpaMicros: null, targetConversions: 8 },
      { ...goal, primaryKpi: 'conversion_value', targetCpaMicros: null, targetConversionValueMicros: 620_000_000 },
    ]
    for (const variant of variants) {
      expect(buildPacingBudgetRecommendations({ goal: variant, pacing, campaigns: [strongCampaign], observedDays: 10, remainingDays: 20 }).state).toBe('ready')
    }
    for (const variant of [
      { ...variants[0], targetRoas: null },
      { ...variants[1], targetConversions: null },
      { ...variants[2], targetConversionValueMicros: null },
    ]) expect(buildPacingBudgetRecommendations({ goal: variant, pacing, campaigns: [strongCampaign], observedDays: 10, remainingDays: 20 }).state).toBe('missing_target')

    const excluded = [
      { ...strongCampaign, status: 'PAUSED' },
      { ...strongCampaign, budgetResourceName: '' },
      { ...strongCampaign, budgetMicros: '0' },
      { ...strongCampaign, costMicros: '0' },
      { ...strongCampaign, clicks: '29' },
    ]
    for (const row of excluded) {
      expect(buildPacingBudgetRecommendations({ goal, pacing, campaigns: [row], observedDays: 10, remainingDays: 20 }).state).toBe('no_candidate')
    }
  })

  it('proposes only a capped approved-path increase when under-pacing has a proven budget signal', () => {
    const pacing = computePacing({ monthlyBudgetMicros: 310_000_000, actualSpendMicros: 70_000_000, elapsedDays: 10, daysInMonth: 31, observedDays: 10 })
    const result = buildPacingBudgetRecommendations({ goal, pacing, campaigns: [strongCampaign], observedDays: 10, remainingDays: 21 })
    expect(result.state).toBe('ready')
    expect(result.recommendations[0]).toMatchObject({ kind: 'increase', campaign: { id: '1' } })
    if (result.recommendations[0]?.kind === 'increase') {
      expect(result.recommendations[0].changePercent).toBeGreaterThan(0)
      expect(result.recommendations[0].changePercent).toBeLessThanOrEqual(0.1)
    }
    expect(buildPacingBudgetRecommendations({
      goal,
      pacing,
      campaigns: [{ ...strongCampaign, searchBudgetLostImpressionShare: null }],
      observedDays: 10,
      remainingDays: 21,
    }).recommendations).toEqual([])
  })

  it('selects the least aligned campaign for a capped over-pacing reduction', () => {
    const pacing = computePacing({ monthlyBudgetMicros: 310_000_000, actualSpendMicros: 120_000_000, elapsedDays: 10, daysInMonth: 31, observedDays: 10 })
    const result = buildPacingBudgetRecommendations({ goal, pacing, campaigns: [strongCampaign, weakCampaign], observedDays: 10, remainingDays: 21 })
    expect(result.recommendations[0]).toMatchObject({ kind: 'decrease', campaign: { id: '2' } })
    if (result.recommendations[0]?.kind === 'decrease') expect(result.recommendations[0].changePercent).toBeGreaterThanOrEqual(-0.1)
  })

  it('keeps on-track reallocation consultative and budget-neutral', () => {
    const pacing = computePacing({ monthlyBudgetMicros: 310_000_000, actualSpendMicros: 100_000_000, elapsedDays: 10, daysInMonth: 31, observedDays: 10 })
    const result = buildPacingBudgetRecommendations({ goal, pacing, campaigns: [strongCampaign, weakCampaign], observedDays: 10, remainingDays: 21 })
    expect(result.recommendations[0]).toMatchObject({
      kind: 'reallocate', fromCampaign: { id: '2' }, toCampaign: { id: '1' }, transferMicros: 2_000_000,
    })
    expect(result.message).toContain('batch atomique')
  })

  it('refuses contradictory forecast signals and assigns evidence-based confidence', () => {
    const underContradiction = { status: 'under' as const, actualSpendMicros: 1, expectedSpendMicros: 2, varianceMicros: -1, variancePercent: -0.5, forecastMicros: 400_000_000 }
    expect(buildPacingBudgetRecommendations({ goal, pacing: underContradiction, campaigns: [strongCampaign], observedDays: 10, remainingDays: 0 }).state).toBe('no_candidate')
    const overContradiction = { ...underContradiction, status: 'over' as const, forecastMicros: 300_000_000 }
    expect(buildPacingBudgetRecommendations({ goal, pacing: overContradiction, campaigns: [strongCampaign], observedDays: 10, remainingDays: 20 }).state).toBe('no_candidate')

    const under = { ...underContradiction, forecastMicros: 200_000_000 }
    const high = buildPacingBudgetRecommendations({ goal, pacing: under, campaigns: [{ ...strongCampaign, clicks: '220', conversions: 12, costMicros: '300000000' }], observedDays: 10, remainingDays: 20 })
    expect(high.recommendations[0]).toMatchObject({ confidence: 'high' })
    const low = buildPacingBudgetRecommendations({ goal, pacing: under, campaigns: [{ ...strongCampaign, clicks: '40', conversions: 3, costMicros: '100000000' }], observedDays: 10, remainingDays: 20 })
    expect(low.recommendations[0]).toMatchObject({ confidence: 'low' })
    const noPair = buildPacingBudgetRecommendations({ goal, pacing: { ...under, status: 'on_track' }, campaigns: [strongCampaign], observedDays: 10, remainingDays: 20 })
    expect(noPair.state).toBe('no_candidate')
  })

  it('localizes every recommendation state and action rationale in English', () => {
    const under = computePacing({ monthlyBudgetMicros: 310_000_000, actualSpendMicros: 70_000_000, elapsedDays: 10, daysInMonth: 31, observedDays: 10 })
    const over = computePacing({ monthlyBudgetMicros: 310_000_000, actualSpendMicros: 120_000_000, elapsedDays: 10, daysInMonth: 31, observedDays: 10 })
    const onTrack = computePacing({ monthlyBudgetMicros: 310_000_000, actualSpendMicros: 100_000_000, elapsedDays: 10, daysInMonth: 31, observedDays: 10 })
    const common = { campaigns: [strongCampaign, weakCampaign], observedDays: 10, remainingDays: 21, locale: 'en' as const }

    expect(buildPacingBudgetRecommendations({ ...common, goal: null, pacing: under }).message).toContain('Define a client goal')
    expect(buildPacingBudgetRecommendations({ ...common, goal: { ...goal, targetCpaMicros: null }, pacing: under }).message).toContain('primary KPI')
    expect(buildPacingBudgetRecommendations({ ...common, goal, pacing: under, observedDays: 6 }).message).toContain('seven collected days')
    expect(buildPacingBudgetRecommendations({ ...common, goal, pacing: null }).message).toContain('forecast is unavailable')
    expect(buildPacingBudgetRecommendations({ ...common, goal, pacing: under, campaigns: [] }).message).toContain('minimum volume')

    const increase = buildPacingBudgetRecommendations({ ...common, goal, pacing: under, campaigns: [strongCampaign] })
    expect(increase.message).toContain('increase capped at 10%')
    expect(increase.recommendations[0]?.reasons).toEqual(expect.arrayContaining([expect.stringContaining('Search impressions lost')]))

    const decrease = buildPacingBudgetRecommendations({ ...common, goal, pacing: over })
    expect(decrease.message).toContain('decrease capped at 10%')
    expect(decrease.recommendations[0]?.reasons).toEqual(expect.arrayContaining([expect.stringContaining('Forecast exceeds')]))

    const reallocate = buildPacingBudgetRecommendations({ ...common, goal, pacing: onTrack })
    expect(reallocate.message).toContain('Advisory 5% reallocation')
    expect(reallocate.recommendations[0]?.reasons).toEqual(expect.arrayContaining([expect.stringContaining('currencies are not mixed')]))
  })
})
