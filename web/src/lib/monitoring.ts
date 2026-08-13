import type {
  CampaignPerformance,
  ConversionTrackingStatus,
  KeywordPerformance,
  ResponsiveSearchAdPerformance,
  SearchTermPerformance,
} from '@/lib/google-ads'

export const agentTemplates = [
  {
    kind: 'no_delivery',
    name: 'Sentinelle de diffusion',
    description: 'Détecte les campagnes actives qui ne génèrent aucune impression sur 30 jours.',
    threshold: 0,
    unit: 'impression',
  },
  {
    kind: 'spend_without_conversion',
    name: 'Chasseur de dépenses perdues',
    description: 'Signale une campagne sans conversion dès que son coût dépasse le seuil choisi.',
    threshold: 100,
    unit: '€ dépensés',
  },
  {
    kind: 'high_cpa',
    name: 'Garde CPA',
    description: 'Alerte lorsque le coût par conversion d’une campagne franchit votre plafond.',
    threshold: 50,
    unit: '€ / conversion',
  },
  {
    kind: 'budget_pressure',
    name: 'Vigie budget',
    description: 'Repère les campagnes dont la dépense sur 30 jours approche le budget quotidien théorique.',
    threshold: 85,
    unit: '% du budget',
  },
  {
    kind: 'wasted_search_terms',
    name: 'Radar des requêtes perdues',
    description: 'Repère les termes de recherche coûteux sans conversion et propose les exclusions à examiner.',
    threshold: 20,
    unit: '€ sans conversion',
  },
  {
    kind: 'low_quality_keywords',
    name: 'Coach Quality Score',
    description: 'Surveille les mots-clés actifs dont la pertinence, le CTR attendu ou la page limitent la performance.',
    threshold: 5,
    unit: 'score maximal / 10',
  },
  {
    kind: 'weak_responsive_ads',
    name: 'Studio d’annonces',
    description: 'Détecte les annonces responsives refusées, faibles ou insuffisamment diversifiées.',
    threshold: 8,
    unit: 'titres recommandés',
  },
  {
    kind: 'tracking_gap',
    name: 'Gardien du tracking',
    description: 'Alerte quand la dépense progresse sans conversion ou que le suivi Google Ads est inactif.',
    threshold: 50,
    unit: '€ sans conversion',
  },
  {
    kind: 'pacing_variance',
    name: 'Sentinelle de pacing',
    description: 'Alerte lorsque la dépense du mois s’écarte durablement du rythme attendu.',
    threshold: 10,
    unit: '% d’écart au rythme',
  },
  {
    kind: 'forecast_overrun',
    name: 'Garde forecast',
    description: 'Alerte lorsque la projection de fin de mois dépasse le budget client configuré.',
    threshold: 10,
    unit: '% de dépassement prévisionnel',
  },
] as const

export type AgentKind = (typeof agentTemplates)[number]['kind']

const englishAgentTemplates = {
  no_delivery: { name: 'Delivery sentinel', description: 'Detects active campaigns with no impressions over 30 days.', unit: 'impressions' },
  spend_without_conversion: { name: 'Wasted spend hunter', description: 'Flags campaigns with no conversion once spend exceeds the selected threshold.', unit: 'spent' },
  high_cpa: { name: 'CPA guard', description: 'Alerts when a campaign cost per conversion exceeds your limit.', unit: 'per conversion' },
  budget_pressure: { name: 'Budget monitor', description: 'Detects campaigns whose 30-day spend approaches their extrapolated daily budget.', unit: '% of budget' },
  wasted_search_terms: { name: 'Wasted query radar', description: 'Finds costly non-converting search terms and suggests exclusions to review.', unit: 'without conversion' },
  low_quality_keywords: { name: 'Quality Score coach', description: 'Monitors active keywords whose relevance, expected CTR or landing page constrain performance.', unit: 'maximum score / 10' },
  weak_responsive_ads: { name: 'Ad studio', description: 'Detects disapproved, weak or insufficiently diverse responsive ads.', unit: 'recommended headlines' },
  tracking_gap: { name: 'Tracking guardian', description: 'Alerts when spend grows without conversions or Google Ads tracking is inactive.', unit: 'without conversion' },
  pacing_variance: { name: 'Pacing sentinel', description: 'Alerts when monthly spend persistently diverges from the expected pace.', unit: '% pacing variance' },
  forecast_overrun: { name: 'Forecast guard', description: 'Alerts when the end-of-month projection exceeds the configured client budget.', unit: '% forecast overrun' },
} as const satisfies Record<AgentKind, { name: string; description: string; unit: string }>

