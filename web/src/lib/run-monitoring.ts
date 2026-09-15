import 'server-only'

import { and, eq, inArray } from 'drizzle-orm'
import { clients, monitoringAgents } from '@/db/schema'
import { withSystemTransaction } from '@/db/transactions'
import { getClientGoalAndPacing, getWorkspaceConnection } from '@/lib/data'
import { GoogleAdsGateway } from '@/lib/google-ads'
import { persistMonitoringObservation, readMonitoringProgress, type MonitoringClaim } from '@/lib/monitoring-observations'
import { storePerformanceSnapshot } from '@/lib/performance-history'
import { remainingWorkMs } from '@/lib/work-deadline'
import {
  analyzeAdsForMonitoring,
  analyzeCampaigns,
  analyzeKeywordsForMonitoring,
  analyzePacingForMonitoring,
  analyzeSearchTermsForMonitoring,
  analyzeTrackingForMonitoring,
} from '@/lib/monitoring'

export async function runWorkspaceMonitoring(workspaceId: string, scope: { clientId: string; agentIds: string[]; claim: MonitoringClaim }) {
  const progress = await readMonitoringProgress(workspaceId, scope.claim)
  const pendingAgentIds = scope.agentIds.filter((id) => !progress[id])
  const completedResult = () => {
    const results = scope.agentIds.map((id) => progress[id]).filter(Boolean)
    return { agents: results.length, clients: results.some((result) => !result.skipped) ? 1 : 0,
      detected: results.reduce((sum, result) => sum + result.detected, 0), resolved: results.reduce((sum, result) => sum + result.resolved, 0),
      notifications: { queued: results.reduce((sum, result) => sum + result.queued, 0) } }
  }
  if (pendingAgentIds.length === 0) return completedResult()
  const connection = await getWorkspaceConnection(workspaceId)
  if (!connection) throw new Error('Connexion Google Ads absente.')

  const { agents, workspaceClients } = await withSystemTransaction(async (db) => ({
    agents: await db.query.monitoringAgents.findMany({
      where: and(eq(monitoringAgents.workspaceId, workspaceId), eq(monitoringAgents.enabled, true),
        inArray(monitoringAgents.id, pendingAgentIds)),
    }),
    workspaceClients: await db.query.clients.findMany({
      where: and(eq(clients.workspaceId, workspaceId), eq(clients.active, true), eq(clients.isManager, false),
        eq(clients.id, scope.clientId)),
    }),
  }))
  const observedAt = new Date()
  const gateway = new GoogleAdsGateway(connection)
  const campaignCache = new Map<string, Awaited<ReturnType<typeof gateway.campaignPerformance>>>()
  const searchTermCache = new Map<string, Awaited<ReturnType<typeof gateway.searchTermPerformance>>>()
  const keywordCache = new Map<string, Awaited<ReturnType<typeof gateway.keywordPerformance>>>()
  const adCache = new Map<string, Awaited<ReturnType<typeof gateway.responsiveSearchAdPerformance>>>()
  const trackingCache = new Map<string, Awaited<ReturnType<typeof gateway.conversionTrackingStatus>>>()
  const pacingCache = new Map<string, Awaited<ReturnType<typeof getClientGoalAndPacing>>>()

  async function campaignsFor(client: (typeof workspaceClients)[number]) {
    let campaigns = campaignCache.get(client.id)
    if (!campaigns) {
      campaigns = await gateway.campaignPerformance(client.googleCustomerId)
      campaignCache.set(client.id, campaigns)
      await storePerformanceSnapshot({
        workspaceId,
        clientId: client.id,
        currencyCode: client.currencyCode,
        campaigns,
      })
    }
    return campaigns
  }

  for (const agent of agents) {
    remainingWorkMs(1_000)
    const targets = agent.clientId
      ? workspaceClients.filter((client) => client.id === agent.clientId)
      : workspaceClients
    if (targets.length === 0) continue
    for (const client of targets) {
      remainingWorkMs(1_000)
      let findings
      if (agent.kind === 'pacing_variance' || agent.kind === 'forecast_overrun') {
        let goalContext = pacingCache.get(client.id)
        if (!goalContext) {
          goalContext = await getClientGoalAndPacing(workspaceId, client.id, client.timezone)
          pacingCache.set(client.id, goalContext)
        }
        findings = analyzePacingForMonitoring(agent, {
          goal: goalContext.goal ? { monthlyBudgetMicros: Number(goalContext.goal.monthlyBudgetMicros) } : null,
          pacing: goalContext.pacing ?? null,
          observedDays: goalContext.observedDays ?? 0,
          year: goalContext.calendar?.year ?? new Date().getUTCFullYear(),
          month: goalContext.calendar?.month ?? new Date().getUTCMonth() + 1,
        })
      } else if (agent.kind === 'wasted_search_terms') {
        let terms = searchTermCache.get(client.id)
        if (!terms) {
          terms = await gateway.searchTermPerformance(client.googleCustomerId)
          searchTermCache.set(client.id, terms)
        }
        findings = analyzeSearchTermsForMonitoring(agent, terms)
      } else if (agent.kind === 'low_quality_keywords') {
        let keywords = keywordCache.get(client.id)
        if (!keywords) {
          keywords = await gateway.keywordPerformance(client.googleCustomerId)
          keywordCache.set(client.id, keywords)
        }
        findings = analyzeKeywordsForMonitoring(agent, keywords)
      } else if (agent.kind === 'weak_responsive_ads') {
        let ads = adCache.get(client.id)
        if (!ads) {
          ads = await gateway.responsiveSearchAdPerformance(client.googleCustomerId)
          adCache.set(client.id, ads)
        }
        findings = analyzeAdsForMonitoring(agent, ads)
      } else if (agent.kind === 'tracking_gap') {
        const campaigns = await campaignsFor(client)
        let tracking = trackingCache.get(client.id)
        if (!tracking) {
          tracking = await gateway.conversionTrackingStatus(client.googleCustomerId)
          trackingCache.set(client.id, tracking)
        }
        findings = analyzeTrackingForMonitoring(agent, campaigns, tracking)
      } else {
        const campaigns = await campaignsFor(client)
        findings = analyzeCampaigns(agent, campaigns)
      }
      progress[agent.id] = await persistMonitoringObservation({
        workspaceId, claim: scope.claim, agent, clientId: client.id, findings, observedAt,
      })
    }
  }

  return completedResult()
}
