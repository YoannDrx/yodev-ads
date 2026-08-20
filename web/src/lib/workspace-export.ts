import 'server-only'

import { createHash } from 'node:crypto'
import { del, put } from '@vercel/blob'
import { and, eq, inArray, lt } from 'drizzle-orm'
import { strToU8, zipSync } from 'fflate'
import {
  alertComments,
  alertIncidents,
  activationMilestones,
  apiKeys,
  approvalComments,
  approvalRequests,
  approvalVotes,
  auditEvents,
  clientApprovalFeedback,
  clientGoals,
  clients,
  conversionActionSnapshots,
  dailyAccountMetrics,
  dailyCampaignMetrics,
  exportJobs,
  googleAdsConnections,
  googleChangeEvents,
  legalAcceptances,
  monitoringAgents,
  memberNotificationPreferences,
  mutationExecutions,
  mutationObservations,
  notificationChannels,
  offlineConversionDiagnostics,
  performanceSnapshots,
  reportSchedules,
  reportTemplates,
  reportTemplateVersions,
  safetyPolicies,
  shareLinks,
  supportMessages,
  supportTickets,
  taskComments,
  workspaceTasks,
  workspaces,
} from '@/db/schema'
import { withSystemTransaction } from '@/db/transactions'

function csvCell(value: unknown) {
  if (value === null || value === undefined) return ''
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value)
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

export function rowsToCsv(rows: Array<Record<string, unknown>>, columns?: string[]) {
  const headers = columns ?? [...new Set(rows.flatMap((row) => Object.keys(row)))]
  return [headers.join(','), ...rows.map((row) => headers.map((header) => csvCell(row[header])).join(','))].join('\r\n')
}

export function exportArchive(files: Record<string, string>) {
  return zipSync(
    Object.fromEntries(Object.entries(files).map(([name, contents]) => [name, strToU8(contents)])),
    { level: 6 },
  )
}