export function agentTemplatesForLocale(locale: 'fr' | 'en') {
  if (locale === 'fr') return agentTemplates
  return agentTemplates.map((template) => ({ ...template, ...englishAgentTemplates[template.kind] }))
}

export type MonitoringAgentInput = {
  id: string
  kind: string
  threshold: string
}

export type MonitoringFinding = {
  fingerprint: string
  severity: 'warning' | 'critical'
  title: string
  description: string
  campaignId?: string
  campaignName?: string
  value: number
}

export function analyzePacingForMonitoring(agent: MonitoringAgentInput, context: {
  goal: { monthlyBudgetMicros: number } | null
  pacing: { status: 'under' | 'on_track' | 'over' | 'missing_data'; variancePercent: number | null; forecastMicros: number | null } | null
  observedDays: number
  year: number
  month: number
}) {
  if (!context.goal || !context.pacing || context.pacing.status === 'missing_data' || context.observedDays < 3) return []
  const threshold = Number(agent.threshold)
  const period = `${context.year}-${String(context.month).padStart(2, '0')}`
  if (agent.kind === 'pacing_variance') {
    const variancePercent = Math.abs((context.pacing.variancePercent ?? 0) * 100)
    if (context.pacing.status === 'on_track' || variancePercent < threshold) return []
    const direction = context.pacing.status === 'under' ? 'sous le rythme' : 'au-dessus du rythme'
    return [{
      fingerprint: `${agent.id}:pacing:${period}`,
      severity: variancePercent >= threshold * 2 ? 'critical' as const : 'warning' as const,
      title: context.pacing.status === 'under' ? 'Sous-pacing mensuel' : 'Sur-pacing mensuel',
      description: `La dépense est ${direction} attendu de ${variancePercent.toFixed(1)} % après ${context.observedDays} jours collectés.`,
      value: variancePercent,
    }]
  }
  if (agent.kind === 'forecast_overrun' && context.pacing.forecastMicros !== null && context.goal.monthlyBudgetMicros > 0) {
    const overrun = ((context.pacing.forecastMicros - context.goal.monthlyBudgetMicros) / context.goal.monthlyBudgetMicros) * 100
    if (overrun < threshold) return []
    return [{
      fingerprint: `${agent.id}:forecast:${period}`,
      severity: overrun >= threshold * 2 ? 'critical' as const : 'warning' as const,
      title: 'Forecast supérieur au budget mensuel',
      description: `La projection de fin de mois dépasse le budget configuré de ${overrun.toFixed(1)} %.`,
      value: overrun,
    }]
  }
  return []
}

export function analyzeSearchTermsForMonitoring(agent: MonitoringAgentInput, terms: SearchTermPerformance[]) {
  const threshold = Number(agent.threshold)
  return terms.flatMap<MonitoringFinding>((term) => {
    const cost = Number(term.costMicros) / 1_000_000
    if (term.conversions > 0 || cost < threshold || term.targetingStatus === 'ADDED_EXCLUDED') return []
    return [
      {
        fingerprint: `${agent.id}:search-term:${term.campaignId}:${term.adGroupId}:${term.searchTerm}`,
        severity: cost >= threshold * 3 ? 'critical' : 'warning',
        title: 'Requête coûteuse sans conversion',
        description: `« ${term.searchTerm} » a dépensé ${cost.toFixed(2)} sans conversion. Vérifiez son intention avant de l’exclure.`,
        campaignId: term.campaignId,
        campaignName: term.campaignName,
        value: cost,
      },
    ]
  })
}

export function analyzeKeywordsForMonitoring(agent: MonitoringAgentInput, keywords: KeywordPerformance[]) {
  const threshold = Number(agent.threshold)
  return keywords.flatMap<MonitoringFinding>((keyword) => {
    if (
      keyword.status !== 'ENABLED' ||
      keyword.qualityScore === null ||
      keyword.qualityScore > threshold ||
      Number(keyword.impressions) === 0
    ) {
      return []
    }
    return [
      {
        fingerprint: `${agent.id}:keyword:${keyword.criterionId}`,
        severity: keyword.qualityScore <= 3 ? 'critical' : 'warning',
        title: `Quality Score faible (${keyword.qualityScore}/10)`,
        description: `« ${keyword.text} » demande un meilleur alignement entre requête, annonce et page de destination.`,
        campaignId: keyword.campaignId,
        campaignName: keyword.campaignName,
        value: keyword.qualityScore,
      },
    ]
  })
}

