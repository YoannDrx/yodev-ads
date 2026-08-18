import 'server-only'

import { and, eq, gte, inArray, isNotNull, lt, or } from 'drizzle-orm'
import { z } from 'zod'
import {
  alertIncidents,
  approvalRequests,
  auditEvents,
  clients,
  dailyAccountMetrics,
  dailyCampaignMetrics,
  googleAdsConnections,
  googleChangeEvents,
  conversionActionSnapshots,
  jobs,
  mutationExecutions,
  notificationDeliveries,
  notificationOAuthSessions,
  offlineConversionDiagnostics,
  performanceSnapshots,
  rateLimitBuckets,
  secretRevelations,
  shareLinks,
  transactionalEmailDeliveries,
  workspaces,
  yodevMailEvents,
} from '@/db/schema'
import { withSystemTransaction } from '@/db/transactions'
import { dispatchIncidentNotifications, dispatchWeeklyDigest, retryNotificationDelivery } from '@/lib/notifications'
import {
  claimNextJob,
  completeJob,
  enqueueJob,
  failJob,
  NOTIFICATION_JOB_TYPES,
  NonRetryableJobError,
  type ClaimedJob,
} from '@/lib/jobs'
import { reconcileGoogleMutation } from '@/lib/reconcile-google-mutation'
import { runWorkspaceMonitoring } from '@/lib/run-monitoring'
import {
  purgeWorkspace,
  recordWorkspaceDeletionStripeCancellation,
  revokeWorkspaceGoogleConnection,
  runWorkspaceExternalCleanup,
} from '@/lib/workspace-deletion'
import { accountLimitForPlan, getStripe } from '@/lib/billing'
import { GoogleAdsGateway } from '@/lib/google-ads'
import { pacingCalendar } from '@/lib/pacing'
import { deleteExpiredExportArtifacts, runWorkspaceExport } from '@/lib/workspace-export'
import { featureEnabled } from '@/lib/feature-flags'
import { deliverScheduledReport } from '@/lib/scheduled-reports'
import { deliverPersonalTaskDigest, deliverTaskMention } from '@/lib/task-notifications'
import { deliverLifecycleEmail } from '@/lib/lifecycle-emails'
import { LIFECYCLE_EMAIL_KINDS } from '@/lib/lifecycle-email-model'
import { deliverSupportEmail } from '@/lib/support-notifications'
import { SUPPORT_EMAIL_KINDS } from '@/lib/support-email-model'
import { deliverSubprocessorChangeNotice, fanOutSubprocessorChangeNotice } from '@/lib/subprocessor-change-notifications'
import { deliverOperationsAlert } from '@/lib/operations-alerts'
import { OPERATIONS_ALERT_KINDS, operationsAlertJobForDeadLetter } from '@/lib/operations-alert-model'
import { redactSensitiveData } from '@/lib/sentry-redaction'
import { completeMutationObservation } from '@/lib/mutation-observations'
import { currentEncryptionKeyId } from '@/lib/crypto'
import { rotateWorkspaceSecrets } from '@/lib/secret-rotation'
import { persistSystemGoogleAccountInventory } from '@/lib/google-account-sync'
import { deliverAuthInvitation } from '@/lib/auth-invitations'
import { deliverQueuedAuthEmail } from '@/lib/auth-emails'
import { reconcileStripeWorkspace } from '@/lib/stripe-reconciliation'
import { runWithTransactionalEmailRetryGeneration } from '@/lib/transactional-email-context'
import { completeOperationalRun, failOperationalRun, startOperationalRun } from '@/lib/operational-runs'
import { RETENTION_POLICY, retentionCutoff } from '@/lib/retention-policy'

