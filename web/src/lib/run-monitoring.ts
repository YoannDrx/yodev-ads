import 'server-only'

import { and, eq } from 'drizzle-orm'
import { getDb } from '@/db'
import { alertIncidents, clients, monitoringAgents } from '@/db/schema'
import { getWorkspaceConnection } from '@/lib/data'
import { GoogleAdsGateway } from '@/lib/google-ads'
import { analyzeCampaigns } from '@/lib/monitoring'

export async function runWorkspaceMonitoring(workspaceId: string, onlyAgentId?: string) {
  const db = getDb()
  const connection = await getWorkspaceConnection(workspaceId)
  if (!connection) throw new Error('Connexion Google Ads absente.')

  const agents = await db.query.monitoringAgents.findMany({
    where: onlyAgentId
      ? and(
          eq(monitoringAgents.workspaceId, workspaceId),
          eq(monitoringAgents.id, onlyAgentId),
          eq(monitoringAgents.enabled, true),
        )
      : and(eq(monitoringAgents.workspaceId, workspaceId), eq(monitoringAgents.enabled, true)),
  })
  const workspaceClients = await db.query.clients.findMany({
    where: and(eq(clients.workspaceId, workspaceId), eq(clients.active, true), eq(clients.isManager, false)),
  })
  const gateway = new GoogleAdsGateway(connection)
  const campaignCache = new Map<string, Awaited<ReturnType<typeof gateway.campaignPerformance>>>()
  let detected = 0
  let resolved = 0

  for (const agent of agents) {
    const targets = agent.clientId
      ? workspaceClients.filter((client) => client.id === agent.clientId)
      : workspaceClients
    const activeFingerprints = new Set<string>()
    for (const client of targets) {
      let campaigns = campaignCache.get(client.id)
      if (!campaigns) {
        campaigns = await gateway.campaignPerformance(client.googleCustomerId)
        campaignCache.set(client.id, campaigns)
      }
      const findings = analyzeCampaigns(agent, campaigns)
      for (const finding of findings) {
        const fingerprint = `${finding.fingerprint}:${client.id}`
        activeFingerprints.add(fingerprint)
        await db
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
              status: 'open',
              resolvedAt: null,
              detectedAt: new Date(),
              updatedAt: new Date(),
            },
          })
        detected += 1
      }
    }

    const existing = await db.query.alertIncidents.findMany({
      where: and(
        eq(alertIncidents.workspaceId, workspaceId),
        eq(alertIncidents.agentId, agent.id),
        eq(alertIncidents.status, 'open'),
      ),
    })
    for (const incident of existing) {
      if (activeFingerprints.has(incident.fingerprint)) continue
      await db
        .update(alertIncidents)
        .set({ status: 'resolved', resolvedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(alertIncidents.id, incident.id), eq(alertIncidents.workspaceId, workspaceId)))
      resolved += 1
    }
    await db
      .update(monitoringAgents)
      .set({ lastRunAt: new Date(), updatedAt: new Date() })
      .where(and(eq(monitoringAgents.id, agent.id), eq(monitoringAgents.workspaceId, workspaceId)))
  }

  return { agents: agents.length, clients: campaignCache.size, detected, resolved }
}