export function analyzeAdsForMonitoring(agent: MonitoringAgentInput, ads: ResponsiveSearchAdPerformance[]) {
  const minimumHeadlines = Number(agent.threshold)
  return ads.flatMap<MonitoringFinding>((ad) => {
    if (ad.status !== 'ENABLED') return []
    const disapproved = ad.approvalStatus === 'DISAPPROVED'
    const weak = ['POOR', 'AVERAGE'].includes(ad.adStrength)
    const incomplete = ad.headlines.length < minimumHeadlines || ad.descriptions.length < 3
    if (!disapproved && !weak && !incomplete) return []
    return [
      {
        fingerprint: `${agent.id}:ad:${ad.id}`,
        severity: disapproved || ad.adStrength === 'POOR' ? 'critical' : 'warning',
        title: disapproved ? 'Annonce refusée' : 'Annonce responsive à renforcer',
        description: `« ${ad.adGroupName} » : force ${ad.adStrength.toLowerCase()}, ${ad.headlines.length} titres et ${ad.descriptions.length} descriptions.`,
        campaignId: ad.campaignId,
        campaignName: ad.campaignName,
        value: ad.headlines.length,
      },
    ]
  })
}

export function analyzeTrackingForMonitoring(
  agent: MonitoringAgentInput,
  campaigns: CampaignPerformance[],
  tracking: ConversionTrackingStatus,
) {
  const threshold = Number(agent.threshold)
  const cost = campaigns.reduce((sum, campaign) => sum + Number(campaign.costMicros) / 1_000_000, 0)
  const conversions = campaigns.reduce((sum, campaign) => sum + campaign.conversions, 0)
  const trackingActive = tracking.status.includes('MANAGED_BY_')
  if (trackingActive && (cost < threshold || conversions > 0)) return []
  return [
    {
      fingerprint: `${agent.id}:tracking`,
      severity: 'critical' as const,
      title: trackingActive ? 'Dépense sans conversion mesurée' : 'Suivi des conversions inactif',
      description: trackingActive
        ? `${cost.toFixed(2)} dépensés sur 30 jours sans conversion. Testez le parcours et la balise.`
        : `Google Ads remonte l’état « ${tracking.status} ». La stratégie d’enchères travaille sans signal fiable.`,
      value: cost,
    },
  ]
}

export function analyzeCampaigns(agent: MonitoringAgentInput, campaigns: CampaignPerformance[]) {
  const threshold = Number(agent.threshold)
  return campaigns.flatMap<MonitoringFinding>((campaign) => {
    const cost = Number(campaign.costMicros) / 1_000_000
    const impressions = Number(campaign.impressions)
    const budget = Number(campaign.budgetMicros) / 1_000_000
    const cpa = campaign.conversions > 0 ? cost / campaign.conversions : 0
    const budgetPressure = budget > 0 ? (cost / (budget * 30)) * 100 : 0
    let title: string | undefined
    let description = ''
    let value = 0

    if (agent.kind === 'no_delivery' && campaign.status === 'ENABLED' && impressions <= threshold) {
      title = 'Campagne active sans diffusion'
      description = `« ${campaign.name} » est active mais n’a enregistré aucune impression sur 30 jours.`
      value = impressions
    } else if (
      agent.kind === 'spend_without_conversion' &&
      campaign.status === 'ENABLED' &&
      campaign.conversions === 0 &&
      cost >= threshold
    ) {
      title = 'Dépense sans conversion'
      description = `« ${campaign.name} » a dépensé ${cost.toFixed(2)} sans générer de conversion.`
      value = cost
    } else if (
      agent.kind === 'high_cpa' &&
      campaign.status === 'ENABLED' &&
      campaign.conversions > 0 &&
      cpa >= threshold
    ) {
      title = 'CPA au-dessus du plafond'
      description = `Le CPA de « ${campaign.name} » atteint ${cpa.toFixed(2)}, au-dessus du seuil de ${threshold.toFixed(2)}.`
      value = cpa
    } else if (agent.kind === 'budget_pressure' && campaign.status === 'ENABLED' && budgetPressure >= threshold) {
      title = 'Pression budgétaire élevée'
      description = `« ${campaign.name} » a consommé ${budgetPressure.toFixed(0)} % de son enveloppe quotidienne extrapolée sur 30 jours.`
      value = budgetPressure
    }

    if (!title) return []
    return [
      {
        fingerprint: `${agent.id}:${campaign.id}`,
        severity: agent.kind === 'no_delivery' || value >= threshold * 1.5 ? 'critical' : 'warning',
        title,
        description,
        campaignId: campaign.id,
        campaignName: campaign.name,
        value,
      },
    ]
  })
}
