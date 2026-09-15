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
    eq(jobs.attemptCount, job.attemptCount))).limit(1).for('update')
  if (!current) throw new Error('Report job lease lost')
  if (current.payload.scheduleId !== scheduleId || current.payload.runKey !== runKey) throw new NonRetryableJobError('Report job payload mismatch')
  await requireJobClock(db, current)
  return current
}

async function requireJobClock(db: DatabaseTransaction, job: ClaimedJob) {
  // Evaluate time in a separate statement after acquiring locks, never in their WHERE clause.
  const result = await db.execute<{ active: boolean }>(sql`select ${job.leaseExpiresAt?.toISOString() ?? null}::timestamptz > clock_timestamp() as active`)
  if (!result.rows[0]?.active) throw new Error('Report job lease lost')
}

async function requireWorkspaceClock(db: DatabaseTransaction, workspace: typeof workspaces.$inferSelect) {
  if (!workspaceHasCapability(workspace.accessState, workspace.plan, 'monitoring')) throw new NonRetryableJobError('Workspace non autorisé à envoyer des rapports.')
  if (workspace.accessState === 'trial' && workspace.trialEndsAt) {
    const result = await db.execute<{ active: boolean }>(sql`select ${workspace.trialEndsAt.toISOString()}::timestamptz > clock_timestamp() as active`)
    if (!result.rows[0]?.active) throw new NonRetryableJobError('Workspace non autorisé à envoyer des rapports.')
  }
}

async function requireDeliveryClock(db: DatabaseTransaction, schedule: typeof reportSchedules.$inferSelect, owner: string) {
  const result = await db.execute<{ active: boolean }>(sql`select ${schedule.deliveryLeaseUntil?.toISOString() ?? null}::timestamptz > clock_timestamp() as active`)
  if (schedule.deliveryLeaseOwner !== owner || !result.rows[0]?.active) throw new Error('Report delivery lease lost')
}

