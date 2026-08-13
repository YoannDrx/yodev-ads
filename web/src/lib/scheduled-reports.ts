import 'server-only'

import { and, eq, isNull, lte, or } from 'drizzle-orm'
import {
  auditEvents,
  clients,
  reportSchedules,
  reportTemplates,
  shareLinks,
  workspaceDomains,
  workspaces,
} from '@/db/schema'
import { withSystemTransaction } from '@/db/transactions'
import { decryptSecret } from '@/lib/crypto'
import { NonRetryableJobError } from '@/lib/jobs'
import { scheduledReportEmail } from '@/lib/report-scheduling'
import { workspaceHasCapability } from '@/lib/entitlements'
import { sendTransactionalEmail } from '@/lib/transactional-email'

export async function deliverScheduledReport(scheduleId: string, runKey: string) {
  const context = await withSystemTransaction(async (db) => {
    const schedule = await db.query.reportSchedules.findFirst({ where: eq(reportSchedules.id, scheduleId) })
    if (!schedule) throw new NonRetryableJobError('Planification de rapport introuvable.')
    const workspace = await db.query.workspaces.findFirst({ where: eq(workspaces.id, schedule.workspaceId) })
    const client = await db.query.clients.findFirst({ where: and(eq(clients.id, schedule.clientId), eq(clients.workspaceId, schedule.workspaceId)) })
    const share = await db.query.shareLinks.findFirst({ where: and(eq(shareLinks.id, schedule.shareId), eq(shareLinks.workspaceId, schedule.workspaceId)) })
    const template = schedule.templateId
      ? await db.query.reportTemplates.findFirst({ where: and(eq(reportTemplates.id, schedule.templateId), eq(reportTemplates.workspaceId, schedule.workspaceId)) })
      : undefined
    const domain = await db.query.workspaceDomains.findFirst({
      where: and(
        eq(workspaceDomains.workspaceId, schedule.workspaceId),
        eq(workspaceDomains.verificationStatus, 'active'),
        isNull(workspaceDomains.revokedAt),
      ),
    })
    if (!workspace || !client || !share) throw new NonRetryableJobError('Contexte du rapport planifié incomplet.')
    if (!['internal', 'active', 'trial'].includes(workspace.accessState)) throw new NonRetryableJobError('Workspace non autorisé à envoyer des rapports.')
    if (!schedule.enabled || !share.active) return { skipped: true as const, reason: 'disabled' }
    if (schedule.lastRunKey === runKey) return { skipped: true as const, reason: 'already_delivered' }
    if (schedule.recipientEmails.length === 0) throw new NonRetryableJobError('Aucun destinataire configuré.')
    const now = new Date()
    const [claimedSchedule] = await db.update(reportSchedules).set({
      deliveryLeaseUntil: new Date(now.getTime() + 5 * 60_000),
      updatedAt: now,
    }).where(and(
      eq(reportSchedules.id, schedule.id),
      or(isNull(reportSchedules.deliveryLeaseUntil), lte(reportSchedules.deliveryLeaseUntil, now)),
    )).returning()
    if (!claimedSchedule) throw new Error('Un envoi de ce rapport est déjà en cours.')
    return { skipped: false as const, schedule: claimedSchedule, workspace, client, share, template, domain }
  })
  if (context.skipped) return context

  try {
    const now = new Date()
    const expiresAt = new Date(now.getTime() + 90 * 24 * 60 * 60_000)
    await withSystemTransaction(async (db) => {
    await db.update(shareLinks).set({
      editorialComment: context.template?.active ? context.template.editorialComment : context.share.editorialComment,
      actionPlan: context.template?.active ? context.template.actionPlan : context.share.actionPlan,
      locale: context.template?.active ? context.template.locale : context.share.locale,
      periodDays: context.template?.active ? context.template.periodDays : context.share.periodDays,
      expiresAt,
      updatedAt: now,
    }).where(and(eq(shareLinks.id, context.share.id), eq(shareLinks.workspaceId, context.workspace.id)))
  })

    const origin = context.domain && workspaceHasCapability(context.workspace.accessState, context.workspace.plan, 'custom_domain')
    ? `https://${context.domain.hostname}`
    : (process.env.NEXT_PUBLIC_APP_URL ?? 'https://ads.yodev.fr')
    const reportUrl = `${origin}/r/${decryptSecret(context.schedule.encryptedReportToken)}`
    const locale = (context.template?.active ? context.template.locale : context.share.locale) === 'en' ? 'en' : 'fr'
    const email = scheduledReportEmail({
    locale,
    brandName: context.workspace.brandName,
    reportName: context.schedule.name,
    clientName: context.client.name,
    reportUrl,
    })
    const idempotencyKey = `report-schedule:${context.schedule.id}:${runKey}`
    const result = await sendTransactionalEmail({
      from: process.env.REPORT_FROM_EMAIL ?? process.env.NOTIFICATION_FROM_EMAIL ?? 'Ads by Yodev <ads@yodev.fr>',
      to: context.schedule.recipientEmails,
      subject: email.subject,
      html: email.html,
      idempotencyKey,
      tag: 'scheduled_report',
    })
    await withSystemTransaction(async (db) => {
      await db.update(reportSchedules).set({
        lastRunKey: runKey,
        lastDeliveredAt: now,
        lastError: null,
        deliveryLeaseUntil: null,
        updatedAt: now,
      }).where(and(eq(reportSchedules.id, context.schedule.id), eq(reportSchedules.workspaceId, context.workspace.id)))
      await db.insert(auditEvents).values({
        workspaceId: context.workspace.id,
        actorUserId: 'system:report-scheduler',
        action: 'report.schedule_delivered',
        entityType: 'report_schedule',
        entityId: context.schedule.id,
        metadata: {
          runKey,
          shareId: context.share.id,
          recipientCount: context.schedule.recipientEmails.length,
          providerMessageId: result.providerMessageId,
        },
      })
    })
    return { delivered: true, recipientCount: context.schedule.recipientEmails.length, providerMessageId: result.providerMessageId }
  } catch (error) {
    await withSystemTransaction((db) => db.update(reportSchedules).set({
      lastError: (error instanceof Error ? error.message : String(error)).slice(0, 2000),
      deliveryLeaseUntil: null,
      updatedAt: new Date(),
    }).where(and(eq(reportSchedules.id, context.schedule.id), eq(reportSchedules.workspaceId, context.workspace.id))))
    throw error
  }
}
