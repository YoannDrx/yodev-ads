import type { CampaignPerformance } from '@/lib/google-ads'

type Incident = { clientId: string; status: string; severity: string }

/** Acknowledged/snoozed incidents remain visible in the alert centre but do not require triage. */
export function dashboardHealth(input: {
  clientId: string | undefined
  campaigns: CampaignPerformance[] | null
  incidents: Incident[]
}) {
  const openIncidents = input.incidents.filter((incident) => incident.clientId === input.clientId &&
    (incident.status === 'open' || incident.status === 'reopened'))
  if (!input.clientId || !input.campaigns?.length) return { score: null, openIncidents }
  const penalty = input.campaigns.reduce((sum, campaign) => {
    if (campaign.status === 'ENABLED' && Number(campaign.impressions) === 0) return sum + 20
    if (Number(campaign.costMicros) > 100_000_000 && campaign.conversions === 0) return sum + 12
    return sum
  }, openIncidents.filter((incident) => incident.severity === 'critical').length * 8)
  return { score: Math.max(0, Math.min(100, 100 - penalty)), openIncidents }
}
