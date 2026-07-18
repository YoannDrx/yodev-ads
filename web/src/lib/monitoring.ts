import type { CampaignPerformance } from '@/lib/google-ads'

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
] as const

export type AgentKind = (typeof agentTemplates)[number]['kind']

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
  campaignId: string
  campaignName: string
  value: number
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
