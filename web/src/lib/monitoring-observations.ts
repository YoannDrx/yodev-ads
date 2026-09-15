import 'server-only'

import { createHash } from 'node:crypto'
import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { z } from 'zod'
import { alertIncidents, auditEvents, clients, jobs, monitoringAgents, workspaces } from '@/db/schema'
import { withSystemTransaction } from '@/db/transactions'
import { alertNotificationEvent } from '@/lib/alert-notification-events'
import { queueIncidentNotifications } from '@/lib/notifications'
import { remainingWorkMs } from '@/lib/work-deadline'
import type { MonitoringFinding } from '@/lib/monitoring'

export type MonitoringClaim = { jobId: string; attempt: number; workerId: string }
const resultSchema = z.object({ detected: z.number().int().nonnegative(), resolved: z.number().int().nonnegative(), queued: z.number().int().nonnegative(), skipped: z.boolean().optional() })
const progressSchema = z.record(z.string().uuid(), resultSchema)
export type MonitoringObservationResult = z.infer<typeof resultSchema>

export function monitoringProgress(payload: Record<string, unknown>) {
  return progressSchema.parse(payload.monitoringProgress ?? {})
}

function claimCondition(workspaceId: string, claim: MonitoringClaim) {
  return and(eq(jobs.id, claim.jobId), eq(jobs.workspaceId, workspaceId), eq(jobs.type, 'monitoring.scan_chunk'),
    eq(jobs.status, 'running'), eq(jobs.attemptCount, claim.attempt), eq(jobs.leaseOwner, claim.workerId),
    sql`${jobs.leaseExpiresAt} > clock_timestamp()`)
}

export async function readMonitoringProgress(workspaceId: string, claim: MonitoringClaim) {
  return withSystemTransaction(async (db) => {
    const [job] = await db.select({ payload: jobs.payload }).from(jobs).where(claimCondition(workspaceId, claim)).limit(1)
    if (!job) throw new Error('Monitoring job lease lost')
    return monitoringProgress(job.payload)
  })
}

