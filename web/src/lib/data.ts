import 'server-only'

import { and, count, desc, eq, gt, gte, inArray, isNotNull, isNull, lte, sql, sum } from 'drizzle-orm'
import { z } from 'zod'
import { cookies } from 'next/headers'
import { withTenantTransaction, type DatabaseTransaction } from '@/db/transactions'
import {
  alertIncidents,
  apiKeys,
  approvalRequests,
  auditEvents,
  clients,
  clientApprovalFeedback,
  clientGoals,
  conversionActionSnapshots,
  dailyAccountMetrics,
  exportJobs,
  googleAdsConnections,
  googleChangeEvents,
  jobs,
  monitoringAgents,
  memberNotificationPreferences,
  notificationChannels,
  offlineConversionDiagnostics,
  reportRecipients,
  reportSchedules,
  reportTemplates,
  safetyPolicies,
  shareLinks,
  workspaceDomains,
  workspaces,
} from '@/db/schema'
import type { ClientAlertSummary } from '@/lib/dashboard-health'
import { hashToken } from '@/lib/tokens'
import { reportCalendarWindow, shiftCalendarDate } from '@/lib/calendar-window'
import { metricCoverage } from '@/lib/metric-coverage'
import { computePacing, pacingCalendar } from '@/lib/pacing'
import { workspaceHasCapability } from '@/lib/entitlements'
export { saveWorkspaceGoogleConnection, googleConnectionVersion } from '@/lib/google-connection-management'

export { consumeWorkspaceSecretRevelation } from '@/lib/secret-revelation'

export { getPublicShare, publicHostBelongsToWorkspace } from '@/lib/public-share-repository'

function tenantRead<T>(workspaceId: string, operation: (db: DatabaseTransaction) => Promise<T>) {
  return withTenantTransaction({ workspaceId, userId: 'repository:read' }, operation)
}

export async function getWorkspaceConnection(workspaceId: string) {
  return tenantRead(workspaceId, (db) => db.query.googleAdsConnections.findFirst({
    where: eq(googleAdsConnections.workspaceId, workspaceId),
  }))
}


export async function listWorkspaceClients(workspaceId: string) {
  return tenantRead(workspaceId, (db) => db.query.clients.findMany({
    where: and(eq(clients.workspaceId, workspaceId), eq(clients.active, true)),
    orderBy: [clients.name],
  }))
}

export async function listWorkspaceExports(workspaceId: string) {
  return tenantRead(workspaceId, (db) => db.query.exportJobs.findMany({
    where: eq(exportJobs.workspaceId, workspaceId),
    orderBy: [desc(exportJobs.createdAt)],
    limit: 10,
  }))
}

export function getDownloadableWorkspaceExport(workspaceId: string, userId: string, exportId: string) {
  return withTenantTransaction({ workspaceId, userId }, (db) => db.query.exportJobs.findFirst({
    where: and(
      eq(exportJobs.id, exportId),
      eq(exportJobs.workspaceId, workspaceId),
      eq(exportJobs.status, 'completed'),
      gt(exportJobs.expiresAt, new Date()),
    ),
    columns: { artifactKey: true, artifactHash: true },
  }))
}


export async function listWorkspaceDeadLetters(workspaceId: string) {
  return tenantRead(workspaceId, (db) => db.query.jobs.findMany({
    where: and(eq(jobs.workspaceId, workspaceId), eq(jobs.status, 'dead_letter')),
    orderBy: [desc(jobs.deadLetteredAt)],
    limit: 50,
  }))
}

export async function listWorkspaceDomains(workspaceId: string) {
  return tenantRead(workspaceId, (db) => db.query.workspaceDomains.findMany({
    where: and(eq(workspaceDomains.workspaceId, workspaceId), isNull(workspaceDomains.revokedAt)),
    orderBy: [desc(workspaceDomains.createdAt)],
  }))
}

export async function activeWorkspaceOrigin(workspaceId: string) {
  const { workspace, domain } = await tenantRead(workspaceId, async (db) => {
    const workspace = await db.query.workspaces.findFirst({ where: eq(workspaces.id, workspaceId), columns: { accessState: true, plan: true } })
    const domain = await db.query.workspaceDomains.findFirst({
      where: and(
        eq(workspaceDomains.workspaceId, workspaceId),
        eq(workspaceDomains.verificationStatus, 'active'),
        isNull(workspaceDomains.revokedAt),
      ),
      orderBy: [desc(workspaceDomains.activatedAt)],
    })
    return { workspace, domain }
  })
  if (!workspace || !workspaceHasCapability(workspace.accessState, workspace.plan, 'custom_domain')) {
    return process.env.NEXT_PUBLIC_APP_URL ?? 'https://ads.yodev.fr'
  }
  return domain ? `https://${domain.hostname}` : (process.env.NEXT_PUBLIC_APP_URL ?? 'https://ads.yodev.fr')
}

