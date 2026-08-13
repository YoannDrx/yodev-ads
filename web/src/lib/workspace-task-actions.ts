import 'server-only'

import { and, eq, inArray } from 'drizzle-orm'
import {
  alertIncidents,
  approvalRequests,
  auditEvents,
  clients,
  jobs,
  memberNotificationPreferences,
  taskComments,
  workspaceTasks,
} from '@/db/schema'
import { withTenantTransaction } from '@/db/transactions'
import { normalizedMentionHandles } from '@/lib/task-notification-model'
import { extractMentions, taskDeadline, transitionTask, type TaskOperation } from '@/lib/task-workflow'

type ActorContext = { workspaceId: string; actorUserId: string }
type TaskSourceType = 'manual' | 'alert' | 'approval' | 'report'
type TaskPriority = 'low' | 'normal' | 'high' | 'urgent'

export type WorkspaceTaskOperation = TaskOperation | 'assign_self' | 'unassign' | 'update_due' | 'clear_due'

export function createTenantWorkspaceTask(input: ActorContext & {
  timezone: string
  sourceType: TaskSourceType
  sourceEntityId?: string
  clientId?: string
  title?: string
  description?: string
  priority: TaskPriority
  dueDate?: string
  slaHours?: number
  assignSelf: boolean
  now?: Date
}) {
  const now = input.now ?? new Date()
  const deadline = taskDeadline({ now, timezone: input.timezone, dueDate: input.dueDate, slaHours: input.slaHours })
  return withTenantTransaction({ workspaceId: input.workspaceId, userId: input.actorUserId }, async (db) => {
    let clientId = input.clientId ?? null
    let title = input.title
    let description = input.description ?? ''
    if (input.sourceType === 'alert') {
      if (!input.sourceEntityId) throw new Error('Alerte source manquante.')
      const incident = await db.query.alertIncidents.findFirst({
        where: and(eq(alertIncidents.id, input.sourceEntityId), eq(alertIncidents.workspaceId, input.workspaceId)),
      })
      if (!incident) throw new Error('Alerte source introuvable.')
      clientId = incident.clientId
      title = incident.title
      description = incident.description
    } else if (input.sourceType === 'approval') {
      if (!input.sourceEntityId) throw new Error('Approbation source manquante.')
      const approval = await db.query.approvalRequests.findFirst({
        where: and(eq(approvalRequests.id, input.sourceEntityId), eq(approvalRequests.workspaceId, input.workspaceId)),
      })
      if (!approval) throw new Error('Approbation source introuvable.')
      clientId = approval.clientId
      title = approval.title
      description = `Suivre la demande d’approbation ${approval.id}.`
    } else if (!title || title.length < 2) {
      throw new Error('Le titre de la tâche est requis.')
    }
    if (clientId) {
      const client = await db.query.clients.findFirst({
        where: and(eq(clients.id, clientId), eq(clients.workspaceId, input.workspaceId)),
      })
      if (!client) throw new Error('Compte client de la tâche introuvable.')
    }
    const [created] = await db.insert(workspaceTasks).values({
      workspaceId: input.workspaceId,
      clientId,
      createdBy: input.actorUserId,
      title: title!,
      description,
      priority: input.priority,
      assignedTo: input.assignSelf ? input.actorUserId : null,
      sourceType: input.sourceType,
      sourceEntityId: input.sourceEntityId ?? null,
      dueAt: deadline.dueAt,
      slaMinutes: deadline.slaMinutes,
    }).onConflictDoNothing().returning({ id: workspaceTasks.id })
    if (!created) throw new Error('Une tâche existe déjà pour cette source.')
    await db.insert(auditEvents).values({
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      action: 'task.created',
      entityType: 'workspace_task',
      entityId: created.id,
      metadata: {
        sourceType: input.sourceType,
        sourceEntityId: input.sourceEntityId ?? null,
        priority: input.priority,
        dueAt: deadline.dueAt?.toISOString() ?? null,
      },
    })
    return created
  })
}

