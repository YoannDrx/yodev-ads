export type PacingStatus = 'under' | 'on_track' | 'over' | 'missing_data'

export function pacingCalendar(date: Date, timezone: string) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date).map((part) => [part.type, part.value]))
  const year = Number(parts.year)
  const month = Number(parts.month)
  const elapsedDays = Number(parts.day)
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return { year, month, elapsedDays, daysInMonth, from: `${parts.year}-${parts.month}-01`, through: `${parts.year}-${parts.month}-${parts.day}` }
}

export function computePacing(input: {
  monthlyBudgetMicros: number
  actualSpendMicros: number
  elapsedDays: number
  daysInMonth: number
  observedDays: number
}) {
  if (input.monthlyBudgetMicros <= 0 || input.elapsedDays <= 0 || input.observedDays <= 0) {
    return { status: 'missing_data' as const, actualSpendMicros: input.actualSpendMicros, expectedSpendMicros: 0, varianceMicros: 0, variancePercent: null, forecastMicros: null }
  }
  const expectedSpendMicros = input.monthlyBudgetMicros * input.elapsedDays / input.daysInMonth
  const varianceMicros = input.actualSpendMicros - expectedSpendMicros
  const variancePercent = expectedSpendMicros ? varianceMicros / expectedSpendMicros : 0
  const forecastMicros = input.actualSpendMicros / input.observedDays * input.daysInMonth
  const status: PacingStatus = variancePercent < -0.1 ? 'under' : variancePercent > 0.1 ? 'over' : 'on_track'
  return { status, actualSpendMicros: input.actualSpendMicros, expectedSpendMicros, varianceMicros, variancePercent, forecastMicros }
}

export type PacingGoal = {
  primaryKpi: 'cpa' | 'roas' | 'conversions' | 'conversion_value'
  monthlyBudgetMicros: number
  targetCpaMicros: number | null
  targetRoas: number | null
  targetConversions: number | null
  targetConversionValueMicros: number | null
}

export type PacingCampaign = {
  id: string
  name: string
  status: string
  budgetResourceName: string
  budgetMicros: string
  clicks: string
  costMicros: string
  conversions: number
  conversionValueMicros: string
  searchBudgetLostImpressionShare: number | null
  searchRankLostImpressionShare: number | null
}

type ScoredCampaign = PacingCampaign & {
  objectiveScore: number
  clicksNumber: number
  conversionsNumber: number
}

export type PacingBudgetRecommendation =
  | {
      kind: 'increase' | 'decrease'
      campaign: PacingCampaign
      currentBudgetMicros: number
      proposedBudgetMicros: number
      changePercent: number
      confidence: 'low' | 'medium' | 'high'
      reasons: string[]
    }
  | {
      kind: 'reallocate'
      fromCampaign: PacingCampaign
      toCampaign: PacingCampaign
      transferMicros: number
      confidence: 'low' | 'medium' | 'high'
      reasons: string[]
    }

export type PacingRecommendationResult = {
  state: 'ready' | 'missing_goal' | 'missing_target' | 'insufficient_history' | 'missing_forecast' | 'no_candidate'
  message: string
  recommendations: PacingBudgetRecommendation[]
}

function objectiveScore(goal: PacingGoal, campaign: PacingCampaign) {
  const cost = Number(campaign.costMicros)
  const conversions = campaign.conversions
  const conversionValue = Number(campaign.conversionValueMicros)
  if (cost <= 0) return null
  if (goal.primaryKpi === 'cpa') {
    if (!goal.targetCpaMicros) return null
    const cpa = conversions > 0 ? cost / conversions : Number.POSITIVE_INFINITY
    return goal.targetCpaMicros / cpa
  }
  if (goal.primaryKpi === 'roas') {
    if (!goal.targetRoas) return null
    return (conversionValue / cost) / goal.targetRoas
  }
  if (goal.primaryKpi === 'conversions') {
    if (!goal.targetConversions || goal.monthlyBudgetMicros <= 0) return null
    const impliedTargetCpa = goal.monthlyBudgetMicros / goal.targetConversions
    const cpa = conversions > 0 ? cost / conversions : Number.POSITIVE_INFINITY
    return impliedTargetCpa / cpa
  }
  if (!goal.targetConversionValueMicros || goal.monthlyBudgetMicros <= 0) return null
  const impliedTargetRoas = goal.targetConversionValueMicros / goal.monthlyBudgetMicros
  return impliedTargetRoas > 0 ? (conversionValue / cost) / impliedTargetRoas : null
}

function confidenceFor(campaign: ScoredCampaign) {
  if (campaign.clicksNumber >= 200 && campaign.conversionsNumber >= 10) return 'high' as const
  if (campaign.clicksNumber >= 75 && campaign.conversionsNumber >= 5) return 'medium' as const
  return 'low' as const
}