export async function getWorkspaceClient(workspaceId: string, clientId?: string) {
  if (clientId !== undefined) {
    if (!z.string().uuid().safeParse(clientId).success) return undefined
    const selected = await tenantRead(workspaceId, (db) => db.query.clients.findFirst({
      where: and(eq(clients.workspaceId, workspaceId), eq(clients.id, clientId), eq(clients.active, true), eq(clients.isManager, false)),
    }))
    return selected
  }
  return tenantRead(workspaceId, (db) => db.query.clients.findFirst({
    where: and(eq(clients.workspaceId, workspaceId), eq(clients.active, true), eq(clients.isManager, false)),
    orderBy: [clients.name],
  }))
}

export async function listDailyAccountHistory(workspaceId: string, clientId: string, days: number) {
  const since = new Date(Date.now() - days * 24 * 60 * 60_000).toISOString().slice(0, 10)
  return tenantRead(workspaceId, (db) => db.query.dailyAccountMetrics.findMany({
    where: and(
      eq(dailyAccountMetrics.workspaceId, workspaceId),
      eq(dailyAccountMetrics.clientId, clientId),
      gte(dailyAccountMetrics.metricDate, since),
    ),
    orderBy: [dailyAccountMetrics.metricDate],
    limit: 750,
  }))
}

export async function listLatestConversionActionSnapshots(workspaceId: string, clientId: string) {
  const rows = await tenantRead(workspaceId, (db) => db.query.conversionActionSnapshots.findMany({
    where: and(
      eq(conversionActionSnapshots.workspaceId, workspaceId),
      eq(conversionActionSnapshots.clientId, clientId),
    ),
    orderBy: [desc(conversionActionSnapshots.snapshotDate), conversionActionSnapshots.name],
    limit: 1000,
  }))
  const latest = new Map<string, (typeof rows)[number]>()
  for (const row of rows) {
    if (!latest.has(row.resourceName)) latest.set(row.resourceName, row)
  }
  return [...latest.values()]
}

export async function listLatestOfflineConversionDiagnostics(workspaceId: string, clientId: string) {
  const rows = await tenantRead(workspaceId, (db) => db.query.offlineConversionDiagnostics.findMany({
    where: and(
      eq(offlineConversionDiagnostics.workspaceId, workspaceId),
      eq(offlineConversionDiagnostics.clientId, clientId),
    ),
    orderBy: [desc(offlineConversionDiagnostics.snapshotDate), offlineConversionDiagnostics.uploadClient],
    limit: 100,
  }))
  const latest = new Map<string, (typeof rows)[number]>()
  for (const row of rows) {
    if (!latest.has(row.uploadClient)) latest.set(row.uploadClient, row)
  }
  return [...latest.values()]
}

export async function listClientTimeline(workspaceId: string, clientId: string) {
  return tenantRead(workspaceId, async (db) => {
    const changes = await db.query.googleChangeEvents.findMany({
      where: and(eq(googleChangeEvents.workspaceId, workspaceId), eq(googleChangeEvents.clientId, clientId)),
      orderBy: [desc(googleChangeEvents.changedAt)],
      limit: 100,
    })
    const internal = await db
      .select({ audit: auditEvents, approval: approvalRequests })
      .from(auditEvents)
      .innerJoin(approvalRequests, and(
        sql`${approvalRequests.id}::text = ${auditEvents.entityId}`,
        eq(approvalRequests.workspaceId, auditEvents.workspaceId),
      ))
      .where(and(
        eq(auditEvents.workspaceId, workspaceId),
        eq(approvalRequests.clientId, clientId),
      ))
      .orderBy(desc(auditEvents.createdAt))
      .limit(100)
    return { changes, internal }
  })
}

export async function listMonitoringAgents(workspaceId: string) {
  return tenantRead(workspaceId, (db) => db
    .select({ agent: monitoringAgents, client: clients })
    .from(monitoringAgents)
    .leftJoin(clients, eq(clients.id, monitoringAgents.clientId))
    .where(eq(monitoringAgents.workspaceId, workspaceId))
    .orderBy(desc(monitoringAgents.createdAt)))
}

export async function getClientAlertSummary(workspaceId: string, clientId: string): Promise<ClientAlertSummary> {
  return tenantRead(workspaceId, async (db) => {
    const [summary] = await db.select({
      openCount: count(),
      criticalCount: sql<number>`count(*) filter (where ${alertIncidents.severity} = 'critical')`.mapWith(Number),
    }).from(alertIncidents).where(and(
      eq(alertIncidents.workspaceId, workspaceId), eq(alertIncidents.clientId, clientId),
      inArray(alertIncidents.status, ['open', 'reopened']),
    ))
    return { clientId, ...summary }
  })
}

