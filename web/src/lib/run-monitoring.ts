import 'server-only'

import { and, eq, inArray, sql } from 'drizzle-orm'
import { alertIncidents, clients, monitoringAgents } from '@/db/schema'
import { withSystemTransaction } from '@/db/transactions'
import { getClientGoalAndPacing, getWorkspaceConnection } from '@/lib/data'
import { GoogleAdsGateway } from '@/lib/google-ads'
import { dispatchIncidentNotifications } from '@/lib/notifications'
import { alertNotificationEvent, alertNotificationEventKey } from '@/lib/alert-notification-events'
import { storePerformanceSnapshot } from '@/lib/performance-history'
import {
  analyzeAdsForMonitoring,
  analyzeCampaigns,
  analyzeKeywordsForMonitoring,
  analyzePacingForMonitoring,
  analyzeSearchTermsForMonitoring,
  analyzeTrackingForMonitoring,
} from '@/lib/monitoring'

export async function runWorkspaceMonitoring(workspaceId: string, onlyAgentId?: string) {
  const connection = await getWorkspaceConnection(workspaceId)
  if (!connection) throw new Error('Connexion Google Ads absente.')

  const { agents, workspaceClients } = await withSystemTransaction(async (db) => ({
    agents: await db.query.monitoringAgents.findMany({
      where: onlyAgentId
        ? and(
            eq(monitoringAgents.workspaceId, workspaceId),
            eq(monitoringAgents.id, onlyAgentId),
            eq(monitoringAgents.enabled, true),
          )
        : and(eq(monitoringAgents.workspaceId, workspaceId), eq(monitoringAgents.enabled, true)),
    }),
    workspaceClients: await db.query.clients.findMany({
      where: and(eq(clients.workspaceId, workspaceId), eq(clients.active, true), eq(clients.isManager, false)),
    }),
  }))
  const gateway = new GoogleAdsGateway(connection)
  const campaignCache = new Map<string, Awaited<ReturnType<typeof gateway.campaignPerformance>>>()
  const searchTermCache = new Map<string, Awaited<ReturnType<typeof gateway.searchTermPerformance>>>()
  const keywordCache = new Map<string, Awaited<ReturnType<typeof gateway.keywordPerformance>>>()
  const adCache = new Map<string, Awaited<ReturnType<typeof gateway.responsiveSearchAdPerformance>>>()
  const trackingCache = new Map<string, Awaited<ReturnType<typeof gateway.conversionTrackingStatus>>>()
  const pacingCache = new Map<string, Awaited<ReturnType<typeof getClientGoalAndPacing>>>()
  const processedClients = new Set<string>()

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
  let detected = 0
  let resolved = 0
  let delivered = 0
  let notificationFailures = 0

  for (const agent of agents) {
    const targets = agent.clientId
      ? workspaceClients.filter((client) => client.id === agent.clientId)
      : workspaceClients
    const activeFingerprints = new Set<string>()
    for (const client of targets) {
      processedClients.add(client.id)
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
      for (const finding of findings) {
        const notificationNow = new Date()
        const fingerprint = `${finding.fingerprint}:${client.id}`
        activeFingerprints.add(fingerprint)
        const { existingIncident, incident } = await withSystemTransaction(async (db) => {
          const existingIncident = await db.query.alertIncidents.findFirst({
            where: and(eq(alertIncidents.workspaceId, workspaceId), eq(alertIncidents.fingerprint, fingerprint)),
          })
          const reopened = existingIncident?.status === 'resolved'
          const existingStatus = existingIncident?.status
          const snoozeExpired = existingIncident?.status === 'snoozed' && Boolean(existingIncident.snoozedUntil && existingIncident.snoozedUntil <= new Date())
          const nextStatus = reopened
            ? 'reopened'
            : existingStatus === 'acknowledged' || (existingStatus === 'snoozed' && !snoozeExpired)
              ? existingStatus
              : 'open'
          const [incident] = await db
            .insert(alertIncidents)
            .values({
              workspaceId,
              agentId: agent.id,
              clientId: client.id,
              ...finding,
              fingerprint,
              value: String(finding.value),
            })
            .onConflictDoUpdate({
              target: [alertIncidents.workspaceId, alertIncidents.fingerprint],
              set: {
                title: finding.title,
                description: finding.description,
                severity: finding.severity,
                value: String(finding.value),
                status: nextStatus,
                resolvedAt: null,
                detectedAt: new Date(),
                occurrenceCount: sql`${alertIncidents.occurrenceCount} + 1`,
                updatedAt: new Date(),
              },
            })
            .returning({ id: alertIncidents.id })
          return { existingIncident, incident }
        })
        const notificationEvent = alertNotificationEvent({
          existing: existingIncident,
          nextSeverity: finding.severity,
          reminderIntervalHours: agent.reminderIntervalHours,
          now: notificationNow,
        })
        if (notificationEvent) {
          const notificationResult = await dispatchIncidentNotifications({
            workspaceId,
            incidentId: incident.id,
            eventKey: alertNotificationEventKey({
              fingerprint,
              incidentId: incident.id,
              event: notificationEvent,
              reminderIntervalHours: agent.reminderIntervalHours,
              now: notificationNow,
            }),
            severity: finding.severity,
            title: finding.title,
            description: finding.description,
            clientName: client.name,
          })
          delivered += notificationResult.delivered
          notificationFailures += notificationResult.failed
          await withSystemTransaction((db) => db
            .update(alertIncidents)
            .set({ lastNotifiedAt: notificationNow, updatedAt: notificationNow })
            .where(and(eq(alertIncidents.id, incident.id), eq(alertIncidents.workspaceId, workspaceId))))
        }
        detected += 1
      }
    }

    resolved += await withSystemTransaction(async (db) => {
      const existing = await db.query.alertIncidents.findMany({
        where: and(
          eq(alertIncidents.workspaceId, workspaceId),
          eq(alertIncidents.agentId, agent.id),
          inArray(alertIncidents.status, ['open', 'reopened', 'acknowledged', 'snoozed']),
        ),
      })
      let resolvedForAgent = 0
      for (const incident of existing) {
        if (activeFingerprints.has(incident.fingerprint)) continue
        await db
          .update(alertIncidents)
          .set({ status: 'resolved', resolvedAt: new Date(), updatedAt: new Date() })
          .where(and(eq(alertIncidents.id, incident.id), eq(alertIncidents.workspaceId, workspaceId)))
        resolvedForAgent += 1
      }
      await db
        .update(monitoringAgents)
        .set({ lastRunAt: new Date(), updatedAt: new Date() })
        .where(and(eq(monitoringAgents.id, agent.id), eq(monitoringAgents.workspaceId, workspaceId)))
      return resolvedForAgent
    })
  }

  return {
    agents: agents.length,
    clients: processedClients.size,
    detected,
    resolved,
    notifications: { delivered, failed: notificationFailures },
  }
}