async function collectWorkspaceExport(workspaceId: string) {
  return withSystemTransaction(async (db) => {
    const workspace = await db.query.workspaces.findFirst({
      where: eq(workspaces.id, workspaceId),
      columns: {
        id: true,
        name: true,
        slug: true,
        brandName: true,
        brandTagline: true,
        accentColor: true,
        logoUrl: true,
        approvalMode: true,
        requiredApprovals: true,
        allowSelfApproval: true,
        plan: true,
        accessState: true,
        locale: true,
        timezone: true,
        countryCode: true,
        billingEmail: true,
        billingLegalName: true,
        notificationEmail: true,
        maximumDailyBudgetMicros: true,
        maximumMonthlySpendMicros: true,
        trialStartedAt: true,
        trialEndsAt: true,
        graceEndsAt: true,
        deletionRequestedAt: true,
        purgeAt: true,
        createdAt: true,
        updatedAt: true,
      },
    })
    if (!workspace) throw new Error('Workspace export target not found')

    const connection = await db.query.googleAdsConnections.findFirst({
      where: eq(googleAdsConnections.workspaceId, workspaceId),
      columns: {
        id: true,
        managerCustomerId: true,
        googleEmail: true,
        scopes: true,
        status: true,
        connectedBy: true,
        lastSuccessfulUseAt: true,
        createdAt: true,
        updatedAt: true,
      },
    })
    const workspaceClients = await db.query.clients.findMany({ where: eq(clients.workspaceId, workspaceId) })
    const goals = await db.query.clientGoals.findMany({ where: eq(clientGoals.workspaceId, workspaceId) })
    const monitors = await db.query.monitoringAgents.findMany({ where: eq(monitoringAgents.workspaceId, workspaceId) })
    const alerts = await db.query.alertIncidents.findMany({ where: eq(alertIncidents.workspaceId, workspaceId) })
    const activation = await db.query.activationMilestones.findMany({ where: eq(activationMilestones.workspaceId, workspaceId) })
    const alertNotes = await db.query.alertComments.findMany({ where: eq(alertComments.workspaceId, workspaceId) })
    const tasks = await db.query.workspaceTasks.findMany({ where: eq(workspaceTasks.workspaceId, workspaceId) })
    const taskNotes = await db.query.taskComments.findMany({ where: eq(taskComments.workspaceId, workspaceId) })
    const support = await db.query.supportTickets.findMany({ where: eq(supportTickets.workspaceId, workspaceId) })
    const supportConversation = await db.query.supportMessages.findMany({
      where: and(eq(supportMessages.workspaceId, workspaceId), eq(supportMessages.internal, false)),
    })
    const memberPreferences = await db.query.memberNotificationPreferences.findMany({
      where: eq(memberNotificationPreferences.workspaceId, workspaceId),
      columns: {
        id: true,
        authUserId: true,
        mentionHandle: true,
        displayName: true,
        mentionNotifications: true,
        digestCadence: true,
        digestHour: true,
        timezone: true,
        lastDigestKey: true,
        lastDigestAt: true,
        lastError: true,
        createdAt: true,
        updatedAt: true,
      },
    })
    const approvals = await db.query.approvalRequests.findMany({ where: eq(approvalRequests.workspaceId, workspaceId) })
    const votes = await db.query.approvalVotes.findMany({ where: eq(approvalVotes.workspaceId, workspaceId) })
    const approvalNotes = await db.query.approvalComments.findMany({ where: eq(approvalComments.workspaceId, workspaceId) })
    const clientFeedback = await db.query.clientApprovalFeedback.findMany({ where: eq(clientApprovalFeedback.workspaceId, workspaceId) })
    const executions = await db.query.mutationExecutions.findMany({ where: eq(mutationExecutions.workspaceId, workspaceId) })
    const observations = await db.query.mutationObservations.findMany({ where: eq(mutationObservations.workspaceId, workspaceId) })
    const audit = await db.query.auditEvents.findMany({ where: eq(auditEvents.workspaceId, workspaceId) })
    const accountMetrics = await db.query.dailyAccountMetrics.findMany({ where: eq(dailyAccountMetrics.workspaceId, workspaceId) })
    const campaignMetrics = await db.query.dailyCampaignMetrics.findMany({ where: eq(dailyCampaignMetrics.workspaceId, workspaceId) })
    const legacyPerformance = await db.query.performanceSnapshots.findMany({ where: eq(performanceSnapshots.workspaceId, workspaceId) })
    const changes = await db.query.googleChangeEvents.findMany({ where: eq(googleChangeEvents.workspaceId, workspaceId) })
    const conversions = await db.query.conversionActionSnapshots.findMany({ where: eq(conversionActionSnapshots.workspaceId, workspaceId) })
    const offlineDiagnostics = await db.query.offlineConversionDiagnostics.findMany({ where: eq(offlineConversionDiagnostics.workspaceId, workspaceId) })
    const policies = await db.query.safetyPolicies.findMany({ where: eq(safetyPolicies.workspaceId, workspaceId) })
    const reports = await db.query.shareLinks.findMany({
      where: eq(shareLinks.workspaceId, workspaceId),
      columns: {
        id: true,
        clientId: true,
        createdBy: true,
        tokenPrefix: true,
        label: true,
        active: true,
        allowFeedback: true,
        expiresAt: true,
        lastViewedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    })
    const reportTemplateRows = await db.query.reportTemplates.findMany({ where: eq(reportTemplates.workspaceId, workspaceId) })
    const reportTemplateVersionRows = await db.query.reportTemplateVersions.findMany({ where: eq(reportTemplateVersions.workspaceId, workspaceId) })
    const reportScheduleRows = await db.query.reportSchedules.findMany({
      where: eq(reportSchedules.workspaceId, workspaceId),
      columns: {
        id: true,
        clientId: true,
        templateId: true,
        shareId: true,
        createdBy: true,
        name: true,
        cadence: true,
        scheduleWeekday: true,
        scheduleMonthday: true,
        sendHour: true,
        timezone: true,
        recipientEmails: true,
        enabled: true,
        lastRunKey: true,
        lastDeliveredAt: true,
        lastError: true,
        createdAt: true,
        updatedAt: true,
      },
    })
    const keys = await db.query.apiKeys.findMany({
      where: eq(apiKeys.workspaceId, workspaceId),
      columns: {
        id: true,
        createdBy: true,
        name: true,
        tokenPrefix: true,
        scopes: true,
        expiresAt: true,
        rotatedAt: true,
        lastUsedAt: true,
        revokedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    })
    const channels = await db.query.notificationChannels.findMany({
      where: eq(notificationChannels.workspaceId, workspaceId),
      columns: {
        id: true,
        createdBy: true,
        kind: true,
        label: true,
        destinationHint: true,
        minimumSeverity: true,
        enabled: true,
        lastDeliveredAt: true,
        lastError: true,
        createdAt: true,
        updatedAt: true,
      },
    })
    const legal = await db.query.legalAcceptances.findMany({ where: eq(legalAcceptances.workspaceId, workspaceId) })

    return {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      workspace,
      googleAdsConnection: connection ?? null,
      clients: workspaceClients,
      clientGoals: goals,
      monitoringAgents: monitors,
      alerts,
      activationMilestones: activation,
      alertComments: alertNotes,
      tasks,
      taskComments: taskNotes,
      supportTickets: support,
      supportMessages: supportConversation,
      memberNotificationPreferences: memberPreferences,
      approvals,
      approvalVotes: votes,
      approvalComments: approvalNotes,
      clientApprovalFeedback: clientFeedback,
      mutationExecutions: executions,
      mutationObservations: observations,
      auditEvents: audit,
      dailyAccountMetrics: accountMetrics,
      dailyCampaignMetrics: campaignMetrics,
      legacyPerformanceSnapshots: legacyPerformance,
      googleChangeEvents: changes,
      conversionActionSnapshots: conversions,
      offlineConversionDiagnostics: offlineDiagnostics,
      safetyPolicies: policies,
      reports,
      reportTemplates: reportTemplateRows,
      reportTemplateVersions: reportTemplateVersionRows,
      reportSchedules: reportScheduleRows,
      apiKeys: keys,
      notificationChannels: channels,
      legalAcceptances: legal,
    }
  })
}

export async function runWorkspaceExport(exportJobId: string, workspaceId: string) {
  const claimed = await withSystemTransaction(async (db) => {
    const [row] = await db
      .update(exportJobs)
      .set({ status: 'processing', progress: 5, errorMessage: null, updatedAt: new Date() })
      .where(and(
        eq(exportJobs.id, exportJobId),
        eq(exportJobs.workspaceId, workspaceId),
        inArray(exportJobs.status, ['queued', 'failed']),
      ))
      .returning({ id: exportJobs.id, workspaceId: exportJobs.workspaceId })
    return row
  })
  if (!claimed || claimed.workspaceId !== workspaceId) throw new Error('Export job is unavailable')

  try {
    const data = await collectWorkspaceExport(workspaceId)
    await withSystemTransaction((db) => db
      .update(exportJobs)
      .set({ progress: 55, updatedAt: new Date() })
      .where(eq(exportJobs.id, exportJobId)))
    const files = {
      'raw.json': `${JSON.stringify(data, null, 2)}\n`,
      'clients.csv': rowsToCsv(data.clients),
      'performance/daily-accounts.csv': rowsToCsv(data.dailyAccountMetrics),
      'performance/daily-campaigns.csv': rowsToCsv(data.dailyCampaignMetrics),
      'tracking/offline-conversion-diagnostics.csv': rowsToCsv(data.offlineConversionDiagnostics),
      'approvals.csv': rowsToCsv(data.approvals),
      'approvals/observations.csv': rowsToCsv(data.mutationObservations),
      'audit.csv': rowsToCsv(data.auditEvents),
      'alerts.csv': rowsToCsv(data.alerts),
      'activation-milestones.csv': rowsToCsv(data.activationMilestones),
      'tasks.csv': rowsToCsv(data.tasks),
      'task-comments.csv': rowsToCsv(data.taskComments),
      'support/tickets.csv': rowsToCsv(data.supportTickets),
      'support/messages.csv': rowsToCsv(data.supportMessages),
      'task-notification-preferences.csv': rowsToCsv(data.memberNotificationPreferences),
      'reports/templates.csv': rowsToCsv(data.reportTemplates),
      'reports/template-versions.csv': rowsToCsv(data.reportTemplateVersions),
      'reports/schedules.csv': rowsToCsv(data.reportSchedules),
      'README.txt': 'Export Ads by Yodev. Les secrets OAuth, clés API complètes, tokens de rapport et destinations de notification sont volontairement exclus.\n',
    }
    const archive = exportArchive(files)
    const artifactHash = createHash('sha256').update(archive).digest('hex')
    const pathname = `exports/${workspaceId}/${exportJobId}.zip`
    const blob = await put(pathname, Buffer.from(archive), {
      access: 'private',
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: 'application/zip',
      cacheControlMaxAge: 60,
    })
    const completedAt = new Date()
    const expiresAt = new Date(completedAt.getTime() + 7 * 24 * 60 * 60_000)
    await withSystemTransaction((db) => db
      .update(exportJobs)
      .set({
        status: 'completed',
        progress: 100,
        artifactKey: blob.pathname,
        artifactHash,
        expiresAt,
        completedAt,
        errorMessage: null,
        updatedAt: completedAt,
      })
      .where(eq(exportJobs.id, exportJobId)))
    return { exportJobId, bytes: archive.byteLength, artifactHash, expiresAt }
  } catch (error) {
    await withSystemTransaction((db) => db
      .update(exportJobs)
      .set({
        status: 'failed',
        errorMessage: (error instanceof Error ? error.message : String(error)).slice(0, 2000),
        updatedAt: new Date(),
      })
      .where(eq(exportJobs.id, exportJobId)))
    throw error
  }
}

export async function deleteExpiredExportArtifacts(now = new Date()) {
  const expired = await withSystemTransaction((db) => db
    .select({ id: exportJobs.id, artifactKey: exportJobs.artifactKey })
    .from(exportJobs)
    .where(lt(exportJobs.expiresAt, now)))
  for (const artifact of expired) {
    if (artifact.artifactKey) await del(artifact.artifactKey)
  }
  if (expired.length > 0) {
    await withSystemTransaction((db) => db
      .update(exportJobs)
      .set({ status: 'expired', artifactKey: null, artifactHash: null, updatedAt: now })
      .where(inArray(exportJobs.id, expired.map((artifact) => artifact.id))))
  }
  return { expired: expired.length }
}