const workspacePayload = z.object({ workspaceId: z.string().uuid() })
const authInvitationPayload = z.object({ invitationId: z.string().uuid(), workspaceId: z.string().uuid() })
const authEmailPayload = z.object({ envelope: z.string().min(1).max(50_000) }).strict()
const approvalPayload = z.object({ approvalId: z.string().uuid() })
const mutationObservationPayload = z.object({ observationId: z.string().uuid() })
const notificationPayload = z.object({ deliveryId: z.string().uuid() })
const stripeSubscriptionPayload = z.object({ subscriptionId: z.string().min(3) })
const deletionStripeSubscriptionPayload = stripeSubscriptionPayload.extend({ workspaceId: z.string().uuid().optional() })
const externalCleanupPayload = z.object({
  workspaceHash: z.string().regex(/^[a-f0-9]{64}$/),
  logoUrl: z.string().url().nullable(),
  hostnames: z.array(z.string().min(1).max(253)).max(100),
})
const metricsPayload = z.object({ workspaceId: z.string().uuid(), clientId: z.string().uuid() })
const exportPayload = z.object({ workspaceId: z.string().uuid(), exportJobId: z.string().uuid() })
const scheduledReportPayload = z.object({ scheduleId: z.string().uuid(), runKey: z.string().min(10).max(32) })
const taskMentionPayload = z.object({ commentId: z.string().uuid(), preferenceId: z.string().uuid() })
const taskDigestPayload = z.object({ preferenceId: z.string().uuid(), runKey: z.string().min(10).max(32) })
const lifecycleEmailPayload = z.object({
  workspaceId: z.string().uuid(),
  kind: z.enum(LIFECYCLE_EMAIL_KINDS),
  referenceKey: z.string().min(1).max(120),
  effectiveAt: z.string().datetime().nullable().optional(),
})
const supportEmailPayload = z.object({
  ticketId: z.string().uuid(),
  kind: z.enum(SUPPORT_EMAIL_KINDS),
  referenceKey: z.string().min(1).max(120),
  messageId: z.string().uuid().nullable().optional(),
})
const subprocessorFanoutPayload = z.object({ noticeId: z.string().uuid() })
const subprocessorDeliveryPayload = z.object({ noticeId: z.string().uuid(), workspaceId: z.string().uuid() })
const operationsAlertPayload = z.object({
  kind: z.enum(OPERATIONS_ALERT_KINDS),
  sourceId: z.string().min(1).max(128),
  title: z.string().min(1).max(220),
  description: z.string().min(1).max(2000),
})
const secretRotationPayload = z.object({ workspaceId: z.string().uuid(), targetKid: z.string().min(1).max(128) })

function safeOperationalError(error: unknown) {
  const raw = error instanceof Error ? error.message : String(error)
  return String(redactSensitiveData(raw)).slice(0, 2000) || 'Erreur sans message.'
}

export { localScheduleParts, seedScheduledJobs } from '@/lib/job-scheduler'
import { localScheduleParts } from '@/lib/job-scheduler'

