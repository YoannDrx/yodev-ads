import type { CampaignPerformance } from '@/lib/google-ads'
import { analyticalSnapshotState, type AnalyticalSnapshot } from '@/lib/analytical-model'
import { googleCoverageState } from '@/lib/google-collection-coverage'

export type ClientAlertSummary = { clientId: string; openCount: number; criticalCount: number }

/** Historical or capped collections remain readable but cannot establish current health. */
export function dashboardScoreCampaigns(rows: AnalyticalSnapshot[], client: { timezone: string; currencyCode: string }, now = new Date()) {
  const row = rows.find((item) => item.family === 'campaigns')
  if (analyticalSnapshotState(row, client, now) !== 'available' || googleCoverageState(row?.coverage) !== 'received') return null
  return Array.isArray(row?.payload) ? row.payload as CampaignPerformance[] : null
}

/** Counts are aggregated over the entire selected client, independently of list pagination. */
export function dashboardHealth(input: {
  clientId: string | undefined
  campaigns: CampaignPerformance[] | null
  alerts: ClientAlertSummary | undefined
}) {
  const alerts = input.alerts
  const valid = !!input.clientId && alerts?.clientId === input.clientId &&
    Number.isSafeInteger(alerts.openCount) && alerts.openCount >= 0 &&
    Number.isSafeInteger(alerts.criticalCount) && alerts.criticalCount >= 0 && alerts.criticalCount <= alerts.openCount
  const openCount = valid ? alerts!.openCount : null
  if (!valid || !input.campaigns?.length) return { score: null, openCount }
  // Fail closed on malformed source metrics rather than turning NaN into a healthy score.
  if (input.campaigns.some((campaign) => !/^\d+$/.test(campaign.impressions) || !/^\d+$/.test(campaign.costMicros) ||
    !Number.isFinite(campaign.conversions) || campaign.conversions < 0)) return { score: null, openCount }
  const penalty = input.campaigns.reduce((sum, campaign) => {
    if (campaign.status === 'ENABLED' && BigInt(campaign.impressions) === BigInt(0)) return sum + 20
    if (BigInt(campaign.costMicros) > BigInt(100_000_000) && campaign.conversions === 0) return sum + 12
    return sum
  }, alerts!.criticalCount * 8)
  return { score: Math.max(0, Math.min(100, 100 - penalty)), openCount }
}
