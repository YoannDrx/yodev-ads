import 'server-only'

import { randomUUID } from 'node:crypto'
import { and, eq, isNull, or, sql } from 'drizzle-orm'
import { z } from 'zod'
import { auditEvents, clients, jobs, reportSchedules, reportTemplates, shareLinks, workspaceDomains, workspaces } from '@/db/schema'
import { withSystemTransaction, type DatabaseTransaction } from '@/db/transactions'
import { decryptSecret } from '@/lib/crypto'
import { NonRetryableJobError, type ClaimedJob } from '@/lib/jobs'
import { scheduledReportEmail } from '@/lib/report-scheduling'
import { workspaceHasCapability } from '@/lib/entitlements'
import { sendTransactionalEmail } from '@/lib/transactional-email'
import { createReportEditionInTransaction, ReportDataUnavailable } from '@/lib/report-editions'
import { lockWorkspaceAccessBoundary } from '@/lib/workspace-transaction-guard'
import { featureEnabled } from '@/lib/feature-flags'
import { hashToken } from '@/lib/tokens'

const deliverySchema = z.object({ from: z.string().min(1), to: z.array(z.string().email()).min(1).max(20), subject: z.string(), html: z.string() }).strict()
const runKeySchema = z.string().regex(/^(weekly|monthly):\d{4}-\d{2}-\d{2}$/)

async function fenceJob(db: DatabaseTransaction, job: ClaimedJob, scheduleId: string, runKey: string) {
  const [current] = await db.select().from(jobs).where(and(eq(jobs.id, job.id), eq(jobs.workspaceId, job.workspaceId!),
    eq(jobs.type, 'report.schedule_deliver'), eq(jobs.status, 'running'), eq(jobs.leaseOwner, job.leaseOwner!),
    eq(jobs.attemptCount, job.attemptCount), sql`${jobs.leaseExpiresAt} > clock_timestamp()`)).limit(1).for('update')
  if (!current) throw new Error('Report job lease lost')
  if (current.payload.scheduleId !== scheduleId || current.payload.runKey !== runKey) throw new NonRetryableJobError('Report job payload mismatch')
  return current
}

async function deliveryContext(db: DatabaseTransaction, job: ClaimedJob, scheduleId: string, runKey: string) {
  await lockWorkspaceAccessBoundary(db, job.workspaceId!)
  const [schedule] = await db.select().from(reportSchedules).where(and(eq(reportSchedules.id, scheduleId), eq(reportSchedules.workspaceId, job.workspaceId!))).limit(1).for('update')
  if (!schedule) throw new NonRetryableJobError('Planification de rapport introuvable.')
  const currentJob = await fenceJob(db, job, scheduleId, runKey)
  const workspace = await db.query.workspaces.findFirst({ where: eq(workspaces.id, schedule.workspaceId) })
  const client = await db.query.clients.findFirst({ where: and(eq(clients.id, schedule.clientId), eq(clients.workspaceId, schedule.workspaceId)) })
  const share = await db.query.shareLinks.findFirst({ where: and(eq(shareLinks.id, schedule.shareId), eq(shareLinks.workspaceId, schedule.workspaceId)) })
  if (!workspace || !client || !share || share.clientId !== client.id) throw new NonRetryableJobError('Contexte du rapport planifié incomplet.')
  if (!['internal', 'active', 'trial'].includes(workspace.accessState)) throw new NonRetryableJobError('Workspace non autorisé à envoyer des rapports.')
  return { schedule, currentJob, workspace, client, share }
}