/** Incident changes, channel outboxes and the per-vigie checkpoint commit together. */
export async function persistMonitoringObservation(input: {
  workspaceId: string
  claim: MonitoringClaim
  agent: Pick<typeof monitoringAgents.$inferSelect, 'id' | 'kind' | 'threshold'>
  clientId: string
  findings: MonitoringFinding[]
  observedAt: Date
}) {
  return withSystemTransaction(async (db) => {
    const [job] = await db.select().from(jobs).where(claimCondition(input.workspaceId, input.claim)).limit(1).for('update')
    if (!job) throw new Error('Monitoring job lease lost')
    if (job.payload.clientId !== input.clientId || !Array.isArray(job.payload.agentIds) || !job.payload.agentIds.includes(input.agent.id)) {
      throw new Error('Monitoring observation is outside its job scope')
    }
    const progress = monitoringProgress(job.payload)
    if (progress[input.agent.id]) return progress[input.agent.id]
    await db.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`monitoring:${input.workspaceId}:${input.clientId}:${input.agent.id}`}, 0))`)
    const workspace = await db.query.workspaces.findFirst({ where: eq(workspaces.id, input.workspaceId) })
    const agent = await db.query.monitoringAgents.findFirst({ where: and(eq(monitoringAgents.id, input.agent.id), eq(monitoringAgents.workspaceId, input.workspaceId)) })
    const client = await db.query.clients.findFirst({ where: and(eq(clients.id, input.clientId), eq(clients.workspaceId, input.workspaceId)) })
    if (agent && (agent.kind !== input.agent.kind || agent.threshold !== input.agent.threshold)) throw new Error('Monitoring configuration changed during the read')
    const result: MonitoringObservationResult = { detected: 0, resolved: 0, queued: 0 }
    const previous = await db.query.auditEvents.findFirst({
      where: and(eq(auditEvents.workspaceId, input.workspaceId), eq(auditEvents.action, 'monitoring.observation_committed'),
        eq(auditEvents.entityId, input.agent.id), sql`${auditEvents.metadata}->>'clientId' = ${input.clientId}`),
      orderBy: [desc(auditEvents.createdAt), desc(auditEvents.id)],
    })
    const priorObservedAt = previous?.metadata && typeof previous.metadata.observedAt === 'string' ? Date.parse(previous.metadata.observedAt) : 0
    if (!workspace || !['internal', 'trial', 'active'].includes(workspace.accessState) || !agent?.enabled || !client?.active || client.isManager ||
      (agent.clientId && agent.clientId !== client.id) || priorObservedAt > input.observedAt.getTime()) {
      result.skipped = true
    } else {
      const existing = await db.query.alertIncidents.findMany({ where: and(
        eq(alertIncidents.workspaceId, input.workspaceId), eq(alertIncidents.agentId, agent.id), eq(alertIncidents.clientId, client.id),
      ) })
      const activeIds = new Set<string>()
      const seenFindings = new Set<string>()
      for (const finding of input.findings) {
        remainingWorkMs(1_000)
        if (seenFindings.has(finding.fingerprint)) continue
        seenFindings.add(finding.fingerprint)
        // Include the vigie identity: two rules of the same kind must not steal
        // each other's incident. Preserve attributable pre-upgrade incidents.
        const legacyFingerprint = `${finding.fingerprint}:${client.id}`
        const fingerprint = `monitor:v2:${createHash('sha256').update(JSON.stringify([agent.id, client.id, finding.fingerprint])).digest('hex')}`
        const old = existing.find((incident) => incident.fingerprint === fingerprint || incident.fingerprint === legacyFingerprint)
        if (old && activeIds.has(old.id)) continue
        const now = new Date()
        const event = alertNotificationEvent({ existing: old, nextSeverity: finding.severity, reminderIntervalHours: null, now })
        const status = old?.status === 'resolved' ? 'reopened'
          : old?.status === 'acknowledged' || (old?.status === 'snoozed' && old.snoozedUntil && old.snoozedUntil > now) ? old.status : 'open'
        const [incident] = await db.insert(alertIncidents).values({
          workspaceId: input.workspaceId, agentId: agent.id, clientId: client.id, ...finding,
          fingerprint: old?.fingerprint ?? fingerprint, value: String(finding.value), detectedAt: input.observedAt,
        }).onConflictDoUpdate({ target: [alertIncidents.workspaceId, alertIncidents.fingerprint], set: {
          title: finding.title, description: finding.description, severity: finding.severity, value: String(finding.value), status,
          resolvedAt: null, detectedAt: input.observedAt, occurrenceCount: sql`${alertIncidents.occurrenceCount} + 1`, updatedAt: now,
        } }).returning({ id: alertIncidents.id })
        activeIds.add(incident.id)
        result.detected += 1
        if (event) result.queued += await queueIncidentNotifications(db, {
          workspaceId: input.workspaceId, incidentId: incident.id,
          eventKey: `monitoring:${input.claim.jobId}:${incident.id}:${event}`,
          severity: finding.severity, title: finding.title, description: finding.description, clientName: client.name,
        })
      }
      const resolvedIds = existing.filter((incident) => !activeIds.has(incident.id) && ['open', 'reopened', 'acknowledged', 'snoozed'].includes(incident.status)).map((incident) => incident.id)
      if (resolvedIds.length > 0) {
        await db.update(alertIncidents).set({ status: 'resolved', resolvedAt: new Date(), updatedAt: new Date() }).where(and(
          eq(alertIncidents.workspaceId, input.workspaceId), eq(alertIncidents.clientId, client.id), eq(alertIncidents.agentId, agent.id), inArray(alertIncidents.id, resolvedIds),
        ))
        result.resolved = resolvedIds.length
      }
      await db.update(monitoringAgents).set({ lastRunAt: sql`greatest(${monitoringAgents.lastRunAt}, ${input.observedAt})`, updatedAt: new Date() }).where(eq(monitoringAgents.id, agent.id))
      await db.insert(auditEvents).values({
        workspaceId: input.workspaceId, actorUserId: 'system:monitoring', action: 'monitoring.observation_committed',
        entityType: 'monitoring_agent', entityId: agent.id, createdAt: new Date(),
        metadata: { ...result, jobId: input.claim.jobId, clientId: client.id, observedAt: input.observedAt.toISOString() },
      })
    }
    const [checkpoint] = await db.update(jobs).set({ payload: { ...job.payload, monitoringProgress: { ...progress, [input.agent.id]: result } }, updatedAt: new Date() })
      .where(claimCondition(input.workspaceId, input.claim)).returning({ id: jobs.id })
    if (!checkpoint) throw new Error('Monitoring job lease lost before checkpoint')
    return result
  })
}