export async function getMyTaskNotificationPreferences(workspaceId: string, authUserId: string) {
  return tenantRead(workspaceId, (db) => db.query.memberNotificationPreferences.findFirst({
    where: and(
      eq(memberNotificationPreferences.workspaceId, workspaceId),
      eq(memberNotificationPreferences.authUserId, authUserId),
    ),
    columns: {
      id: true,
      mentionHandle: true,
      displayName: true,
      mentionNotifications: true,
      digestCadence: true,
      digestHour: true,
      timezone: true,
      lastDigestAt: true,
      lastError: true,
    },
  }))
}

export async function listTaskMentionDirectory(workspaceId: string) {
  return tenantRead(workspaceId, (db) => db.query.memberNotificationPreferences.findMany({
    where: eq(memberNotificationPreferences.workspaceId, workspaceId),
    columns: { mentionHandle: true, displayName: true, mentionNotifications: true },
    orderBy: [memberNotificationPreferences.displayName],
  }))
}

export async function listShareLinks(workspaceId: string) {
  return tenantRead(workspaceId, (db) => db
    .select({ share: shareLinks, client: clients })
    .from(shareLinks)
    .innerJoin(clients, and(eq(clients.id, shareLinks.clientId), eq(clients.workspaceId, workspaceId)))
    .where(eq(shareLinks.workspaceId, workspaceId))
    .orderBy(desc(shareLinks.createdAt)))
}

export async function listReportAutomation(workspaceId: string) {
  return tenantRead(workspaceId, async (db) => {
    const templates = await db.query.reportTemplates.findMany({
      where: and(eq(reportTemplates.workspaceId, workspaceId), eq(reportTemplates.active, true)),
      orderBy: [reportTemplates.name],
    })
    const schedules = await db.select({
        schedule: {
          id: reportSchedules.id,
          clientId: reportSchedules.clientId,
          templateId: reportSchedules.templateId,
          shareId: reportSchedules.shareId,
          name: reportSchedules.name,
          cadence: reportSchedules.cadence,
          scheduleWeekday: reportSchedules.scheduleWeekday,
          scheduleMonthday: reportSchedules.scheduleMonthday,
          sendHour: reportSchedules.sendHour,
          timezone: reportSchedules.timezone,
          recipientEmails: reportSchedules.recipientEmails,
          enabled: reportSchedules.enabled,
          lastRunKey: reportSchedules.lastRunKey,
          lastDeliveredAt: reportSchedules.lastDeliveredAt,
          lastError: reportSchedules.lastError,
          createdAt: reportSchedules.createdAt,
        },
        client: { id: clients.id, name: clients.name },
        template: { id: reportTemplates.id, name: reportTemplates.name },
      })
        .from(reportSchedules)
        .innerJoin(clients, and(eq(clients.id, reportSchedules.clientId), eq(clients.workspaceId, workspaceId)))
        .leftJoin(reportTemplates, and(eq(reportTemplates.id, reportSchedules.templateId), eq(reportTemplates.workspaceId, workspaceId)))
        .where(eq(reportSchedules.workspaceId, workspaceId))
        .orderBy(desc(reportSchedules.createdAt))
    return { templates, schedules }
  })
}

export async function listPublicClientApprovals(workspaceId: string, clientId: string, shareId: string) {
  return tenantRead(workspaceId, (db) => db
    .select({ request: approvalRequests, feedback: clientApprovalFeedback })
    .from(approvalRequests)
    .leftJoin(
      clientApprovalFeedback,
      and(
        eq(clientApprovalFeedback.approvalId, approvalRequests.id),
        eq(clientApprovalFeedback.shareId, shareId),
      ),
    )
    .where(
      and(
        eq(approvalRequests.workspaceId, workspaceId),
        eq(approvalRequests.clientId, clientId),
        eq(approvalRequests.status, 'pending'),
      ),
    )
    .orderBy(desc(approvalRequests.createdAt)))
}

export async function listApiKeys(workspaceId: string) {
  return tenantRead(workspaceId, (db) => db.query.apiKeys.findMany({
    where: and(eq(apiKeys.workspaceId, workspaceId), isNull(apiKeys.revokedAt)),
    orderBy: [desc(apiKeys.createdAt)],
  }))
}

export async function listNotificationChannels(workspaceId: string) {
  return tenantRead(workspaceId, (db) => db.query.notificationChannels.findMany({
    where: and(eq(notificationChannels.workspaceId, workspaceId), eq(notificationChannels.enabled, true)),
    orderBy: [desc(notificationChannels.createdAt)],
  }))
}

