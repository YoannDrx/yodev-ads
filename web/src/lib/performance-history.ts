import 'server-only'

import { and, asc, eq, gte } from 'drizzle-orm'
import { getDb } from '@/db'
import { performanceSnapshots } from '@/db/schema'
import type { CampaignPerformance } from '@/lib/google-ads'

export function aggregateCampaignPerformance(campaigns: CampaignPerformance[]) {
  return campaigns.reduce(
    (total, campaign) => ({
      costMicros: total.costMicros + Number(campaign.costMicros),
      impressions: total.impressions + Number(campaign.impressions),
      clicks: total.clicks + Number(campaign.clicks),
      conversions: total.conversions + campaign.conversions,
      activeCampaigns: total.activeCampaigns + (campaign.status === 'ENABLED' ? 1 : 0),
    }),
    { costMicros: 0, impressions: 0, clicks: 0, conversions: 0, activeCampaigns: 0 },
  )
}

export async function storePerformanceSnapshot(input: {
  workspaceId: string
  clientId: string
  currencyCode: string
  campaigns: CampaignPerformance[]
  date?: Date
}) {
  const totals = aggregateCampaignPerformance(input.campaigns)
  const snapshotDate = (input.date ?? new Date()).toISOString().slice(0, 10)
  await getDb()
    .insert(performanceSnapshots)
    .values({
      workspaceId: input.workspaceId,
      clientId: input.clientId,
      snapshotDate,
      currencyCode: input.currencyCode,
      costMicros: String(Math.round(totals.costMicros)),
      impressions: String(Math.round(totals.impressions)),
      clicks: String(Math.round(totals.clicks)),
      conversions: String(totals.conversions),
      activeCampaigns: totals.activeCampaigns,
    })
    .onConflictDoUpdate({
      target: [performanceSnapshots.clientId, performanceSnapshots.snapshotDate],
      set: {
        costMicros: String(Math.round(totals.costMicros)),
        impressions: String(Math.round(totals.impressions)),
        clicks: String(Math.round(totals.clicks)),
        conversions: String(totals.conversions),
        activeCampaigns: totals.activeCampaigns,
        updatedAt: new Date(),
      },
    })
}

export async function listPerformanceHistory(workspaceId: string, clientId: string, days = 90) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  return getDb().query.performanceSnapshots.findMany({
    where: and(
      eq(performanceSnapshots.workspaceId, workspaceId),
      eq(performanceSnapshots.clientId, clientId),
      gte(performanceSnapshots.snapshotDate, since),
    ),
    orderBy: [asc(performanceSnapshots.snapshotDate)],
  })
}
