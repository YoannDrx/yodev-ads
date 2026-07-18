import 'server-only'

import { and, desc, eq, isNull } from 'drizzle-orm'
import { getDb } from '@/db'
import {
  alertIncidents,
  apiKeys,
  approvalRequests,
  auditEvents,
  clients,
  googleAdsConnections,
  monitoringAgents,
  shareLinks,
} from '@/db/schema'
import { hashToken } from '@/lib/tokens'

export async function getWorkspaceConnection(workspaceId: string) {
  return getDb().query.googleAdsConnections.findFirst({
    where: eq(googleAdsConnections.workspaceId, workspaceId),
  })
}

export async function listWorkspaceClients(workspaceId: string) {
  return getDb().query.clients.findMany({
    where: and(eq(clients.workspaceId, workspaceId), eq(clients.active, true)),
    orderBy: [clients.name],
  })
}

export async function getWorkspaceClient(workspaceId: string, clientId?: string) {
  if (clientId) {
    const selected = await getDb().query.clients.findFirst({
      where: and(eq(clients.workspaceId, workspaceId), eq(clients.id, clientId), eq(clients.active, true)),
    })
    if (selected) return selected
  }
  return getDb().query.clients.findFirst({
    where: and(eq(clients.workspaceId, workspaceId), eq(clients.active, true), eq(clients.isManager, false)),
    orderBy: [clients.name],
  })
}

export async function listApprovals(workspaceId: string) {
  return getDb()
    .select({ request: approvalRequests, client: clients })
    .from(approvalRequests)
    .innerJoin(clients, eq(clients.id, approvalRequests.clientId))
    .where(eq(approvalRequests.workspaceId, workspaceId))
    .orderBy(desc(approvalRequests.createdAt))
    .limit(100)
}

export async function listAuditEvents(workspaceId: string) {
  return getDb().query.auditEvents.findMany({
    where: eq(auditEvents.workspaceId, workspaceId),
    orderBy: [desc(auditEvents.createdAt)],
    limit: 150,
  })
}

export async function listMonitoringAgents(workspaceId: string) {
  return getDb()
    .select({ agent: monitoringAgents, client: clients })
    .from(monitoringAgents)
    .leftJoin(clients, eq(clients.id, monitoringAgents.clientId))
    .where(eq(monitoringAgents.workspaceId, workspaceId))
    .orderBy(desc(monitoringAgents.createdAt))
}

export async function listAlertIncidents(workspaceId: string) {
  return getDb()
    .select({ incident: alertIncidents, client: clients, agent: monitoringAgents })
    .from(alertIncidents)
    .innerJoin(clients, eq(clients.id, alertIncidents.clientId))
    .innerJoin(monitoringAgents, eq(monitoringAgents.id, alertIncidents.agentId))
    .where(eq(alertIncidents.workspaceId, workspaceId))
    .orderBy(desc(alertIncidents.detectedAt))
    .limit(200)
}

export async function listShareLinks(workspaceId: string) {
  return getDb()
    .select({ share: shareLinks, client: clients })
    .from(shareLinks)
    .innerJoin(clients, eq(clients.id, shareLinks.clientId))
    .where(eq(shareLinks.workspaceId, workspaceId))
    .orderBy(desc(shareLinks.createdAt))
}

export async function getPublicShare(token: string) {
  const [result] = await getDb()
    .select({ share: shareLinks, client: clients, connection: googleAdsConnections })
    .from(shareLinks)
    .innerJoin(clients, eq(clients.id, shareLinks.clientId))
    .innerJoin(googleAdsConnections, eq(googleAdsConnections.workspaceId, shareLinks.workspaceId))
    .where(and(eq(shareLinks.tokenHash, hashToken(token)), eq(shareLinks.active, true)))
    .limit(1)
  if (!result || (result.share.expiresAt && result.share.expiresAt < new Date())) return undefined
  return result
}

export async function listApiKeys(workspaceId: string) {
  return getDb().query.apiKeys.findMany({
    where: and(eq(apiKeys.workspaceId, workspaceId), isNull(apiKeys.revokedAt)),
    orderBy: [desc(apiKeys.createdAt)],
  })
}