export async function getWorkspaceSafetyPolicy(workspaceId: string) {
  return tenantRead(workspaceId, (db) => db.query.safetyPolicies.findFirst({
    where: and(
      eq(safetyPolicies.workspaceId, workspaceId),
      isNull(safetyPolicies.clientId),
      isNull(safetyPolicies.campaignId),
      eq(safetyPolicies.enabled, true),
    ),
  }))
}

export async function listWorkspaceSafetyPolicies(workspaceId: string) {
  return tenantRead(workspaceId, (db) => db.query.safetyPolicies.findMany({
    where: and(eq(safetyPolicies.workspaceId, workspaceId), eq(safetyPolicies.enabled, true)),
    orderBy: [safetyPolicies.createdAt],
  }))
}

export async function getVerifiedReportRecipient(workspaceId: string, shareId: string) {
  const sessionToken = (await cookies()).get('yodev_report_feedback_session')?.value
  if (!sessionToken) return undefined
  return tenantRead(workspaceId, (db) => db.query.reportRecipients.findFirst({
    where: and(
      eq(reportRecipients.workspaceId, workspaceId),
      eq(reportRecipients.shareId, shareId),
      eq(reportRecipients.sessionTokenHash, hashToken(sessionToken)),
      isNotNull(reportRecipients.verifiedAt),
      gt(reportRecipients.sessionExpiresAt, new Date()),
    ),
    columns: { id: true, email: true, verifiedAt: true },
  }))
}

export function getQualifiedAccountPerformance(workspaceId: string, clientId: string) {
  return tenantRead(workspaceId, async (db) => {
    const client = await db.query.clients.findFirst({ where: and(eq(clients.workspaceId, workspaceId), eq(clients.id, clientId), eq(clients.active, true), eq(clients.isManager, false)) })
    if (!client) throw new Error('Account performance is unavailable')
    const window = reportCalendarWindow({ period: '30', now: new Date(), timezone: client.timezone })
    const rows = await db.query.dailyAccountMetrics.findMany({ where: and(eq(dailyAccountMetrics.workspaceId, workspaceId), eq(dailyAccountMetrics.clientId, clientId),
      gte(dailyAccountMetrics.metricDate, window.from), lte(dailyAccountMetrics.metricDate, window.through)) })
    const coverage = metricCoverage({ window, timezone: client.timezone, currencyCode: client.currencyCode, rows })
    if (coverage.state !== 'complete') return { window, coverage, totals: null }
    const totals = rows.reduce((sum, row) => ({ cost: sum.cost + BigInt(row.costMicros), clicks: sum.clicks + BigInt(row.clicks), impressions: sum.impressions + BigInt(row.impressions), conversions: sum.conversions + Number(row.conversions) }),
      { cost: BigInt(0), clicks: BigInt(0), impressions: BigInt(0), conversions: 0 })
    return { window, coverage, totals: { cost: totals.cost.toString(), clicks: totals.clicks.toString(), impressions: totals.impressions.toString(), conversions: totals.conversions } }
  })
}

export async function getClientGoalAndPacing(workspaceId: string, clientId: string, timezone: string) {
  return tenantRead(workspaceId, async (db) => {
    const goal = await db.query.clientGoals.findFirst({
      where: and(eq(clientGoals.workspaceId, workspaceId), eq(clientGoals.clientId, clientId)),
    })
    if (!goal) return { goal: undefined, pacing: undefined }
    const currentCalendar = pacingCalendar(new Date(), timezone)
    const calendar = { ...currentCalendar, through: shiftCalendarDate(currentCalendar.through, -1), elapsedDays: currentCalendar.elapsedDays - 1 }
    const [metrics] = await db.select({ observedDays: count(), spendMicros: sum(dailyAccountMetrics.costMicros) })
      .from(dailyAccountMetrics)
      .where(and(
        eq(dailyAccountMetrics.workspaceId, workspaceId),
        eq(dailyAccountMetrics.clientId, clientId),
        eq(dailyAccountMetrics.timezone, timezone),
        eq(dailyAccountMetrics.coverageStatus, 'complete'),
        isNotNull(dailyAccountMetrics.sourceVersion),
        gte(dailyAccountMetrics.metricDate, calendar.from),
        lte(dailyAccountMetrics.metricDate, calendar.through),
      ))
    const pacing = computePacing({
      monthlyBudgetMicros: Number(goal.monthlyBudgetMicros),
      actualSpendMicros: Number(metrics.spendMicros ?? 0),
      elapsedDays: calendar.elapsedDays,
      daysInMonth: calendar.daysInMonth,
      observedDays: metrics.observedDays,
    })
    return { goal, pacing, calendar, observedDays: metrics.observedDays }
  })
}
