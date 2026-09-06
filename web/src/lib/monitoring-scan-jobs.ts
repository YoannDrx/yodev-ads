import 'server-only'

import { createHash } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { auditEvents, clients, monitoringAgents, workspaces } from '@/db/schema'
import { withSystemTransaction } from '@/db/transactions'
import { enqueueJobs, type EnqueueJobInput } from '@/lib/jobs'
import { monitoringScanPlan } from '@/lib/monitoring-scan-plan'
import { remainingWorkMs } from '@/lib/work-deadline'
import { runWorkspaceMonitoring } from '@/lib/run-monitoring'

/** Old workspace-wide jobs become idempotent coordinators after deployment. */
export async function fanOutMonitoringScan(input: { workspaceId: string; parentJobId: string; agentId?: string }) {
  const context = await withSystemTransaction(async (db) => {
    const workspace = await db.query.workspaces.findFirst({ where: eq(workspaces.id, input.workspaceId), columns: { accessState: true } })
    if (!workspace || !['internal', 'trial', 'active'].includes(workspace.accessState)) return null
    const agents = await db.query.monitoringAgents.findMany({
      where: and(eq(monitoringAgents.workspaceId, input.workspaceId), eq(monitoringAgents.enabled, true),
        input.agentId ? eq(monitoringAgents.id, input.agentId) : undefined),
    })
    const accounts = await db.query.clients.findMany({
      where: and(eq(clients.workspaceId, input.workspaceId), eq(clients.active, true), eq(clients.isManager, false)),
    })
    return { agents, accounts }
  })
  if (!context) return { chunks: 0, created: 0, skipped: true }
  const chunks = monitoringScanPlan(context.agents, context.accounts)
  let created = 0
  for (let offset = 0; offset < chunks.length; offset += 100) {
    remainingWorkMs(1_000)
    const pending: EnqueueJobInput[] = chunks.slice(offset, offset + 100).map((chunk) => ({
      workspaceId: input.workspaceId,
      type: 'monitoring.scan_chunk',
      payload: { workspaceId: input.workspaceId, parentJobId: input.parentJobId, ...chunk },
      priority: 55,
      deduplicationKey: `monitoring.chunk:${input.parentJobId}:${createHash('sha256').update(JSON.stringify(chunk)).digest('hex')}`,
    }))
    created += (await enqueueJobs(pending)).created
  }
  return { chunks: chunks.length, created, skipped: false }
}

export async function executeMonitoringChunk(input: { workspaceId: string; parentJobId: string; clientId: string; agentIds: string[] }) {
  const workspace = await withSystemTransaction((db) => db.query.workspaces.findFirst({
    where: eq(workspaces.id, input.workspaceId), columns: { accessState: true },
  }))
  if (!workspace || !['internal', 'trial', 'active'].includes(workspace.accessState)) return { skipped: true }
  const result = await runWorkspaceMonitoring(input.workspaceId, undefined, { clientId: input.clientId, agentIds: input.agentIds })
  await withSystemTransaction((db) => db.insert(auditEvents).values({
    workspaceId: input.workspaceId, actorUserId: 'system:monitoring', action: 'monitoring.chunk_completed',
    entityType: 'client', entityId: input.clientId,
    metadata: { ...result, parentJobId: input.parentJobId, agentIds: input.agentIds },
  }))
  return result
}