async function executeJob(job: ClaimedJob) {
  switch (job.type) {
    case 'auth.email_deliver':
      return deliverQueuedAuthEmail(authEmailPayload.parse(job.payload))
    case 'auth.invitation_deliver':
      return deliverAuthInvitation(authInvitationPayload.parse(job.payload))
    case 'monitoring.scan': {
      const { workspaceId } = workspacePayload.parse(job.payload)
      return runWorkspaceMonitoring(workspaceId)
    }
    case 'monitoring.weekly_digest': {
      const { workspaceId } = workspacePayload.parse(job.payload)
      return dispatchWeeklyDigest(workspaceId)
    }
    case 'report.schedule_deliver': {
      const { scheduleId, runKey } = scheduledReportPayload.parse(job.payload)
      return deliverScheduledReport(scheduleId, runKey)
    }
    case 'task.mention_deliver': {
      const { commentId, preferenceId } = taskMentionPayload.parse(job.payload)
      return deliverTaskMention(commentId, preferenceId)
    }
    case 'task.personal_digest': {
      const { preferenceId, runKey } = taskDigestPayload.parse(job.payload)
      return deliverPersonalTaskDigest(preferenceId, runKey)
    }
    case 'lifecycle.email': {
      const payload = lifecycleEmailPayload.parse(job.payload)
      return deliverLifecycleEmail({
        workspaceId: payload.workspaceId,
        kind: payload.kind,
        referenceKey: payload.referenceKey,
        effectiveAt: payload.effectiveAt ? new Date(payload.effectiveAt) : null,
      })
    }
    case 'support.email': {
      const payload = supportEmailPayload.parse(job.payload)
      return deliverSupportEmail(payload)
    }
    case 'subprocessor.notice_fanout': {
      const { noticeId } = subprocessorFanoutPayload.parse(job.payload)
      return fanOutSubprocessorChangeNotice(noticeId)
    }
    case 'subprocessor.notice_deliver': {
      return deliverSubprocessorChangeNotice(subprocessorDeliveryPayload.parse(job.payload))
    }
    case 'operations.alert': {
      return deliverOperationsAlert(operationsAlertPayload.parse(job.payload))
    }
    case 'google.mutation.reconcile': {
      const { approvalId } = approvalPayload.parse(job.payload)
      return reconcileGoogleMutation(approvalId)
    }
    case 'mutation.observe': {
      const { observationId } = mutationObservationPayload.parse(job.payload)
      return completeMutationObservation(observationId)
    }
    case 'notification.deliver': {
      const { deliveryId } = notificationPayload.parse(job.payload)
      const result = await retryNotificationDelivery(deliveryId)
      if (result === 'dead_letter') throw new NonRetryableJobError('Notification delivery reached dead-letter')
      if (result === 'retrying') throw new Error('Notification delivery failed and is scheduled for retry')
      return result
    }
    case 'workspace.purge': {
      const { workspaceId } = workspacePayload.parse(job.payload)
      return purgeWorkspace(workspaceId)
    }
    case 'workspace.external_cleanup':
      return runWorkspaceExternalCleanup(externalCleanupPayload.parse(job.payload))
    case 'google.revoke_connection': {
      const { workspaceId } = workspacePayload.parse(job.payload)
      return revokeWorkspaceGoogleConnection(workspaceId)
    }
    case 'workspace.export': {
      const { workspaceId, exportJobId } = exportPayload.parse(job.payload)
      return runWorkspaceExport(exportJobId, workspaceId)
    }
    case 'stripe.cancel_subscription': {
      const { subscriptionId, workspaceId } = deletionStripeSubscriptionPayload.parse(job.payload)
      try {
        const subscription = await getStripe().subscriptions.update(subscriptionId, { cancel_at_period_end: true })
        if (subscription.status !== 'canceled' && !subscription.cancel_at_period_end) {
          throw new Error('Stripe did not confirm cancellation at period end')
        }
        if (workspaceId) {
          await recordWorkspaceDeletionStripeCancellation({ workspaceId, subscriptionId, state: 'confirmed' })
        }
      } catch (error) {
        if (workspaceId) {
          await recordWorkspaceDeletionStripeCancellation({ workspaceId, subscriptionId, state: 'failed', error })
        }
        throw error
      }
      return { cancelledAtPeriodEnd: true }
    }
    case 'stripe.reconcile': {
      const payload = workspacePayload.parse(job.payload)
      return reconcileStripeWorkspace(payload.workspaceId, getStripe())
    }
    case 'secrets.rotate': {
      const payload = secretRotationPayload.parse(job.payload)
      if (currentEncryptionKeyId() !== payload.targetKid) {
        return { workspaceId: payload.workspaceId, targetKid: payload.targetKid, rotated: 0, skipped: 'stale_target' as const }
      }
      return rotateWorkspaceSecrets(payload.workspaceId)
    }
    case 'google.accounts_sync': {
      const { workspaceId } = workspacePayload.parse(job.payload)
      const context = await withSystemTransaction(async (db) => {
        const [workspace] = await db.select({ plan: workspaces.plan, accessState: workspaces.accessState })
          .from(workspaces)
          .where(eq(workspaces.id, workspaceId))
          .limit(1)
        const [connection] = await db.select().from(googleAdsConnections)
          .where(and(eq(googleAdsConnections.workspaceId, workspaceId), eq(googleAdsConnections.status, 'active')))
          .limit(1)
        if (!workspace || !connection || !['internal', 'active'].includes(workspace.accessState)) {
          throw new NonRetryableJobError('Google account sync workspace or connection unavailable')
        }
        return { workspace, connection }
      })
      const managedCustomers = await new GoogleAdsGateway(context.connection).listManagedCustomers()
      const limit = context.workspace.plan === 'internal' ? null : accountLimitForPlan(context.workspace.plan)
      const { included, excluded } = await persistSystemGoogleAccountInventory({
        workspaceId,
        actorUserId: 'system:billing-account-sync',
        connectionId: context.connection.id,
        managedCustomers,
        advertiserLimit: limit,
        plan: context.workspace.plan,
        action: 'google_ads.accounts_synced_after_plan_change',
        recordActivation: false,
      })
      return { accessibleCount: managedCustomers.length, activeCount: included.length, excludedCount: excluded.length, limit }
    }
    case 'google.read_drill': {
      const payload = metricsPayload.parse(job.payload)
      const context = await googleSyncContext(payload.workspaceId, payload.clientId)
      const gateway = new GoogleAdsGateway(context.connection)
      await gateway.verifyOAuthAccess()
      const managed = await gateway.listManagedCustomers()
      const campaigns = await gateway.campaignPerformance(context.client.googleCustomerId)
      const pmaxPlacements = await gateway.performanceMaxPlacements(context.client.googleCustomerId)
      const assetGroups = await gateway.assetGroupPerformance(context.client.googleCustomerId)
      const shoppingProducts = await gateway.shoppingProductPerformance(context.client.googleCustomerId)
      const conversionActions = await gateway.conversionActions(context.client.googleCustomerId)
      const offlineDiagnostics = await gateway.offlineConversionDiagnostics(context.client.googleCustomerId)
      const summary = {
        managedAccounts: managed.length,
        campaigns: campaigns.length,
        channelTypes: [...new Set(campaigns.map((campaign) => campaign.channelType))].sort(),
        pmaxPlacements: pmaxPlacements.length,
        assetGroups: assetGroups.length,
        shoppingProducts: shoppingProducts.length,
        conversionActions: conversionActions.length,
        offlineDiagnostics: offlineDiagnostics.length,
      }
      await withSystemTransaction((db) => db.insert(auditEvents).values({
        workspaceId: payload.workspaceId,
        actorUserId: 'system:google-read-drill',
        action: 'google_ads.read_drill_completed',
        entityType: 'client',
        entityId: payload.clientId,
        metadata: summary,
      }))
      return summary
    }
    case 'metrics.daily_sync': {
      const payload = metricsPayload.parse(job.payload)
      const context = await withSystemTransaction(async (db) => {
        const [client] = await db.select().from(clients).where(and(eq(clients.id, payload.clientId), eq(clients.workspaceId, payload.workspaceId), eq(clients.active, true))).limit(1)
        const [connection] = await db.select().from(googleAdsConnections).where(and(eq(googleAdsConnections.workspaceId, payload.workspaceId), eq(googleAdsConnections.status, 'active'))).limit(1)
        if (!client || !connection) throw new NonRetryableJobError('Metrics sync client or connection unavailable')
        return { client, connection }
      })
      const calendar = pacingCalendar(new Date(), context.client.timezone)
      const gateway = new GoogleAdsGateway(context.connection)
      const [metrics, campaignMetrics] = await Promise.all([
        gateway.dailyAccountMetrics(context.client.googleCustomerId, calendar.from, calendar.through),
        gateway.dailyCampaignMetrics(context.client.googleCustomerId, calendar.from, calendar.through),
      ])
      await withSystemTransaction(async (db) => {
        for (const metric of metrics) {
          await db.insert(dailyAccountMetrics).values({
            workspaceId: payload.workspaceId,
            clientId: payload.clientId,
            metricDate: metric.date,
            currencyCode: context.client.currencyCode,
            costMicros: metric.costMicros,
            impressions: metric.impressions,
            clicks: metric.clicks,
            conversions: String(metric.conversions),
            conversionValueMicros: String(Math.round(metric.conversionValue * 1_000_000)),
          }).onConflictDoUpdate({
            target: [dailyAccountMetrics.clientId, dailyAccountMetrics.metricDate],
            set: {
              currencyCode: context.client.currencyCode,
              costMicros: metric.costMicros,
              impressions: metric.impressions,
              clicks: metric.clicks,
              conversions: String(metric.conversions),
              conversionValueMicros: String(Math.round(metric.conversionValue * 1_000_000)),
              collectedAt: new Date(),
            },
          })
        }
        for (const metric of campaignMetrics) {
          await db.insert(dailyCampaignMetrics).values({
            workspaceId: payload.workspaceId,
            clientId: payload.clientId,
            campaignId: metric.campaignId,
            metricDate: metric.date,
            campaignName: metric.campaignName,
            campaignType: metric.campaignType,
            status: metric.status,
            currencyCode: context.client.currencyCode,
            costMicros: metric.costMicros,
            impressions: metric.impressions,
            clicks: metric.clicks,
            conversions: String(metric.conversions),
            conversionValueMicros: String(Math.round(metric.conversionValue * 1_000_000)),
          }).onConflictDoUpdate({
            target: [dailyCampaignMetrics.clientId, dailyCampaignMetrics.campaignId, dailyCampaignMetrics.metricDate],
            set: {
              campaignName: metric.campaignName,
              campaignType: metric.campaignType,
              status: metric.status,
              currencyCode: context.client.currencyCode,
              costMicros: metric.costMicros,
              impressions: metric.impressions,
              clicks: metric.clicks,
              conversions: String(metric.conversions),
              conversionValueMicros: String(Math.round(metric.conversionValue * 1_000_000)),
              collectedAt: new Date(),
            },
          })
        }
      })
      return { accountDays: metrics.length, campaignDays: campaignMetrics.length, period: { from: calendar.from, through: calendar.through } }
    }
    case 'google.change_sync': {
      const payload = metricsPayload.parse(job.payload)
      const context = await googleSyncContext(payload.workspaceId, payload.clientId)
      const through = new Date()
      const from = new Date(through.getTime() - 29 * 24 * 60 * 60_000)
      const changes = await new GoogleAdsGateway(context.connection).changeEvents(
        context.client.googleCustomerId,
        from,
        through,
      )
      await withSystemTransaction(async (db) => {
        const recentApprovals = await db.query.approvalRequests.findMany({
          where: and(
            eq(approvalRequests.workspaceId, payload.workspaceId),
            eq(approvalRequests.clientId, payload.clientId),
            isNotNull(approvalRequests.executedAt),
            gte(approvalRequests.executedAt, from),
          ),
          columns: { id: true, resourceName: true, executedAt: true },
        })
        const internalAudit = await db.query.auditEvents.findMany({
          where: and(
            eq(auditEvents.workspaceId, payload.workspaceId),
            eq(auditEvents.action, 'approval.executed'),
            gte(auditEvents.createdAt, from),
          ),
          columns: { id: true, entityId: true },
        })
        const auditByApproval = new Map(internalAudit.map((event) => [event.entityId, event.id]))
        for (const change of changes) {
          const matchingApproval = recentApprovals.find((approval) =>
            approval.resourceName === change.changedResourceName &&
            approval.executedAt &&
            Math.abs(approval.executedAt.getTime() - change.changedAt.getTime()) <= 10 * 60_000,
          )
          await db.insert(googleChangeEvents).values({
            workspaceId: payload.workspaceId,
            clientId: payload.clientId,
            changeResourceName: change.resourceName,
            changedResourceName: change.changedResourceName,
            changedAt: change.changedAt,
            changedBy: change.changedBy,
            clientType: change.clientType,
            resourceType: change.resourceType,
            operation: change.operation,
            changedFields: change.changedFields,
            oldResource: change.oldResource,
            newResource: change.newResource,
            internalAuditEventId: matchingApproval ? auditByApproval.get(matchingApproval.id) ?? null : null,
          }).onConflictDoUpdate({
            target: [googleChangeEvents.clientId, googleChangeEvents.changeResourceName],
            set: {
              changedResourceName: change.changedResourceName,
              changedAt: change.changedAt,
              changedBy: change.changedBy,
              clientType: change.clientType,
              resourceType: change.resourceType,
              operation: change.operation,
              changedFields: change.changedFields,
              oldResource: change.oldResource,
              newResource: change.newResource,
              internalAuditEventId: matchingApproval ? auditByApproval.get(matchingApproval.id) ?? null : null,
              updatedAt: new Date(),
            },
          })
        }
      })
      return { changes: changes.length, period: { from: from.toISOString(), through: through.toISOString() } }
    }
    case 'conversion.actions_sync': {
      const payload = metricsPayload.parse(job.payload)
      const context = await googleSyncContext(payload.workspaceId, payload.clientId)
      const gateway = new GoogleAdsGateway(context.connection)
      const [actions, offlineDiagnostics] = await Promise.all([
        gateway.conversionActions(context.client.googleCustomerId),
        gateway.offlineConversionDiagnostics(context.client.googleCustomerId),
      ])
      const snapshotDate = localScheduleParts(new Date(), context.client.timezone).date
      await withSystemTransaction(async (db) => {
        for (const action of actions) {
          await db.insert(conversionActionSnapshots).values({
            workspaceId: payload.workspaceId,
            clientId: payload.clientId,
            resourceName: action.resourceName,
            snapshotDate,
            name: action.name,
            status: action.status,
            category: action.category,
            origin: action.origin,
            actionType: action.actionType,
            primaryForGoal: action.primaryForGoal,
            includeInConversionsMetric: action.includeInConversionsMetric,
            lastActivityAt: action.lastActivityAt,
            lastConversionAt: action.lastConversionAt,
            lastReceivedAt: action.lastReceivedAt,
            enhancedConversionsEnabled: null,
          }).onConflictDoUpdate({
            target: [conversionActionSnapshots.clientId, conversionActionSnapshots.resourceName, conversionActionSnapshots.snapshotDate],
            set: {
              name: action.name,
              status: action.status,
              category: action.category,
              origin: action.origin,
              actionType: action.actionType,
              primaryForGoal: action.primaryForGoal,
              includeInConversionsMetric: action.includeInConversionsMetric,
              lastActivityAt: action.lastActivityAt,
              lastConversionAt: action.lastConversionAt,
              lastReceivedAt: action.lastReceivedAt,
              updatedAt: new Date(),
            },
          })
        }
        for (const diagnostic of offlineDiagnostics) {
          await db.insert(offlineConversionDiagnostics).values({
            workspaceId: payload.workspaceId,
            clientId: payload.clientId,
            snapshotDate,
            uploadClient: diagnostic.uploadClient,
            status: diagnostic.status,
            lastUploadAt: diagnostic.lastUploadAt,
            totalEventCount: diagnostic.totalEventCount,
            successfulEventCount: diagnostic.successfulEventCount,
            pendingEventCount: diagnostic.pendingEventCount,
            successRate: diagnostic.successRate === null ? null : String(diagnostic.successRate),
            alerts: diagnostic.alerts,
          }).onConflictDoUpdate({
            target: [offlineConversionDiagnostics.clientId, offlineConversionDiagnostics.uploadClient, offlineConversionDiagnostics.snapshotDate],
            set: {
              status: diagnostic.status,
              lastUploadAt: diagnostic.lastUploadAt,
              totalEventCount: diagnostic.totalEventCount,
              successfulEventCount: diagnostic.successfulEventCount,
              pendingEventCount: diagnostic.pendingEventCount,
              successRate: diagnostic.successRate === null ? null : String(diagnostic.successRate),
              alerts: diagnostic.alerts,
              updatedAt: new Date(),
            },
          })
        }
      })
      return { conversionActions: actions.length, offlineDiagnostics: offlineDiagnostics.length, snapshotDate }
    }
    case 'retention.run': {
      const startedAt = Date.now()
      const now = new Date()
      const runKey = `${job.id}:${job.attemptCount}`
      const nextRunAt = new Date(now.getTime() + 24 * 60 * 60_000)
      await startOperationalRun({ component: 'retention', runKey, startedAt: now, nextExpectedAt: nextRunAt })
      const daysAgo = (days: number) => retentionCutoff(now, days)
      try {
        const exports = await deleteExpiredExportArtifacts(now)
        const database = await withSystemTransaction(async (db) => {
          const counts: Record<string, number> = {}
          const remove = async (category: string, operation: Promise<Array<{ id: string }>>) => {
            counts[category] = (await operation).length
          }
          await remove('notificationDeliveries', db.delete(notificationDeliveries).where(and(
            inArray(notificationDeliveries.status, ['delivered', 'dead_letter']),
            isNotNull(notificationDeliveries.terminalAt),
            lt(notificationDeliveries.terminalAt, daysAgo(RETENTION_POLICY.deliveryEvidenceDays)),
          )).returning({ id: notificationDeliveries.id }))
          await remove('transactionalEmailDeliveries', db.delete(transactionalEmailDeliveries).where(and(
            lt(transactionalEmailDeliveries.updatedAt, daysAgo(RETENTION_POLICY.deliveryEvidenceDays)),
            inArray(transactionalEmailDeliveries.status, ['delivered', 'failed', 'suppressed', 'hard_bounced', 'complained']),
          )).returning({ id: transactionalEmailDeliveries.id }))
          await remove('terminalJobs', db.delete(jobs).where(or(
            and(eq(jobs.status, 'completed'), lt(jobs.completedAt, daysAgo(RETENTION_POLICY.terminalJobsDays))),
            and(eq(jobs.status, 'cancelled'), lt(jobs.updatedAt, daysAgo(RETENTION_POLICY.terminalJobsDays))),
          )).returning({ id: jobs.id }))
          await remove('rateLimitBuckets', db.delete(rateLimitBuckets).where(lt(rateLimitBuckets.expiresAt, now)).returning({ id: rateLimitBuckets.id }))
          await remove('secretRevelations', db.delete(secretRevelations).where(lt(secretRevelations.expiresAt, now)).returning({ id: secretRevelations.id }))
          await remove('notificationOAuthSessions', db.delete(notificationOAuthSessions).where(lt(notificationOAuthSessions.expiresAt, now)).returning({ id: notificationOAuthSessions.id }))
          await remove('expiredShareLinks', db.update(shareLinks).set({ active: false, updatedAt: now }).where(and(eq(shareLinks.active, true), lt(shareLinks.expiresAt, now))).returning({ id: shareLinks.id }))
          const historyCutoff = daysAgo(RETENTION_POLICY.productHistoryDays)
          const historyDate = historyCutoff.toISOString().slice(0, 10)
          await remove('dailyAccountMetrics', db.delete(dailyAccountMetrics).where(lt(dailyAccountMetrics.metricDate, historyDate)).returning({ id: dailyAccountMetrics.id }))
          await remove('dailyCampaignMetrics', db.delete(dailyCampaignMetrics).where(lt(dailyCampaignMetrics.metricDate, historyDate)).returning({ id: dailyCampaignMetrics.id }))
          await remove('performanceSnapshots', db.delete(performanceSnapshots).where(lt(performanceSnapshots.snapshotDate, historyDate)).returning({ id: performanceSnapshots.id }))
          await remove('conversionActionSnapshots', db.delete(conversionActionSnapshots).where(lt(conversionActionSnapshots.snapshotDate, historyDate)).returning({ id: conversionActionSnapshots.id }))
          await remove('offlineConversionDiagnostics', db.delete(offlineConversionDiagnostics).where(lt(offlineConversionDiagnostics.snapshotDate, historyDate)).returning({ id: offlineConversionDiagnostics.id }))
          await remove('googleChangeEvents', db.delete(googleChangeEvents).where(lt(googleChangeEvents.changedAt, historyCutoff)).returning({ id: googleChangeEvents.id }))
          await remove('mutationExecutions', db.delete(mutationExecutions).where(lt(mutationExecutions.createdAt, historyCutoff)).returning({ id: mutationExecutions.id }))
          await remove('alertIncidents', db.delete(alertIncidents).where(lt(alertIncidents.createdAt, historyCutoff)).returning({ id: alertIncidents.id }))
          await remove('approvalRequests', db.delete(approvalRequests).where(lt(approvalRequests.createdAt, historyCutoff)).returning({ id: approvalRequests.id }))
          await remove('auditEvents', db.delete(auditEvents).where(lt(auditEvents.createdAt, historyCutoff)).returning({ id: auditEvents.id }))
          await remove('yodevMailEvents', db.delete(yodevMailEvents).where(lt(yodevMailEvents.receivedAt, daysAgo(RETENTION_POLICY.deliveryEvidenceDays))).returning({ id: yodevMailEvents.eventId }))
          return { counts, affectedRows: Object.values(counts).reduce((sum, count) => sum + count, 0) }
        })
        const durationMs = Date.now() - startedAt
        await completeOperationalRun({
          component: 'retention', runKey, startedAt: now, nextExpectedAt: nextRunAt,
          workCount: database.affectedRows + exports.expired,
          details: { counts: database.counts, exports },
        })
        return { ...database, exports, durationMs, nextRunAt: nextRunAt.toISOString() }
      } catch (error) {
        await failOperationalRun({ component: 'retention', runKey, startedAt: now, nextExpectedAt: nextRunAt, error })
        throw error
      }
    }
    default:
      throw new NonRetryableJobError(`No worker registered for job type ${job.type}`)
  }
}