function scoreCampaigns(goal: PacingGoal, campaigns: PacingCampaign[]) {
  return campaigns.flatMap<ScoredCampaign>((campaign) => {
    const clicksNumber = Number(campaign.clicks)
    const score = objectiveScore(goal, campaign)
    if (
      campaign.status !== 'ENABLED' ||
      !campaign.budgetResourceName ||
      Number(campaign.budgetMicros) <= 0 ||
      Number(campaign.costMicros) <= 0 ||
      clicksNumber < 30 ||
      score === null ||
      !Number.isFinite(score)
    ) return []
    return [{ ...campaign, objectiveScore: score, clicksNumber, conversionsNumber: campaign.conversions }]
  })
}

function hasConfiguredTarget(goal: PacingGoal) {
  if (goal.primaryKpi === 'cpa') return Boolean(goal.targetCpaMicros)
  if (goal.primaryKpi === 'roas') return Boolean(goal.targetRoas)
  if (goal.primaryKpi === 'conversions') return Boolean(goal.targetConversions)
  return Boolean(goal.targetConversionValueMicros)
}

export function buildPacingBudgetRecommendations(input: {
  goal: PacingGoal | null
  pacing: ReturnType<typeof computePacing> | null
  campaigns: PacingCampaign[]
  observedDays: number
  remainingDays: number
  locale?: 'fr' | 'en'
}) : PacingRecommendationResult {
  const english = input.locale === 'en'
  if (!input.goal) return { state: 'missing_goal', message: english ? 'Define a client goal before generating any recommendation.' : 'Définissez un objectif client avant toute recommandation.', recommendations: [] }
  if (!hasConfiguredTarget(input.goal)) {
    return { state: 'missing_target', message: english ? 'Set the target for the primary KPI before generating any recommendation.' : 'Renseignez la cible correspondant au KPI principal avant toute recommandation.', recommendations: [] }
  }
  if (input.observedDays < 7) {
    return { state: 'insufficient_history', message: english ? 'At least seven collected days are required to avoid a premature recommendation.' : 'Au moins sept jours collectés sont requis pour éviter une recommandation prématurée.', recommendations: [] }
  }
  if (!input.pacing || input.pacing.status === 'missing_data' || input.pacing.forecastMicros === null) {
    return { state: 'missing_forecast', message: english ? 'The monthly forecast is unavailable.' : 'Le forecast mensuel est indisponible.', recommendations: [] }
  }
  const scored = scoreCampaigns(input.goal, input.campaigns)
  if (scored.length === 0) {
    return { state: 'no_candidate', message: english ? 'No campaign has reached the minimum volume of 30 clicks with a comparable goal.' : 'Aucune campagne ne dépasse encore le volume minimal de 30 clics avec un objectif comparable.', recommendations: [] }
  }

  const remainingDays = Math.max(1, input.remainingDays)
  const monthlyGap = input.goal.monthlyBudgetMicros - input.pacing.forecastMicros
  const requiredDailyCorrection = Math.abs(monthlyGap) / remainingDays

  if (input.pacing.status === 'under') {
    if (monthlyGap <= 0) {
      return { state: 'no_candidate', message: english ? 'Current pacing and forecast give conflicting signals; no increase is proposed.' : 'Le pacing courant et le forecast donnent des signaux contradictoires ; aucune hausse n’est proposée.', recommendations: [] }
    }
    const candidate = scored
      .filter((campaign) => campaign.objectiveScore >= 1 && campaign.conversionsNumber >= 3 && (campaign.searchBudgetLostImpressionShare ?? 0) >= 0.1)
      .sort((left, right) => right.objectiveScore - left.objectiveScore)[0]
    if (!candidate) {
      return { state: 'no_candidate', message: english ? 'Under-pacing detected, but no performing campaign has sufficient Search budget loss.' : 'Sous-pacing détecté, mais aucune campagne performante ne présente une perte budget Search suffisante.', recommendations: [] }
    }
    const currentBudgetMicros = Number(candidate.budgetMicros)
    const increase = Math.min(currentBudgetMicros * 0.1, requiredDailyCorrection)
    if (increase <= 0) return { state: 'no_candidate', message: english ? 'No incremental budget adjustment is justified.' : 'Aucune correction budgétaire incrémentale n’est justifiée.', recommendations: [] }
    return {
      state: 'ready',
      message: english ? 'An increase capped at 10% is proposed; it must go through the approval workflow.' : 'Une hausse plafonnée à 10 % est proposée ; elle devra passer par le workflow d’approbation.',
      recommendations: [{
        kind: 'increase',
        campaign: candidate,
        currentBudgetMicros,
        proposedBudgetMicros: Math.round(currentBudgetMicros + increase),
        changePercent: increase / currentBudgetMicros,
        confidence: confidenceFor(candidate),
        reasons: [
          english ? `Goal score ${candidate.objectiveScore.toFixed(2)}× the target` : `Score objectif ${candidate.objectiveScore.toFixed(2)}× la cible`,
          english ? `${((candidate.searchBudgetLostImpressionShare ?? 0) * 100).toFixed(1)}% of Search impressions lost to budget` : `${((candidate.searchBudgetLostImpressionShare ?? 0) * 100).toFixed(1)} % d’impressions Search perdues pour budget`,
          english ? `${candidate.clicksNumber} clicks and ${candidate.conversionsNumber.toFixed(1)} conversions over 30 days` : `${candidate.clicksNumber} clics et ${candidate.conversionsNumber.toFixed(1)} conversions sur 30 jours`,
        ],
      }],
    }
  }

  if (input.pacing.status === 'over') {
    if (monthlyGap >= 0) {
      return { state: 'no_candidate', message: english ? 'Current pacing and forecast give conflicting signals; no decrease is proposed.' : 'Le pacing courant et le forecast donnent des signaux contradictoires ; aucune baisse n’est proposée.', recommendations: [] }
    }
    const candidate = scored.sort((left, right) => left.objectiveScore - right.objectiveScore)[0]
    const currentBudgetMicros = Number(candidate.budgetMicros)
    const decrease = Math.min(currentBudgetMicros * 0.1, requiredDailyCorrection)
    if (decrease <= 0 || currentBudgetMicros - decrease <= 0) {
      return { state: 'no_candidate', message: english ? 'No incremental budget adjustment is justified.' : 'Aucune correction budgétaire incrémentale n’est justifiée.', recommendations: [] }
    }
    return {
      state: 'ready',
      message: english ? 'A decrease capped at 10% is proposed for the campaign least aligned with the goal.' : 'Une baisse plafonnée à 10 % est proposée sur la campagne la moins alignée avec l’objectif.',
      recommendations: [{
        kind: 'decrease',
        campaign: candidate,
        currentBudgetMicros,
        proposedBudgetMicros: Math.round(currentBudgetMicros - decrease),
        changePercent: -decrease / currentBudgetMicros,
        confidence: confidenceFor(candidate),
        reasons: [
          english ? `Goal score ${candidate.objectiveScore.toFixed(2)}× the target` : `Score objectif ${candidate.objectiveScore.toFixed(2)}× la cible`,
          english ? `${candidate.clicksNumber} clicks and ${candidate.conversionsNumber.toFixed(1)} conversions over 30 days` : `${candidate.clicksNumber} clics et ${candidate.conversionsNumber.toFixed(1)} conversions sur 30 jours`,
          english ? `Forecast exceeds the monthly budget by ${Math.abs(monthlyGap / 1_000_000).toFixed(2)}` : `Forecast supérieur au budget mensuel de ${Math.abs(monthlyGap / 1_000_000).toFixed(2)}`,
        ],
      }],
    }
  }

  const receiver = scored
    .filter((campaign) => campaign.objectiveScore >= 1 && campaign.conversionsNumber >= 3 && (campaign.searchBudgetLostImpressionShare ?? 0) >= 0.1)
    .sort((left, right) => right.objectiveScore - left.objectiveScore)[0]
  const donor = scored
    .filter((campaign) => campaign.objectiveScore < 1 && campaign.budgetResourceName !== receiver?.budgetResourceName)
    .sort((left, right) => left.objectiveScore - right.objectiveScore)[0]
  if (!receiver || !donor) {
    return { state: 'no_candidate', message: english ? 'Pacing is on track and no winner/loser pair is sufficiently supported for reallocation.' : 'Pacing correct et aucune paire gagnant/perdant suffisamment étayée pour une réallocation.', recommendations: [] }
  }
  const transferMicros = Math.round(Math.min(Number(receiver.budgetMicros), Number(donor.budgetMicros)) * 0.05)
  return {
    state: 'ready',
    message: english ? 'Advisory 5% reallocation: execution will wait for the Agency atomic batch to avoid partial application.' : 'Réallocation consultative de 5 % : son exécution attendra le batch atomique Agency afin d’éviter une application partielle.',
    recommendations: [{
      kind: 'reallocate',
      fromCampaign: donor,
      toCampaign: receiver,
      transferMicros,
      confidence: confidenceFor(receiver),
      reasons: [
        english ? `${receiver.name} reaches ${receiver.objectiveScore.toFixed(2)}× the target with ${((receiver.searchBudgetLostImpressionShare ?? 0) * 100).toFixed(1)}% budget loss` : `${receiver.name} atteint ${receiver.objectiveScore.toFixed(2)}× la cible avec ${((receiver.searchBudgetLostImpressionShare ?? 0) * 100).toFixed(1)} % de perte budget`,
        english ? `${donor.name} reaches ${donor.objectiveScore.toFixed(2)}× the target` : `${donor.name} atteint ${donor.objectiveScore.toFixed(2)}× la cible`,
        english ? 'Total daily amount unchanged and currencies are not mixed' : 'Montant total journalier inchangé et devises non mélangées',
      ],
    }],
  }
}
