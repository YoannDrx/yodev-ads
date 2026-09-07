import 'server-only'

import { and, eq, inArray } from 'drizzle-orm'
import {
  auditEvents,
  memberNotificationPreferences,
  taskComments,
  workspaceTasks,
} from '@/db/schema'
import { withSystemTransaction } from '@/db/transactions'
import { NonRetryableJobError, type ClaimedJob } from '@/lib/jobs'
import { taskNotificationRecipient } from '@/lib/task-notification-recipient'
import { taskDigestEmail, taskMentionEmail } from '@/lib/task-notification-model'
import { sendTransactionalEmail, TransactionalEmailAdmissionError } from '@/lib/transactional-email'

function appTasksUrl() {
  return `${process.env.NEXT_PUBLIC_APP_URL ?? 'https://ads.yodev.fr'}/tasks`
}

async function sendEmail(input: { to: string; subject: string; html: string; idempotencyKey: string; workspaceId: string; referenceId: string; beforeSubmit: () => Promise<boolean> }) {
  const result = await sendTransactionalEmail({
    from: process.env.TASK_FROM_EMAIL ?? process.env.NOTIFICATION_FROM_EMAIL ?? 'Ads by Yodev <ads@yodev.fr>',
    to: input.to,
    subject: input.subject,
    html: input.html,
    idempotencyKey: input.idempotencyKey,
    category: input.idempotencyKey.startsWith('task-mention:') ? 'task_mention' : 'task_digest',
    workspaceId: input.workspaceId,
    referenceId: input.referenceId,
    beforeSubmit: input.beforeSubmit,
  })
  return result.providerMessageId
}

export async function deliverTaskMention(commentId: string, preferenceId: string, job?: ClaimedJob) {
  if (job && (job.type !== 'task.mention_deliver' || job.payload.commentId !== commentId)) throw new NonRetryableJobError('Task mention job payload mismatch')
  const context = await withSystemTransaction(async (db) => {
    const recipient = await taskNotificationRecipient(db, preferenceId, job)
    if (!recipient) return { skipped: true as const }
    const { preference, workspace } = recipient
    const comment = await db.query.taskComments.findFirst({ where: eq(taskComments.id, commentId) })
    if (!preference || !comment || preference.workspaceId !== comment.workspaceId) throw new NonRetryableJobError('Mention ou destinataire introuvable.')
    const task = await db.query.workspaceTasks.findFirst({ where: and(eq(workspaceTasks.id, comment.taskId), eq(workspaceTasks.workspaceId, comment.workspaceId)) })
    if (!task || !workspace) throw new NonRetryableJobError('Contexte de mention incomplet.')
    if (!preference.mentionNotifications || !['internal', 'active', 'trial'].includes(workspace.accessState)) return { skipped: true as const }
    return { skipped: false as const, preference, comment, task, workspace, email: recipient.email, name: recipient.user.name }
  })
  if (context.skipped) return context
  const email = taskMentionEmail({
    locale: context.workspace.locale,
    displayName: context.name || context.preference.displayName,
    taskTitle: context.task.title,
    comment: context.comment.body,
    taskUrl: appTasksUrl(),
  })
  try {
    const providerMessageId = await sendEmail({
      to: context.email,
      subject: email.subject,
      html: email.html,
      idempotencyKey: `task-mention:${context.comment.id}:${context.preference.id}`,
      workspaceId: context.workspace.id,
      referenceId: context.comment.id,
      beforeSubmit: () => withSystemTransaction(async (db) => {
        const current = await taskNotificationRecipient(db, preferenceId, job)
        if (!current || !current.preference.mentionNotifications || current.email !== context.email) return false
        const comment = await db.query.taskComments.findFirst({ where: and(eq(taskComments.id, commentId), eq(taskComments.workspaceId, context.workspace.id)) })
        return comment?.body === context.comment.body && comment?.taskId === context.task.id
      }),
    })
    await withSystemTransaction(async (db) => {
      await db.update(memberNotificationPreferences).set({ lastError: null, updatedAt: new Date() }).where(eq(memberNotificationPreferences.id, context.preference.id))
      await db.insert(auditEvents).values({
        workspaceId: context.workspace.id,
        actorUserId: 'system:task-notifications',
        action: 'task.mention_accepted',
        entityType: 'task_comment',
        entityId: context.comment.id,
        metadata: { taskId: context.task.id, recipientUserId: context.preference.authUserId, providerMessageId },
      })
    })
    return { accepted: true, providerMessageId }
  } catch (error) {
    if (error instanceof TransactionalEmailAdmissionError) return { skipped: true as const }
    await withSystemTransaction((db) => db.update(memberNotificationPreferences).set({
      lastError: (error instanceof Error ? error.message : String(error)).slice(0, 2000),
      updatedAt: new Date(),
    }).where(eq(memberNotificationPreferences.id, context.preference.id)))
    throw error
  }
}

export async function deliverPersonalTaskDigest(preferenceId: string, runKey: string, job?: ClaimedJob) {
  if (job && (job.type !== 'task.personal_digest' || job.payload.runKey !== runKey)) throw new NonRetryableJobError('Task digest job payload mismatch')
  const context = await withSystemTransaction(async (db) => {
    const recipient = await taskNotificationRecipient(db, preferenceId, job)
    if (!recipient) return { skipped: true as const }
    const { preference, workspace } = recipient
    if (preference.digestCadence === 'none' || !['internal', 'active', 'trial'].includes(workspace.accessState)) return { skipped: true as const }
    if (!runKey.startsWith(`${preference.digestCadence}:`)) return { skipped: true as const }
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
    return { skipped: false as const, preference, workspace, tasks, email: recipient.email, name: recipient.user.name }
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
    displayName: context.name || context.preference.displayName,
    taskUrl: appTasksUrl(),
    tasks: context.tasks.map((task) => ({ title: task.title, status: task.status, dueAt: task.dueAt })),
  })
  try {
    const providerMessageId = await sendEmail({
      to: context.email,
      subject: email.subject,
      html: email.html,
      idempotencyKey: `task-digest:${context.preference.id}:${runKey}`,
      workspaceId: context.workspace.id,
      referenceId: runKey,
      beforeSubmit: () => withSystemTransaction(async (db) => {
        const current = await taskNotificationRecipient(db, preferenceId, job)
        return Boolean(current && current.email === context.email && current.preference.digestCadence === context.preference.digestCadence
          && current.preference.digestHour === context.preference.digestHour && current.preference.timezone === context.preference.timezone
          && current.preference.lastDigestKey !== runKey)
      }),
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
        action: 'task.personal_digest_accepted',
        entityType: 'member_notification_preference',
        entityId: context.preference.id,
        metadata: { runKey, taskCount: context.tasks.length, providerMessageId },
      })
    })
    return { accepted: true, taskCount: context.tasks.length, providerMessageId }
  } catch (error) {
    if (error instanceof TransactionalEmailAdmissionError) return { skipped: true as const }
    await withSystemTransaction((db) => db.update(memberNotificationPreferences).set({
      lastError: (error instanceof Error ? error.message : String(error)).slice(0, 2000),
      updatedAt: new Date(),
    }).where(eq(memberNotificationPreferences.id, context.preference.id)))
    throw error
  }
}