export function updateTenantWorkspaceTask(input: ActorContext & {
  taskId: string
  operation: WorkspaceTaskOperation
  timezone: string
  dueDate?: string
  now?: Date
}) {
  return withTenantTransaction({ workspaceId: input.workspaceId, userId: input.actorUserId }, async (db) => {
    const task = await db.query.workspaceTasks.findFirst({
      where: and(eq(workspaceTasks.id, input.taskId), eq(workspaceTasks.workspaceId, input.workspaceId)),
    })
    if (!task) throw new Error('Tâche introuvable.')
    const now = input.now ?? new Date()
    let changes: Record<string, unknown>
    if (['start', 'block', 'complete', 'reopen', 'cancel'].includes(input.operation)) {
      changes = transitionTask(task.status, input.operation as TaskOperation, now)
    } else if (input.operation === 'assign_self') {
      changes = { assignedTo: input.actorUserId }
    } else if (input.operation === 'unassign') {
      changes = { assignedTo: null }
    } else if (input.operation === 'clear_due') {
      changes = { dueAt: null, slaMinutes: null }
    } else {
      if (!input.dueDate) throw new Error('La date d’échéance est requise.')
      changes = taskDeadline({ now, timezone: input.timezone, dueDate: input.dueDate })
    }
    await db.update(workspaceTasks).set({ ...changes, updatedAt: now }).where(and(
      eq(workspaceTasks.id, task.id),
      eq(workspaceTasks.workspaceId, input.workspaceId),
    ))
    await db.insert(auditEvents).values({
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      action: `task.${input.operation}`,
      entityType: 'workspace_task',
      entityId: task.id,
      metadata: { previousStatus: task.status },
    })
    return task
  })
}

export function addTenantWorkspaceTaskComment(input: ActorContext & {
  taskId: string
  body: string
  notificationsEnabled: boolean
}) {
  return withTenantTransaction({ workspaceId: input.workspaceId, userId: input.actorUserId }, async (db) => {
    const task = await db.query.workspaceTasks.findFirst({
      where: and(eq(workspaceTasks.id, input.taskId), eq(workspaceTasks.workspaceId, input.workspaceId)),
      columns: { id: true },
    })
    if (!task) throw new Error('Tâche introuvable.')
    const mentions = extractMentions(input.body)
    const [comment] = await db.insert(taskComments).values({
      workspaceId: input.workspaceId,
      taskId: input.taskId,
      authorUserId: input.actorUserId,
      body: input.body,
      mentions,
    }).returning({ id: taskComments.id })
    if (!comment) throw new Error('La création du commentaire a échoué.')
    await db.insert(auditEvents).values({
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      action: 'task.comment_added',
      entityType: 'task_comment',
      entityId: comment.id,
      metadata: { taskId: input.taskId, mentions },
    })
    const handles = normalizedMentionHandles(mentions)
    const preferences = handles.length > 0 ? await db.query.memberNotificationPreferences.findMany({
      where: and(
        eq(memberNotificationPreferences.workspaceId, input.workspaceId),
        eq(memberNotificationPreferences.mentionNotifications, true),
        inArray(memberNotificationPreferences.mentionHandle, handles),
      ),
      columns: { id: true, authUserId: true },
    }) : []
    const preferenceIds = preferences
      .filter((preference) => preference.authUserId !== input.actorUserId)
      .map((preference) => preference.id)
    if (input.notificationsEnabled && preferenceIds.length > 0) {
      await db.insert(jobs).values(preferenceIds.map((preferenceId) => ({
        workspaceId: input.workspaceId,
        type: 'task.mention_deliver',
        payload: { commentId: comment.id, preferenceId },
        priority: 60,
        deduplicationKey: `task.mention_deliver:${comment.id}:${preferenceId}`,
      }))).onConflictDoNothing({ target: jobs.deduplicationKey })
    }
    return { comment, mentions, notificationCount: input.notificationsEnabled ? preferenceIds.length : 0 }
  })
}