async function deliveryContext(db: DatabaseTransaction, job: ClaimedJob, scheduleId: string, runKey: string) {
  await lockWorkspaceAccessBoundary(db, job.workspaceId!)
  const [workspace] = await db.select().from(workspaces).where(eq(workspaces.id, job.workspaceId!)).limit(1).for('share')
  const [schedule] = await db.select().from(reportSchedules).where(and(eq(reportSchedules.id, scheduleId), eq(reportSchedules.workspaceId, job.workspaceId!))).limit(1).for('update')
  if (!schedule) throw new NonRetryableJobError('Planification de rapport introuvable.')
  const currentJob = await fenceJob(db, job, scheduleId, runKey)
  const [client] = await db.select().from(clients).where(and(eq(clients.id, schedule.clientId), eq(clients.workspaceId, schedule.workspaceId))).limit(1).for('share')
  const [share] = await db.select().from(shareLinks).where(and(eq(shareLinks.id, schedule.shareId), eq(shareLinks.workspaceId, schedule.workspaceId))).limit(1).for('share')
  if (!workspace || !client || !share || share.clientId !== client.id) throw new NonRetryableJobError('Contexte du rapport planifié incomplet.')
  await requireJobClock(db, currentJob)
  await requireWorkspaceClock(db, workspace)
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
    if (schedule.deliveryLeaseUntil) {
      const lease = await db.execute<{ active: boolean }>(sql`select ${schedule.deliveryLeaseUntil.toISOString()}::timestamptz > clock_timestamp() as active`)
      if (!lease.rows[0] || lease.rows[0].active) throw new Error('Un envoi de ce rapport est déjà en cours.')
    }
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
    await db.update(reportSchedules).set({ deliveryLeaseOwner: owner, deliveryLeaseUntil: sql`clock_timestamp() + interval '5 minutes'`, updatedAt: new Date() }).where(and(eq(reportSchedules.id, schedule.id), eq(reportSchedules.workspaceId, workspace.id)))
    await requireJobClock(db, currentJob)
    await requireWorkspaceClock(db, workspace)
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
  const admit = (beforeSubmit = false) => withSystemTransaction(async (db) => {
    const { schedule, share, client, workspace, currentJob } = await deliveryContext(db, job, scheduleId, runKey)
    if (!schedule.enabled || !share.active || !client.active || client.isManager || share.tokenHash !== prepared.issued.edition.deliveryTokenHash) throw new NonRetryableJobError('Le rapport a été désactivé ou révoqué avant envoi.')
    // An accepted ledger entry must still reconcile its original payload. Only a new submission checks recipients.
    if (beforeSubmit) {
      const recipients = new Set(schedule.recipientEmails.map((email) => email.trim().toLowerCase()))
      if (!prepared.delivery.to.every((email) => recipients.has(email.trim().toLowerCase()))) return false
    }
    const expiry = await db.execute<{ active: boolean }>(sql`select ${share.expiresAt?.toISOString() ?? null}::timestamptz > clock_timestamp()
      and ${prepared.issued.edition.expiresAt.toISOString()}::timestamptz > clock_timestamp() as active`)
    if (!expiry.rows[0]?.active) throw new NonRetryableJobError('Le rapport a expiré avant envoi.')
    await requireDeliveryClock(db, schedule, owner)
    await requireJobClock(db, currentJob)
    await requireWorkspaceClock(db, workspace)
    if (!featureEnabled('notifications')) throw new Error('Les envois de notifications sont désactivés.')
    return true
  })
  try {
    // Admission is repeated after preparing the edition. A stale worker cannot send a replaced or revoked capability.
    await admit()
    const result = await sendTransactionalEmail({ ...prepared.delivery, idempotencyKey: `report-schedule:${scheduleId}:${runKey}`, category: 'scheduled_report', workspaceId: job.workspaceId, referenceId: `${scheduleId}:${runKey}`,
      beforeSubmit: () => admit(true).catch((error) => { if (error instanceof NonRetryableJobError) return false; throw error }),
    })
    await withSystemTransaction(async (db) => {
      await lockWorkspaceAccessBoundary(db, job.workspaceId!)
      const [schedule] = await db.select().from(reportSchedules).where(ownedSchedule).limit(1).for('update')
      if (!schedule) throw new Error('Report delivery lease lost after transport acceptance')
      const currentJob = await fenceJob(db, job, scheduleId, runKey)
      await requireDeliveryClock(db, schedule, owner)
      const now = new Date()
      const [updated] = await db.update(reportSchedules).set({ lastRunKey: runKey, lastDeliveredAt: now, lastError: null, deliveryLeaseUntil: null, deliveryLeaseOwner: null, updatedAt: now })
        .where(and(ownedSchedule, sql`${reportSchedules.deliveryLeaseUntil} > clock_timestamp()`)).returning({ id: reportSchedules.id })
      if (!updated) throw new Error('Report delivery lease lost after transport acceptance')
      await db.insert(auditEvents).values({ workspaceId: job.workspaceId!, actorUserId: 'system:report-scheduler', action: 'report.schedule_delivered', entityType: 'report_schedule', entityId: scheduleId,
        metadata: { runKey, shareId: prepared.issued.edition.shareId, editionId: prepared.issued.edition.id, sourceVersion: prepared.issued.edition.sourceVersion, recipientCount: prepared.delivery.to.length, providerMessageId: result.providerMessageId } })
      await requireJobClock(db, currentJob)
      await requireDeliveryClock(db, schedule, owner)
    })
    return { delivered: true, recipientCount: prepared.delivery.to.length, providerMessageId: result.providerMessageId }
  } catch (error) {
    // Keep the original immutable payload for provider idempotency. Never clear a successor's lease or expose SQL/recipient secrets.
    await withSystemTransaction((db) => db.update(reportSchedules).set({ lastError: 'Envoi non finalisé. La même édition sera utilisée lors de la reprise.', deliveryLeaseUntil: null, deliveryLeaseOwner: null, updatedAt: new Date() }).where(ownedSchedule))
    throw error
  }
}
