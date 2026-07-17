import 'server-only'

import { and, desc, eq } from 'drizzle-orm'
import { getDb } from '@/db'
import { approvalRequests, auditEvents, clients, googleAdsConnections } from '@/db/schema'

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