export async function deliverScheduledReport(scheduleId: string, runKey: string, job: ClaimedJob) {
  runKeySchema.parse(runKey)
  if (!job.workspaceId || !job.leaseOwner || job.type !== 'report.schedule_deliver') throw new NonRetryableJobError('Report job workspace or owner missing')
  if (!featureEnabled('notifications')) throw new Error('Les envois de notifications sont désactivés.')
  const owner = randomUUID()
  // Publication and ownership are atomic. Failure to qualify history leaves no lease or half-edition behind.
  const prepared = await withSystemTransaction(async (db) => {
    const context = await deliveryContext(db, job, scheduleId, runKey)
    const { schedule, workspace, client, share, currentJob } = context
    if (!client.active || client.isManager) return { skipped: true as const, reason: 'account_inactive' }
    if (!schedule.enabled || !share.active) return { skipped: true as const, reason: 'disabled' }
    if (schedule.lastRunKey === runKey) return { skipped: true as const, reason: 'already_delivered' }
    const now = new Date()
    if (schedule.deliveryLeaseUntil && schedule.deliveryLeaseUntil > now) throw new Error('Un envoi de ce rapport est déjà en cours.')
    const template = schedule.templateId ? await db.query.reportTemplates.findFirst({ where: and(eq(reportTemplates.id, schedule.templateId), eq(reportTemplates.workspaceId, workspace.id), eq(reportTemplates.active, true)) }) : undefined
    const domain = workspaceHasCapability(workspace.accessState, workspace.plan, 'custom_domain') ? await db.query.workspaceDomains.findFirst({ where: and(eq(workspaceDomains.workspaceId, workspace.id), eq(workspaceDomains.verificationStatus, 'active'), isNull(workspaceDomains.revokedAt)) }) : undefined
    const origin = domain ? `https://${domain.hostname}` : (process.env.NEXT_PUBLIC_APP_URL ?? 'https://ads.yodev.fr')
    const token = decryptSecret(schedule.encryptedReportToken)
    if (hashToken(token) !== share.tokenHash) throw new NonRetryableJobError('Le lien du rapport a changé. Vérifiez la planification.')
    const issued = await createReportEditionInTransaction(db, { workspaceId: workspace.id, shareId: share.id, actorUserId: 'system:report-scheduler', kind: 'scheduled',
      now, anchorAt: currentJob.createdAt, periodSource: template ?? share,
      editorial: { locale: template?.locale ?? share.locale, editorialComment: template ? template.editorialComment : share.editorialComment, actionPlan: template ? template.actionPlan : share.actionPlan },
      delivery: { scheduleId, runKey, tokenHash: share.tokenHash, build: (editionId, model) => {
        const email = scheduledReportEmail({ locale: model.locale, brandName: model.brandName, reportName: schedule.name, clientName: model.clientName,
          reportUrl: `${origin}/r/${token}?edition=${editionId}`, edition: { ...model.window!, generatedAt: model.generatedAt.toISOString(), sourceVersion: model.sourceVersion! } })
        return deliverySchema.parse({ from: process.env.REPORT_FROM_EMAIL ?? process.env.NOTIFICATION_FROM_EMAIL ?? 'Ads by Yodev <ads@yodev.fr>', to: schedule.recipientEmails, ...email })
      } },
    })
    if (!issued.edition.encryptedDelivery || issued.edition.deliveryTokenHash !== share.tokenHash) throw new NonRetryableJobError('Le lien de cette édition a été révoqué. Aucun nouvel envoi automatique.')
    const delivery = deliverySchema.parse(JSON.parse(decryptSecret(issued.edition.encryptedDelivery)))
    await db.update(shareLinks).set({ expiresAt: new Date(Math.max(share.expiresAt?.getTime() ?? 0, issued.edition.expiresAt.getTime())), updatedAt: now }).where(and(eq(shareLinks.id, share.id), eq(shareLinks.workspaceId, workspace.id)))
    await db.update(reportSchedules).set({ deliveryLeaseOwner: owner, deliveryLeaseUntil: new Date(now.getTime() + 5 * 60_000), updatedAt: now }).where(and(eq(reportSchedules.id, schedule.id), eq(reportSchedules.workspaceId, workspace.id)))
    return { skipped: false as const, issued, delivery }
  }).catch(async (error) => {
    if (error instanceof ReportDataUnavailable) {
      await withSystemTransaction((db) => db.update(reportSchedules).set({ lastError: error.message, updatedAt: new Date() }).where(and(
        eq(reportSchedules.id, scheduleId), eq(reportSchedules.workspaceId, job.workspaceId!),
        or(isNull(reportSchedules.deliveryLeaseUntil), sql`${reportSchedules.deliveryLeaseUntil} <= clock_timestamp()`),
      )))
    }
    throw error
  })
  if (prepared.skipped) return prepared

  const ownedSchedule = and(eq(reportSchedules.id, scheduleId), eq(reportSchedules.workspaceId, job.workspaceId), eq(reportSchedules.deliveryLeaseOwner, owner))
  try {
    // Admission is repeated after preparing the edition. A stale worker cannot send a replaced or revoked capability.
    await withSystemTransaction(async (db) => {
      const { schedule, share, client } = await deliveryContext(db, job, scheduleId, runKey)
      const now = new Date()
      if (schedule.deliveryLeaseOwner !== owner || !schedule.deliveryLeaseUntil || schedule.deliveryLeaseUntil <= now) throw new Error('Report delivery lease lost')
      if (!schedule.enabled || !share.active || !client.active || client.isManager || share.tokenHash !== prepared.issued.edition.deliveryTokenHash || !share.expiresAt || share.expiresAt <= now || prepared.issued.edition.expiresAt <= now) throw new NonRetryableJobError('Le rapport a été désactivé ou révoqué avant envoi.')
      if (!featureEnabled('notifications')) throw new Error('Les envois de notifications sont désactivés.')
    })
    const result = await sendTransactionalEmail({ ...prepared.delivery, idempotencyKey: `report-schedule:${scheduleId}:${runKey}`, category: 'scheduled_report', workspaceId: job.workspaceId, referenceId: `${scheduleId}:${runKey}` })
    await withSystemTransaction(async (db) => {
      await lockWorkspaceAccessBoundary(db, job.workspaceId!)
      await fenceJob(db, job, scheduleId, runKey)
      const now = new Date()
      const [updated] = await db.update(reportSchedules).set({ lastRunKey: runKey, lastDeliveredAt: now, lastError: null, deliveryLeaseUntil: null, deliveryLeaseOwner: null, updatedAt: now })
        .where(and(ownedSchedule, sql`${reportSchedules.deliveryLeaseUntil} > clock_timestamp()`)).returning({ id: reportSchedules.id })
      if (!updated) throw new Error('Report delivery lease lost after transport acceptance')
      await db.insert(auditEvents).values({ workspaceId: job.workspaceId!, actorUserId: 'system:report-scheduler', action: 'report.schedule_delivered', entityType: 'report_schedule', entityId: scheduleId,
        metadata: { runKey, shareId: prepared.issued.edition.shareId, editionId: prepared.issued.edition.id, sourceVersion: prepared.issued.edition.sourceVersion, recipientCount: prepared.delivery.to.length, providerMessageId: result.providerMessageId } })
    })
    return { delivered: true, recipientCount: prepared.delivery.to.length, providerMessageId: result.providerMessageId }
  } catch (error) {
    // Keep the original immutable payload for provider idempotency. Never clear a successor's lease or expose SQL/recipient secrets.
    await withSystemTransaction((db) => db.update(reportSchedules).set({ lastError: 'Envoi non finalisé. La même édition sera utilisée lors de la reprise.', deliveryLeaseUntil: null, deliveryLeaseOwner: null, updatedAt: new Date() }).where(ownedSchedule))
    throw error
  }
}
