export const PLATFORM_COMPONENTS = ['application', 'database', 'google_ads', 'stripe', 'email', 'scheduler'] as const
export const PLATFORM_IMPACTS = ['maintenance', 'degraded', 'partial_outage', 'major_outage'] as const
export const PLATFORM_INCIDENT_STATUSES = ['investigating', 'identified', 'monitoring', 'resolved'] as const

export type PlatformComponent = (typeof PLATFORM_COMPONENTS)[number]
export type PlatformImpact = (typeof PLATFORM_IMPACTS)[number]

const impactRank: Record<PlatformImpact | 'operational', number> = {
  operational: 0,
  maintenance: 1,
  degraded: 2,
  partial_outage: 3,
  major_outage: 4,
}

export function platformStatusSummary(incidents: Array<{
  component: string
  impact: string
  status: string
}>) {
  const active = incidents.filter((incident) => incident.status !== 'resolved')
  const statusByComponent = Object.fromEntries(PLATFORM_COMPONENTS.map((component) => [component, 'operational'])) as Record<PlatformComponent, PlatformImpact | 'operational'>
  for (const incident of active) {
    if (!PLATFORM_COMPONENTS.includes(incident.component as PlatformComponent)) continue
    if (!PLATFORM_IMPACTS.includes(incident.impact as PlatformImpact)) continue
    const component = incident.component as PlatformComponent
    const impact = incident.impact as PlatformImpact
    if (impactRank[impact] > impactRank[statusByComponent[component]]) statusByComponent[component] = impact
  }
  const overall = Object.values(statusByComponent).reduce<PlatformImpact | 'operational'>((worst, status) => (
    impactRank[status] > impactRank[worst] ? status : worst
  ), 'operational')
  return { overall, components: statusByComponent, activeIncidentCount: active.length }
}
