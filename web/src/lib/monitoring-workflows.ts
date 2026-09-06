import 'server-only'

import { and, count, eq, inArray, sql } from 'drizzle-orm'
import { alertComments, alertIncidents, auditEvents, jobs, monitoringAgents } from '@/db/schema'
import { withTenantTransaction } from '@/db/transactions'
import { insertActivationMilestone } from '@/lib/activation'
import { requireQuota, type EntitlementContext } from '@/lib/entitlements'
import { lockWorkspaceEntitlements } from '@/lib/workspace-transaction-guard'
import { requireFeature } from '@/lib/feature-flags'

type ActorContext = { workspaceId: string; actorUserId: string }

export async function requestWorkspaceMonitoringScan(input: ActorContext & { agentId?: string; now?: Date }) {
  requireFeature('googleReads', 'Les lectures Google Ads sont temporairement désactivées.')
  requireFeature('scheduler', 'Les analyses en arrière-plan sont temporairement indisponibles.')
  return withTenantTransaction({ workspaceId: input.workspaceId, userId: input.actorUserId }, async (db) => {
    await lockWorkspaceEntitlements(db, input.workspaceId, 'monitoring')
    if (input.agentId) {
      const agent = await db.query.monitoringAgents.findFirst({
        where: and(eq(monitoringAgents.workspaceId, input.workspaceId), eq(monitoringAgents.id, input.agentId), eq(monitoringAgents.enabled, true)),
      })
      if (!agent) throw new Error('Vigie introuvable ou en pause.')
    }
    const active = await db.query.jobs.findFirst({
      where: and(eq(jobs.workspaceId, input.workspaceId), inArray(jobs.type, ['monitoring.scan', 'monitoring.scan_chunk']),
        inArray(jobs.status, ['queued', 'running', 'retrying'])),
      columns: { id: true },
    })
    if (active) return { created: false, jobId: active.id }
    const now = input.now ?? new Date()
    const [created] = await db.insert(jobs).values({
      workspaceId: input.workspaceId, type: 'monitoring.scan',
      payload: { workspaceId: input.workspaceId, agentId: input.agentId }, priority: 50,
      deduplicationKey: `monitoring.manual:${input.workspaceId}:${Math.floor(now.getTime() / 300_000)}`,
    }).onConflictDoNothing().returning({ id: jobs.id })
    if (!created) return { created: false, jobId: null }
    await db.insert(auditEvents).values({
      workspaceId: input.workspaceId, actorUserId: input.actorUserId, action: 'monitoring.scan_requested',
      entityType: 'job', entityId: created.id, metadata: { agentId: input.agentId ?? null },
    })
    return { created: true, jobId: created.id }
  })
}

export type AlertWorkflowOperation =
  | 'acknowledge'
  | 'snooze_24h'
  | 'resolve'
  | 'reopen'
  | 'assign_self'
  | 'unassign'

export function createWorkspaceMonitoringAgent(input: ActorContext & {
  clientId: string | null
  kind: string
  name: string
  description: string
  threshold: number
  reminderIntervalHours: number | null
  entitlements: EntitlementContext
}) {
  return withTenantTransaction({ workspaceId: input.workspaceId, userId: input.actorUserId }, async (transaction) => {
    const entitlements = await lockWorkspaceEntitlements(transaction, input.workspaceId, 'monitoring')
    await transaction.execute(sql`select pg_advisory_xact_lock(hashtext(${`${input.workspaceId}:monitors`}))`)
    const [usage] = await transaction
      .select({ count: count() })
      .from(monitoringAgents)
      .where(and(eq(monitoringAgents.workspaceId, input.workspaceId), eq(monitoringAgents.enabled, true)))
    requireQuota(entitlements, 'monitors', usage.count)
    const [created] = await transaction
      .insert(monitoringAgents)
      .values({
        workspaceId: input.workspaceId,
        clientId: input.clientId,
        createdBy: input.actorUserId,
        kind: input.kind,
        name: input.name,
        description: input.description,
        threshold: String(input.threshold),
        reminderIntervalHours: input.reminderIntervalHours,
      })
      .returning()
    if (!created) throw new Error('La création de la vigie a échoué.')
    await transaction.insert(auditEvents).values({
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      action: 'monitoring.agent_created',
      entityType: 'monitoring_agent',
      entityId: created.id,
      metadata: { kind: input.kind, clientId: created.clientId, reminderIntervalHours: created.reminderIntervalHours },
    })
    await insertActivationMilestone(transaction, {
      workspaceId: input.workspaceId,
      milestone: 'first_monitor',
      actorUserId: input.actorUserId,
      sourceEntityId: created.id,
    })
    return created
  })
}

