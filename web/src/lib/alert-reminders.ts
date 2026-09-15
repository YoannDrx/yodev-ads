import 'server-only'

import { and, asc, eq, inArray, isNotNull, isNull, lte, sql } from 'drizzle-orm'
import { alertIncidents, clients, monitoringAgents, notificationDeliveries, workspaces } from '@/db/schema'
import { withSystemTransaction } from '@/db/transactions'
import { alertReminderDueAt, alertReminderEventKey } from '@/lib/alert-reminder-plan'
import { featureEnabled } from '@/lib/feature-flags'
import { dispatchIncidentNotifications } from '@/lib/notifications'
import type { EnqueueJobInput } from '@/lib/jobs'

const baselineDueAt = sql<Date>`coalesce(${alertIncidents.lastNotifiedAt}, ${alertIncidents.createdAt}) + ${monitoringAgents.reminderIntervalHours} * interval '1 hour'`
const effectiveDueAt = sql<Date>`case when ${alertIncidents.status} = 'snoozed' then greatest(${baselineDueAt}, ${alertIncidents.snoozedUntil}) else ${baselineDueAt} end`
// Repeatedly unavailable destinations must not keep the first hundred overdue
// incidents at the head of every scheduler pass.
const lastReminderAttempt = sql`coalesce((select max(reminder_job.created_at) from jobs reminder_job where reminder_job.workspace_id = ${alertIncidents.workspaceId} and reminder_job.type = 'monitoring.reminder' and reminder_job.payload->>'incidentId' = ${alertIncidents.id}::text), '-infinity'::timestamptz)`

export async function pendingAlertReminderJobs(now = new Date()): Promise<EnqueueJobInput[]> {
  if (!featureEnabled('notifications')) return []
  const due = await withSystemTransaction((db) => db.select({
    incident: alertIncidents, intervalHours: monitoringAgents.reminderIntervalHours,
  }).from(alertIncidents)
    .innerJoin(monitoringAgents, and(eq(monitoringAgents.id, alertIncidents.agentId), eq(monitoringAgents.workspaceId, alertIncidents.workspaceId)))
    .innerJoin(workspaces, eq(workspaces.id, alertIncidents.workspaceId))
    .innerJoin(clients, and(eq(clients.id, alertIncidents.clientId), eq(clients.workspaceId, alertIncidents.workspaceId)))
    .where(and(
      inArray(alertIncidents.status, ['open', 'reopened', 'snoozed']),
      eq(monitoringAgents.enabled, true), isNotNull(monitoringAgents.reminderIntervalHours),
      eq(clients.active, true), eq(clients.isManager, false),
      inArray(workspaces.accessState, ['internal', 'trial', 'active']), lte(effectiveDueAt, now),
    )).orderBy(asc(lastReminderAttempt), asc(effectiveDueAt), asc(alertIncidents.id)).limit(100))
  return due.flatMap(({ incident, intervalHours }) => {
    const dueAt = alertReminderDueAt(incident, intervalHours)
    if (!dueAt || dueAt > now) return []
    return [{
      workspaceId: incident.workspaceId, type: 'monitoring.reminder' as const,
      payload: { workspaceId: incident.workspaceId, incidentId: incident.id, dueAt: dueAt.toISOString() },
      priority: incident.severity === 'critical' ? 25 : 65,
      // Delivery uses the stable occurrence key; a later tick may re-check an
      // occurrence skipped because no channel was available or a retry settled.
      deduplicationKey: `${alertReminderEventKey(incident.id, dueAt)}:tick:${Math.floor(now.getTime() / 300_000)}`,
      maximumAttempts: 3,
    }]
  })
}

export async function deliverAlertReminder(input: { workspaceId: string; incidentId: string; dueAt: string }, now = new Date()) {
  if (!featureEnabled('notifications')) return { skipped: true, reason: 'disabled' }
  const context = await withSystemTransaction(async (db) => {
    const [row] = await db.select({ incident: alertIncidents, agent: monitoringAgents, workspace: workspaces, client: clients })
      .from(alertIncidents)
      .innerJoin(monitoringAgents, and(eq(monitoringAgents.id, alertIncidents.agentId), eq(monitoringAgents.workspaceId, alertIncidents.workspaceId)))
      .innerJoin(workspaces, eq(workspaces.id, alertIncidents.workspaceId))
      .innerJoin(clients, and(eq(clients.id, alertIncidents.clientId), eq(clients.workspaceId, alertIncidents.workspaceId)))
      .where(and(eq(alertIncidents.id, input.incidentId), eq(alertIncidents.workspaceId, input.workspaceId))).limit(1)
    return row
  })
  if (!context || !context.agent.enabled || !context.client.active || context.client.isManager || !['internal', 'trial', 'active'].includes(context.workspace.accessState)) return { skipped: true, reason: 'unavailable' }
  const dueAt = alertReminderDueAt(context.incident, context.agent.reminderIntervalHours)
  if (!dueAt || dueAt > now || dueAt.toISOString() !== input.dueAt) return { skipped: true, reason: 'stale' }
  const eventKey = alertReminderEventKey(input.incidentId, dueAt)
  await dispatchIncidentNotifications({
    workspaceId: input.workspaceId, incidentId: input.incidentId, eventKey,
    reminderDueAt: dueAt.toISOString(), reminderIntervalHours: context.agent.reminderIntervalHours!,
    severity: context.incident.severity === 'critical' ? 'critical' : 'warning',
    title: context.incident.title, description: context.incident.description, clientName: context.client.name,
    locale: context.workspace.locale === 'en' ? 'en' : 'fr',
  })
  // Re-read durable evidence, including a previous worker's acceptance. A
  // crash after provider acceptance must not leave the reminder clock stuck.
  const accepted = await withSystemTransaction((db) => db.query.notificationDeliveries.findFirst({
    where: and(eq(notificationDeliveries.workspaceId, input.workspaceId), eq(notificationDeliveries.eventKey, eventKey),
      inArray(notificationDeliveries.status, ['accepted', 'delivered'])),
    columns: { terminalAt: true }, orderBy: [asc(notificationDeliveries.terminalAt)],
  }))
  if (!accepted?.terminalAt) return { skipped: true, reason: 'not_accepted' }
  await withSystemTransaction((db) => db.update(alertIncidents).set({ lastNotifiedAt: accepted.terminalAt, updatedAt: now })
    .where(and(eq(alertIncidents.id, input.incidentId), eq(alertIncidents.workspaceId, input.workspaceId),
      context.incident.lastNotifiedAt ? eq(alertIncidents.lastNotifiedAt, context.incident.lastNotifiedAt) : isNull(alertIncidents.lastNotifiedAt))))
  return { accepted: true, acceptedAt: accepted.terminalAt.toISOString() }
}