async function googleSyncContext(workspaceId: string, clientId: string) {
  return withSystemTransaction(async (db) => {
    const client = await db.query.clients.findFirst({
      where: and(eq(clients.id, clientId), eq(clients.workspaceId, workspaceId), eq(clients.active, true)),
    })
    const connection = await db.query.googleAdsConnections.findFirst({
      where: and(eq(googleAdsConnections.workspaceId, workspaceId), eq(googleAdsConnections.status, 'active')),
    })
    if (!client || !connection) throw new NonRetryableJobError('Google sync client or connection unavailable')
    return { client, connection }
  })
}

export async function runAvailableJobs(options: {
  workerId: string
  maximumJobs?: number
  maximumRuntimeMs?: number
}) {
  const startedAt = Date.now()
  const maximumJobs = options.maximumJobs ?? 25
  const maximumRuntimeMs = options.maximumRuntimeMs ?? 45_000
  const results: Array<{ jobId: string; type: string; status: string; error?: string }> = []
  while (results.length < maximumJobs && Date.now() - startedAt < maximumRuntimeMs) {
    const job = await claimNextJob(
      options.workerId,
      new Date(),
      undefined,
      featureEnabled('notifications') ? [] : NOTIFICATION_JOB_TYPES,
    )
    if (!job) break
    try {
      const result = await runWithTransactionalEmailRetryGeneration(job.payload, () => executeJob(job))
      const providerMessageId = result && typeof result === 'object' && 'providerMessageId' in result && typeof result.providerMessageId === 'string'
        ? result.providerMessageId.slice(0, 128)
        : null
      const completed = await completeJob(job, options.workerId, new Date(), providerMessageId)
      results.push({ jobId: job.id, type: job.type, status: completed ? 'completed' : 'lease_lost' })
    } catch (error) {
      const failure = await failJob(job, options.workerId, error, {
        forceDeadLetter: error instanceof NonRetryableJobError,
        retryAttemptOffset: job.type === 'notification.deliver' ? 1 : 0,
      })
      const operationsAlert = failure.deadLettered ? operationsAlertJobForDeadLetter({
        jobId: job.id,
        jobType: job.type,
        description: safeOperationalError(error),
      }) : null
      if (operationsAlert) {
        try {
          await enqueueJob(operationsAlert)
        } catch (alertError) {
          console.error(JSON.stringify({
            level: 'error',
            message: 'job.operations_alert_enqueue_failed',
            jobId: job.id,
            jobType: job.type,
            error: safeOperationalError(alertError),
          }))
        }
      }
      if (failure.deadLettered && job.workspaceId && job.type !== 'notification.deliver') {
        try {
          await dispatchIncidentNotifications({
            workspaceId: job.workspaceId,
            eventKey: `job-dead-letter:${job.id}:${job.attemptCount}`,
            severity: 'critical',
            title: `Job critique en dead-letter : ${job.type}`,
            description: safeOperationalError(error),
            clientName: 'Espace de travail',
          })
        } catch (notificationError) {
          console.error(JSON.stringify({
            level: 'error',
            message: 'job.dead_letter_notification_failed',
            jobId: job.id,
            jobType: job.type,
            error: notificationError instanceof Error ? notificationError.message : String(notificationError),
          }))
        }
      }
      results.push({
        jobId: job.id,
        type: job.type,
        status: failure.deadLettered ? 'dead_letter' : 'retrying',
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
  return { processed: results.length, durationMs: Date.now() - startedAt, results }
}
