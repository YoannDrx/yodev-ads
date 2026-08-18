import 'server-only'

import { and, eq, inArray, isNotNull, isNull } from 'drizzle-orm'
import {
  approvalRequests,
  auditEvents,
  clients,
  deletionRequests,
  exportJobs,
  memberNotificationPreferences,
  monitoringAgents,
  reportSchedules,
  subprocessorChangeNotices,
  workspaces,
} from '@/db/schema'
import { withSystemTransaction } from '@/db/transactions'
import { currentEncryptionKeyId } from '@/lib/crypto'
import { featureEnabled } from '@/lib/feature-flags'
import { enqueueJobs, type EnqueueJobInput } from '@/lib/jobs'
import { trialLifecycleDue } from '@/lib/lifecycle-email-model'
import { reportScheduleRunKey } from '@/lib/report-scheduling'
import { taskDigestRunKey } from '@/lib/task-notification-model'

export function localScheduleParts(date: Date, timezone: string) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
    weekday: 'short',
  })
  const values = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]))
  return {
    date: `${values.year}-${values.month}-${values.day}`,
    hour: Number(values.hour),
    weekday: values.weekday,
  }
}

export async function seedScheduledJobs(now = new Date()) {
  const currentKid = currentEncryptionKeyId()
  const { monitoredWorkspaces, billingWorkspaces, ambiguousApprovals, dueDeletions, metricClients, queuedExports, scheduledReports, digestPreferences, trialWorkspaces, rotationWorkspaces, subprocessorNotices } = await withSystemTransaction(async (db) => {
    const monitored = await db
        .select({ workspaceId: workspaces.id, timezone: workspaces.timezone })
        .from(monitoringAgents)
        .innerJoin(workspaces, eq(workspaces.id, monitoringAgents.workspaceId))
        .where(
          and(
            eq(monitoringAgents.enabled, true),
            eq(monitoringAgents.schedule, 'daily'),
            inArray(workspaces.accessState, ['internal', 'trial', 'active']),
          ),
        )
    const ambiguous = await db
        .select({ approvalId: approvalRequests.id, workspaceId: approvalRequests.workspaceId })
        .from(approvalRequests)
        .where(and(eq(approvalRequests.status, 'ambiguous'), eq(approvalRequests.reconciliationState, 'pending')))
    const deletions = await db
        .select({ workspaceId: deletionRequests.workspaceId, purgeAt: deletionRequests.purgeAt })
        .from(deletionRequests)
        .innerJoin(workspaces, eq(workspaces.id, deletionRequests.workspaceId))
        .where(and(
          eq(deletionRequests.status, 'pending'),
          eq(workspaces.accessState, 'deletion_pending'),
        ))
    const accounts = await db
        .select({ workspaceId: clients.workspaceId, clientId: clients.id, timezone: clients.timezone })
        .from(clients)
        .innerJoin(workspaces, eq(workspaces.id, clients.workspaceId))
        .where(and(
          eq(clients.active, true),
          eq(clients.isManager, false),
          inArray(workspaces.accessState, ['internal', 'trial', 'active']),
        ))
    const exports = await db
        .select({ exportJobId: exportJobs.id, workspaceId: exportJobs.workspaceId })
        .from(exportJobs)
        .where(eq(exportJobs.status, 'queued'))
    const schedules = await db
        .select({
          id: reportSchedules.id,
          workspaceId: reportSchedules.workspaceId,
          cadence: reportSchedules.cadence,
          scheduleWeekday: reportSchedules.scheduleWeekday,
          scheduleMonthday: reportSchedules.scheduleMonthday,
          sendHour: reportSchedules.sendHour,
          timezone: reportSchedules.timezone,
          lastRunKey: reportSchedules.lastRunKey,
        })
        .from(reportSchedules)
        .innerJoin(workspaces, eq(workspaces.id, reportSchedules.workspaceId))
        .where(and(
          eq(reportSchedules.enabled, true),
          inArray(workspaces.accessState, ['internal', 'trial', 'active']),
        ))
    const preferences = await db
        .select({
          id: memberNotificationPreferences.id,
          workspaceId: memberNotificationPreferences.workspaceId,
          cadence: memberNotificationPreferences.digestCadence,
          digestHour: memberNotificationPreferences.digestHour,
          timezone: memberNotificationPreferences.timezone,
          lastDigestKey: memberNotificationPreferences.lastDigestKey,
        })
        .from(memberNotificationPreferences)
        .innerJoin(workspaces, eq(workspaces.id, memberNotificationPreferences.workspaceId))
        .where(and(
          inArray(memberNotificationPreferences.digestCadence, ['daily', 'weekly']),
          inArray(workspaces.accessState, ['internal', 'trial', 'active']),
        ))
    const trials = await db
        .select({
          id: workspaces.id,
          accessState: workspaces.accessState,
          trialStartedAt: workspaces.trialStartedAt,
          trialEndsAt: workspaces.trialEndsAt,
        })
        .from(workspaces)
        .where(and(
          eq(workspaces.plan, 'trial'),
          inArray(workspaces.accessState, ['trial', 'suspended']),
          isNotNull(workspaces.trialStartedAt),
          isNotNull(workspaces.trialEndsAt),
        ))
    const rotationTargets = currentKid
      ? await db.select({ workspaceId: workspaces.id }).from(workspaces).where(inArray(workspaces.accessState, ['internal', 'trial', 'active', 'grace', 'suspended']))
      : []
    const notices = await db.select({ id: subprocessorChangeNotices.id })
      .from(subprocessorChangeNotices)
      .where(and(eq(subprocessorChangeNotices.status, 'scheduled'), isNull(subprocessorChangeNotices.notifiedAt)))
    const billing = await db.select({ workspaceId: workspaces.id })
      .from(workspaces)
      .where(isNotNull(workspaces.stripeSubscriptionId))
    const expiredIds = trials
      .filter((workspace) => workspace.accessState === 'trial' && workspace.trialEndsAt && workspace.trialEndsAt <= now)
      .map((workspace) => workspace.id)
    if (expiredIds.length > 0) {
      const expired = await db.update(workspaces).set({ accessState: 'suspended', updatedAt: now }).where(and(
        inArray(workspaces.id, expiredIds),
        eq(workspaces.accessState, 'trial'),
      )).returning({ id: workspaces.id })
      if (expired.length > 0) await db.insert(auditEvents).values(expired.map((workspace) => ({
        workspaceId: workspace.id,
        actorUserId: 'system:scheduler',
        action: 'workspace.trial_expired',
        entityType: 'workspace',
        entityId: workspace.id,
        metadata: { expiredAt: now.toISOString() },
      })))
    }
    return {
      monitoredWorkspaces: [...new Map(monitored.map((item) => [item.workspaceId, item])).values()],
      billingWorkspaces: billing,
      ambiguousApprovals: ambiguous,
      dueDeletions: deletions.filter((request) => request.purgeAt <= now),
      metricClients: accounts,
      queuedExports: exports,
      scheduledReports: schedules,
      digestPreferences: preferences,
      trialWorkspaces: trials,
      rotationWorkspaces: rotationTargets,
      subprocessorNotices: notices,
    }
  })

  const pending: EnqueueJobInput[] = []
  pending.push({
    workspaceId: null,
    type: 'retention.run',
    payload: {},
    priority: 150,
    deduplicationKey: `retention.run:${now.toISOString().slice(0, 10)}`,
  })
  for (const workspace of billingWorkspaces) {
    pending.push({
      workspaceId: workspace.workspaceId,
      type: 'stripe.reconcile',
      payload: { workspaceId: workspace.workspaceId },
      priority: 35,
      deduplicationKey: `stripe.reconcile:${workspace.workspaceId}:${now.toISOString().slice(0, 10)}`,
      maximumAttempts: 3,
    })
  }
  if (currentKid) {
    for (const workspace of rotationWorkspaces) {
      pending.push({
        workspaceId: workspace.workspaceId,
        type: 'secrets.rotate',
        payload: { workspaceId: workspace.workspaceId, targetKid: currentKid },
        priority: 15,
        deduplicationKey: `secrets.rotate:${workspace.workspaceId}:${currentKid}`,
        maximumAttempts: 2,
      })
    }
  }
  for (const workspace of trialWorkspaces) {
    if (!workspace.trialStartedAt || !workspace.trialEndsAt) continue
    const referenceKey = workspace.trialStartedAt.toISOString().slice(0, 10)
    const lifecycle = (kind: 'welcome' | 'trial_day_7' | 'trial_day_12' | 'trial_expired', effectiveAt?: Date) => pending.push({
      workspaceId: workspace.id,
      type: 'lifecycle.email',
      payload: { workspaceId: workspace.id, kind, referenceKey, effectiveAt: effectiveAt?.toISOString() },
      priority: kind === 'trial_expired' ? 20 : 90,
      deduplicationKey: `lifecycle.email:${workspace.id}:${kind}:${referenceKey}`,
    })
    for (const kind of trialLifecycleDue({
      accessState: workspace.accessState,
      trialStartedAt: workspace.trialStartedAt,
      trialEndsAt: workspace.trialEndsAt,
      now,
    })) lifecycle(kind, workspace.trialEndsAt)
  }
  for (const workspace of monitoredWorkspaces) {
    const local = localScheduleParts(now, workspace.timezone)
    if (local.hour >= 6) {
      pending.push({
        workspaceId: workspace.workspaceId,
        type: 'monitoring.scan',
        payload: { workspaceId: workspace.workspaceId },
        priority: 50,
        deduplicationKey: `monitoring.scan:${workspace.workspaceId}:${local.date}`,
      })
    }
    if (local.weekday === 'Mon' && local.hour >= 7) {
      pending.push({
        workspaceId: workspace.workspaceId,
        type: 'monitoring.weekly_digest',
        payload: { workspaceId: workspace.workspaceId },
        priority: 80,
        deduplicationKey: `monitoring.weekly_digest:${workspace.workspaceId}:${local.date}`,
      })
    }
  }
  if (featureEnabled('notifications')) {
    for (const notice of subprocessorNotices) {
      pending.push({
        workspaceId: null,
        type: 'subprocessor.notice_fanout',
        payload: { noticeId: notice.id },
        priority: 20,
        deduplicationKey: `subprocessor.notice_fanout:${notice.id}`,
      })
    }
    for (const schedule of scheduledReports) {
      const runKey = reportScheduleRunKey(schedule, now)
      if (!runKey || runKey === schedule.lastRunKey) continue
      pending.push({
        workspaceId: schedule.workspaceId,
        type: 'report.schedule_deliver',
        payload: { scheduleId: schedule.id, runKey },
        priority: 75,
        deduplicationKey: `report.schedule_deliver:${schedule.id}:${runKey}`,
      })
    }
    for (const preference of digestPreferences) {
      const runKey = taskDigestRunKey(preference, now)
      if (!runKey || runKey === preference.lastDigestKey) continue
      pending.push({
        workspaceId: preference.workspaceId,
        type: 'task.personal_digest',
        payload: { preferenceId: preference.id, runKey },
        priority: 85,
        deduplicationKey: `task.personal_digest:${preference.id}:${runKey}`,
      })
    }
  }
  for (const account of metricClients) {
    const local = localScheduleParts(now, account.timezone)
    if (local.hour >= 5) pending.push({
      workspaceId: account.workspaceId,
      type: 'metrics.daily_sync',
      payload: { workspaceId: account.workspaceId, clientId: account.clientId },
      priority: 40,
      deduplicationKey: `metrics.daily_sync:${account.clientId}:${local.date}`,
    })
    if (local.hour >= 4) {
      pending.push({
        workspaceId: account.workspaceId,
        type: 'google.change_sync',
        payload: { workspaceId: account.workspaceId, clientId: account.clientId },
        priority: 45,
        deduplicationKey: `google.change_sync:${account.clientId}:${local.date}`,
      })
      pending.push({
        workspaceId: account.workspaceId,
        type: 'conversion.actions_sync',
        payload: { workspaceId: account.workspaceId, clientId: account.clientId },
        priority: 46,
        deduplicationKey: `conversion.actions_sync:${account.clientId}:${local.date}`,
      })
    }
  }
  for (const approval of ambiguousApprovals) {
    pending.push({
      workspaceId: approval.workspaceId,
      type: 'google.mutation.reconcile',
      payload: { approvalId: approval.approvalId },
      priority: 10,
      deduplicationKey: `google.mutation.reconcile:${approval.approvalId}`,
    })
  }
  for (const deletion of dueDeletions) {
    pending.push({
      workspaceId: null,
      type: 'workspace.purge',
      payload: { workspaceId: deletion.workspaceId },
      priority: 5,
      deduplicationKey: `workspace.purge:${deletion.workspaceId}`,
    })
  }
  for (const exportJob of queuedExports) {
    pending.push({
      workspaceId: exportJob.workspaceId,
      type: 'workspace.export',
      payload: { workspaceId: exportJob.workspaceId, exportJobId: exportJob.exportJobId },
      priority: 30,
      deduplicationKey: `workspace.export:${exportJob.exportJobId}`,
    })
  }
  return enqueueJobs(pending)
}