export async function setWorkspaceMonitoringAgentEnabled(input: ActorContext & {
  agentId: string
  enabled: boolean
  now?: Date
}) {
  return withTenantTransaction(
    { workspaceId: input.workspaceId, userId: input.actorUserId },
    async (db) => {
      const entitlements = await lockWorkspaceEntitlements(db, input.workspaceId, 'monitoring')
      await db.execute(sql`select pg_advisory_xact_lock(hashtext(${`${input.workspaceId}:monitors`}))`)
      const existing = await db.query.monitoringAgents.findFirst({
        where: and(eq(monitoringAgents.id, input.agentId), eq(monitoringAgents.workspaceId, input.workspaceId)),
      })
      if (!existing) throw new Error('Vigie introuvable.')
      if (existing.enabled === input.enabled) return existing
      if (input.enabled) {
        const [usage] = await db.select({ count: count() }).from(monitoringAgents)
          .where(and(eq(monitoringAgents.workspaceId, input.workspaceId), eq(monitoringAgents.enabled, true)))
        requireQuota(entitlements, 'monitors', usage.count)
      }
      const [agent] = await db
      .update(monitoringAgents)
      .set({ enabled: input.enabled, updatedAt: input.now ?? new Date() })
      .where(and(eq(monitoringAgents.id, input.agentId), eq(monitoringAgents.workspaceId, input.workspaceId)))
      .returning()
      if (!agent) throw new Error('Vigie introuvable.')
      await db.insert(auditEvents).values({
        workspaceId: input.workspaceId, actorUserId: input.actorUserId,
        action: input.enabled ? 'monitoring.agent_enabled' : 'monitoring.agent_disabled',
        entityType: 'monitoring_agent', entityId: agent.id,
        metadata: { previouslyEnabled: existing.enabled },
      })
      return agent
    },
  )
}

export function recordWorkspaceMonitoringScan(input: ActorContext & {
  result: Record<string, unknown>
}) {
  return withTenantTransaction(
    { workspaceId: input.workspaceId, userId: input.actorUserId },
    (db) => db.insert(auditEvents).values({
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      action: 'monitoring.scan_completed',
      entityType: 'workspace',
      entityId: input.workspaceId,
      metadata: input.result,
    }),
  )
}

export function acknowledgeWorkspaceAlert(input: ActorContext & { incidentId: string; now?: Date }) {
  return withTenantTransaction({ workspaceId: input.workspaceId, userId: input.actorUserId }, async (db) => {
    const now = input.now ?? new Date()
    const [incident] = await db
      .update(alertIncidents)
      .set({ status: 'acknowledged', acknowledgedAt: now, updatedAt: now })
      .where(and(eq(alertIncidents.id, input.incidentId), eq(alertIncidents.workspaceId, input.workspaceId)))
      .returning()
    if (!incident) throw new Error('Alerte introuvable.')
    await db.insert(auditEvents).values({
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      action: 'monitoring.alert_acknowledged',
      entityType: 'alert_incident',
      entityId: incident.id,
      metadata: {},
    })
    return incident
  })
}

export function updateWorkspaceAlertWorkflow(input: ActorContext & {
  incidentId: string
  operation: AlertWorkflowOperation
  comment?: string
  dueDate?: string
  now?: Date
}) {
  const now = input.now ?? new Date()
  const dueAt = input.dueDate ? new Date(`${input.dueDate}T12:00:00.000Z`) : undefined
  const changes = input.operation === 'acknowledge'
    ? { status: 'acknowledged', acknowledgedAt: now, snoozedUntil: null, resolvedAt: null }
    : input.operation === 'snooze_24h'
      ? { status: 'snoozed', snoozedUntil: new Date(now.getTime() + 24 * 60 * 60_000), resolvedAt: null }
      : input.operation === 'resolve'
        ? { status: 'resolved', resolvedAt: now, snoozedUntil: null }
        : input.operation === 'reopen'
          ? { status: 'reopened', resolvedAt: null, snoozedUntil: null }
          : input.operation === 'assign_self'
            ? { assignedTo: input.actorUserId, ...(dueAt ? { dueAt } : {}) }
            : { assignedTo: null, dueAt: null }

  return withTenantTransaction({ workspaceId: input.workspaceId, userId: input.actorUserId }, async (transaction) => {
    const [incident] = await transaction
      .update(alertIncidents)
      .set({ ...changes, updatedAt: now })
      .where(and(eq(alertIncidents.id, input.incidentId), eq(alertIncidents.workspaceId, input.workspaceId)))
      .returning({ id: alertIncidents.id })
    if (!incident) throw new Error('Alerte introuvable.')
    if (input.comment) await transaction.insert(alertComments).values({
      workspaceId: input.workspaceId,
      incidentId: incident.id,
      authorUserId: input.actorUserId,
      body: input.comment,
    })
    await transaction.insert(auditEvents).values({
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      action: `monitoring.alert_${input.operation}`,
      entityType: 'alert_incident',
      entityId: incident.id,
      metadata: { hasComment: Boolean(input.comment), dueAt: dueAt?.toISOString() ?? null },
    })
    return incident
  })
}
