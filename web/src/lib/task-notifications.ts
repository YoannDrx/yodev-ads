import 'server-only'

import { and, eq, inArray } from 'drizzle-orm'
import {
  auditEvents,
  memberNotificationPreferences,
  taskComments,
  workspaceTasks,
  workspaces,
} from '@/db/schema'
import { withSystemTransaction } from '@/db/transactions'
import { decryptSecret } from '@/lib/crypto'
import { NonRetryableJobError } from '@/lib/jobs'
import { taskDigestEmail, taskMentionEmail } from '@/lib/task-notification-model'
import { sendTransactionalEmail } from '@/lib/transactional-email'

function appTasksUrl() {
  return `${process.env.NEXT_PUBLIC_APP_URL ?? 'https://ads.yodev.fr'}/tasks`
}

async function sendEmail(input: { to: string; subject: string; html: string; idempotencyKey: string }) {
  const result = await sendTransactionalEmail({
    from: process.env.TASK_FROM_EMAIL ?? process.env.NOTIFICATION_FROM_EMAIL ?? 'Ads by Yodev <ads@yodev.fr>',
    to: input.to,
    subject: input.subject,
    html: input.html,
    idempotencyKey: input.idempotencyKey,
    tag: input.idempotencyKey.startsWith('task-mention:') ? 'task_mention' : 'task_digest',
  })
  return result.providerMessageId
}

export async function deliverTaskMention(commentId: string, preferenceId: string) {
  const context = await withSystemTransaction(async (db) => {
    const preference = await db.query.memberNotificationPreferences.findFirst({ where: eq(memberNotificationPreferences.id, preferenceId) })
    const comment = await db.query.taskComments.findFirst({ where: eq(taskComments.id, commentId) })
    if (!preference || !comment || preference.workspaceId !== comment.workspaceId) throw new NonRetryableJobError('Mention ou destinataire introuvable.')
    const task = await db.query.workspaceTasks.findFirst({ where: and(eq(workspaceTasks.id, comment.taskId), eq(workspaceTasks.workspaceId, comment.workspaceId)) })
    const workspace = await db.query.workspaces.findFirst({ where: eq(workspaces.id, comment.workspaceId) })
    if (!task || !workspace) throw new NonRetryableJobError('Contexte de mention incomplet.')
    if (!preference.mentionNotifications || !['internal', 'active', 'trial'].includes(workspace.accessState)) return { skipped: true as const }
    return { skipped: false as const, preference, comment, task, workspace }
  })
  if (context.skipped) return context
  const email = taskMentionEmail({
    locale: context.workspace.locale,
    displayName: context.preference.displayName,
    taskTitle: context.task.title,
    comment: context.comment.body,
    taskUrl: appTasksUrl(),
  })
  try {
    const providerMessageId = await sendEmail({
      to: decryptSecret(context.preference.encryptedEmail),
      subject: email.subject,
      html: email.html,
      idempotencyKey: `task-mention:${context.comment.id}:${context.preference.id}`,
    })
    await withSystemTransaction(async (db) => {
      await db.update(memberNotificationPreferences).set({ lastError: null, updatedAt: new Date() }).where(eq(memberNotificationPreferences.id, context.preference.id))
      await db.insert(auditEvents).values({
        workspaceId: context.workspace.id,
        actorUserId: 'system:task-notifications',
        action: 'task.mention_delivered',
        entityType: 'task_comment',
        entityId: context.comment.id,
        metadata: { taskId: context.task.id, recipientUserId: context.preference.authUserId, providerMessageId },
      })
    })
    return { delivered: true, providerMessageId }
  } catch (error) {
    await withSystemTransaction((db) => db.update(memberNotificationPreferences).set({
      lastError: (error instanceof Error ? error.message : String(error)).slice(0, 2000),
      updatedAt: new Date(),
    }).where(eq(memberNotificationPreferences.id, context.preference.id)))
    throw error
  }
}

export async function deliverPersonalTaskDigest(preferenceId: string, runKey: string) {
  const context = await withSystemTransaction(async (db) => {
    const preference = await db.query.memberNotificationPreferences.findFirst({ where: eq(memberNotificationPreferences.id, preferenceId) })
    if (!preference) throw new NonRetryableJobError('Préférence de digest introuvable.')
    const workspace = await db.query.workspaces.findFirst({ where: eq(workspaces.id, preference.workspaceId) })
    if (!workspace) throw new NonRetryableJobError('Workspace de digest introuvable.')
    if (preference.digestCadence === 'none' || !['internal', 'active', 'trial'].includes(workspace.accessState)) return { skipped: true as const }
    if (preference.lastDigestKey === runKey) return { skipped: true as const }
    const tasks = await db.query.workspaceTasks.findMany({
      where: and(
        eq(workspaceTasks.workspaceId, preference.workspaceId),
        eq(workspaceTasks.assignedTo, preference.authUserId),
        inArray(workspaceTasks.status, ['todo', 'in_progress', 'blocked']),
      ),
      orderBy: [workspaceTasks.dueAt, workspaceTasks.createdAt],
      limit: 50,
    })
    return { skipped: false as const, preference, workspace, tasks }
  })
  if (context.skipped) return context
  const now = new Date()
  if (context.tasks.length === 0) {
    await withSystemTransaction((db) => db.update(memberNotificationPreferences).set({
      lastDigestKey: runKey,
      lastDigestAt: now,
      lastError: null,
      updatedAt: now,
    }).where(eq(memberNotificationPreferences.id, context.preference.id)))
    return { delivered: false, empty: true }
  }
  const email = taskDigestEmail({
    locale: context.workspace.locale,
    displayName: context.preference.displayName,
    taskUrl: appTasksUrl(),
    tasks: context.tasks.map((task) => ({ title: task.title, status: task.status, dueAt: task.dueAt })),
  })
  try {
    const providerMessageId = await sendEmail({
      to: decryptSecret(context.preference.encryptedEmail),
      subject: email.subject,
      html: email.html,
      idempotencyKey: `task-digest:${context.preference.id}:${runKey}`,
    })
    await withSystemTransaction(async (db) => {
      await db.update(memberNotificationPreferences).set({
        lastDigestKey: runKey,
        lastDigestAt: now,
        lastError: null,
        updatedAt: now,
      }).where(eq(memberNotificationPreferences.id, context.preference.id))
      await db.insert(auditEvents).values({
        workspaceId: context.workspace.id,
        actorUserId: 'system:task-notifications',
        action: 'task.personal_digest_delivered',
        entityType: 'member_notification_preference',
        entityId: context.preference.id,
        metadata: { runKey, taskCount: context.tasks.length, providerMessageId },
      })
    })
    return { delivered: true, taskCount: context.tasks.length, providerMessageId }
  } catch (error) {
    await withSystemTransaction((db) => db.update(memberNotificationPreferences).set({
      lastError: (error instanceof Error ? error.message : String(error)).slice(0, 2000),
      updatedAt: new Date(),
    }).where(eq(memberNotificationPreferences.id, context.preference.id)))
    throw error
  }
}
