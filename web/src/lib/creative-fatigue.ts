export type CreativePeriodMetrics = { impressions: number; clicks: number; conversions: number; conversionValue: number }

export function creativeFatigueSignal(input: {
  current: CreativePeriodMetrics
  previous: CreativePeriodMetrics
  performanceLabel: string
}) {
  const currentCtr = input.current.impressions > 0 ? input.current.clicks / input.current.impressions : null
  const previousCtr = input.previous.impressions > 0 ? input.previous.clicks / input.previous.impressions : null
  if (input.current.impressions < 1_000 || input.previous.impressions < 1_000 || input.previous.clicks < 20 || previousCtr === null || previousCtr === 0) {
    return { status: 'insufficient_data' as const, confidence: 'low' as const, ctrChange: null, currentCtr, previousCtr }
  }
  const ctrChange = (currentCtr! - previousCtr) / previousCtr
  const suspected = ctrChange <= -0.25
  return {
    status: suspected ? 'review' as const : 'stable' as const,
    confidence: suspected && input.performanceLabel === 'LOW' && input.current.impressions >= 5_000 && input.previous.impressions >= 5_000 ? 'high' as const : 'medium' as const,
    ctrChange,
    currentCtr,
    previousCtr,
  }
}
