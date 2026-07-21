import 'server-only'

import { and, desc, eq, isNull } from 'drizzle-orm'
import { getDb } from '@/db'
import {
  alertIncidents,
  apiKeys,
  approvalComments,
  approvalRequests,
  auditEvents,
  clients,
  clientApprovalFeedback,
  googleAdsConnections,
  monitoringAgents,
  notificationChannels,
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
  const rows = await getDb()
    .select({ request: approvalRequests, client: clients })
    .from(approvalRequests)
    .innerJoin(clients, eq(clients.id, approvalRequests.clientId))
    .where(eq(approvalRequests.workspaceId, workspaceId))
    .orderBy(desc(approvalRequests.createdAt))
    .limit(100)
  const [comments, clientFeedback] = await Promise.all([
    getDb().query.approvalComments.findMany({
      where: eq(approvalComments.workspaceId, workspaceId),
      orderBy: [approvalComments.createdAt],
    }),
    getDb().query.clientApprovalFeedback.findMany({
      where: eq(clientApprovalFeedback.workspaceId, workspaceId),
      orderBy: [desc(clientApprovalFeedback.createdAt)],
    }),
  ])
  const commentsByApproval = new Map<string, typeof comments>()
  for (const comment of comments) {
    commentsByApproval.set(comment.approvalId, [...(commentsByApproval.get(comment.approvalId) ?? []), comment])
  }
  const feedbackByApproval = new Map(clientFeedback.map((feedback) => [feedback.approvalId, feedback]))
  return rows.map((row) => ({
    ...row,
    comments: commentsByApproval.get(row.request.id) ?? [],
    clientFeedback: feedbackByApproval.get(row.request.id),
  }))
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

export async function listPublicClientApprovals(workspaceId: string, clientId: string, shareId: string) {
  return getDb()
    .select({ request: approvalRequests, feedback: clientApprovalFeedback })
    .from(approvalRequests)
    .leftJoin(
      clientApprovalFeedback,
      and(
        eq(clientApprovalFeedback.approvalId, approvalRequests.id),
        eq(clientApprovalFeedback.shareId, shareId),
      ),
    )
    .where(
      and(
        eq(approvalRequests.workspaceId, workspaceId),
        eq(approvalRequests.clientId, clientId),
        eq(approvalRequests.status, 'pending'),
      ),
    )
    .orderBy(desc(approvalRequests.createdAt))
}

export async function listApiKeys(workspaceId: string) {
  return getDb().query.apiKeys.findMany({
    where: and(eq(apiKeys.workspaceId, workspaceId), isNull(apiKeys.revokedAt)),
    orderBy: [desc(apiKeys.createdAt)],
  })
}

export async function listNotificationChannels(workspaceId: string) {
  return getDb().query.notificationChannels.findMany({
    where: and(eq(notificationChannels.workspaceId, workspaceId), eq(notificationChannels.enabled, true)),
    orderBy: [desc(notificationChannels.createdAt)],
  })
}
