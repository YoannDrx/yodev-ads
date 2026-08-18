import { beforeEach, describe, expect, it, vi } from 'vitest'
import { databaseDouble } from '../../test/fluent-db'

const mocks = vi.hoisted(() => ({
  databases: [] as unknown[],
  transaction: vi.fn(async (callback: (db: unknown) => unknown) => callback(mocks.databases.shift())),
  jobs: [] as Array<Record<string, unknown>>,
  claimNextJob: vi.fn(), completeJob: vi.fn(), enqueueJob: vi.fn(), enqueueJobs: vi.fn(), failJob: vi.fn(),
  runMonitoring: vi.fn(), weeklyDigest: vi.fn(), retryNotification: vi.fn(), dispatchNotifications: vi.fn(),
  reconcile: vi.fn(), observeMutation: vi.fn(), purgeWorkspace: vi.fn(), runExport: vi.fn(), deleteExports: vi.fn(),
  externalCleanup: vi.fn(), revokeGoogleConnection: vi.fn(), recordStripeCancellation: vi.fn(),
  scheduledReport: vi.fn(), taskMention: vi.fn(), taskDigest: vi.fn(), lifecycleEmail: vi.fn(), supportEmail: vi.fn(), operationsAlert: vi.fn(),
  subprocessorFanout: vi.fn(), subprocessorDelivery: vi.fn(),
  authInvitation: vi.fn(),
  stripeReconciliation: vi.fn(),
  startOperationalRun: vi.fn(), completeOperationalRun: vi.fn(), failOperationalRun: vi.fn(),
  rotateSecrets: vi.fn(), currentKid: vi.fn(),
  stripeUpdate: vi.fn(), featureEnabled: vi.fn(), reportRunKey: vi.fn(), digestRunKey: vi.fn(), trialDue: vi.fn(),
  deadLetterAlert: vi.fn(), redact: vi.fn((value: unknown) => value),
  listManagedCustomers: vi.fn(), dailyAccountMetrics: vi.fn(), dailyCampaignMetrics: vi.fn(), changeEvents: vi.fn(), conversionActions: vi.fn(), offlineDiagnostics: vi.fn(),
}))

vi.mock('@/db/transactions', () => ({ withSystemTransaction: mocks.transaction }))
vi.mock('@/lib/jobs', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/jobs')>(),
  claimNextJob: mocks.claimNextJob, completeJob: mocks.completeJob, enqueueJob: mocks.enqueueJob,
  enqueueJobs: mocks.enqueueJobs, failJob: mocks.failJob,
}))
vi.mock('@/lib/notifications', () => ({
  dispatchIncidentNotifications: mocks.dispatchNotifications,
  dispatchWeeklyDigest: mocks.weeklyDigest,
  retryNotificationDelivery: mocks.retryNotification,
}))
vi.mock('@/lib/reconcile-google-mutation', () => ({ reconcileGoogleMutation: mocks.reconcile }))
vi.mock('@/lib/run-monitoring', () => ({ runWorkspaceMonitoring: mocks.runMonitoring }))
vi.mock('@/lib/workspace-deletion', () => ({
  purgeWorkspace: mocks.purgeWorkspace,
  runWorkspaceExternalCleanup: mocks.externalCleanup,
  revokeWorkspaceGoogleConnection: mocks.revokeGoogleConnection,
  recordWorkspaceDeletionStripeCancellation: mocks.recordStripeCancellation,
}))
vi.mock('@/lib/workspace-export', () => ({ runWorkspaceExport: mocks.runExport, deleteExpiredExportArtifacts: mocks.deleteExports }))
vi.mock('@/lib/scheduled-reports', () => ({ deliverScheduledReport: mocks.scheduledReport }))
vi.mock('@/lib/task-notifications', () => ({ deliverTaskMention: mocks.taskMention, deliverPersonalTaskDigest: mocks.taskDigest }))
vi.mock('@/lib/lifecycle-emails', () => ({ deliverLifecycleEmail: mocks.lifecycleEmail }))
vi.mock('@/lib/support-notifications', () => ({ deliverSupportEmail: mocks.supportEmail }))
vi.mock('@/lib/subprocessor-change-notifications', () => ({
  fanOutSubprocessorChangeNotice: mocks.subprocessorFanout,
  deliverSubprocessorChangeNotice: mocks.subprocessorDelivery,
}))
vi.mock('@/lib/auth-invitations', () => ({ deliverAuthInvitation: mocks.authInvitation }))
vi.mock('@/lib/stripe-reconciliation', () => ({ reconcileStripeWorkspace: mocks.stripeReconciliation }))
vi.mock('@/lib/operational-runs', () => ({
  startOperationalRun: mocks.startOperationalRun,
  completeOperationalRun: mocks.completeOperationalRun,
  failOperationalRun: mocks.failOperationalRun,
}))
vi.mock('@/lib/operations-alerts', () => ({ deliverOperationsAlert: mocks.operationsAlert }))
vi.mock('@/lib/mutation-observations', () => ({ completeMutationObservation: mocks.observeMutation }))
vi.mock('@/lib/billing', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/billing')>(),
  getStripe: () => ({ subscriptions: { update: mocks.stripeUpdate } }),
}))
vi.mock('@/lib/feature-flags', () => ({ featureEnabled: mocks.featureEnabled }))
vi.mock('@/lib/report-scheduling', () => ({ reportScheduleRunKey: mocks.reportRunKey }))
vi.mock('@/lib/task-notification-model', () => ({ taskDigestRunKey: mocks.digestRunKey }))
vi.mock('@/lib/lifecycle-email-model', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/lifecycle-email-model')>(), trialLifecycleDue: mocks.trialDue,
}))
vi.mock('@/lib/operations-alert-model', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/operations-alert-model')>(), operationsAlertJobForDeadLetter: mocks.deadLetterAlert,
}))
vi.mock('@/lib/sentry-redaction', () => ({ redactSensitiveData: mocks.redact }))
vi.mock('@/lib/crypto', () => ({ currentEncryptionKeyId: mocks.currentKid }))
vi.mock('@/lib/secret-rotation', () => ({ rotateWorkspaceSecrets: mocks.rotateSecrets }))
vi.mock('@/lib/pacing', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/pacing')>(),
  pacingCalendar: () => ({ from: '2026-08-01', through: '2026-08-12', year: 2026, month: 8 }),
}))
vi.mock('@/lib/google-ads', () => ({
  GoogleAdsGateway: class {
    listManagedCustomers = mocks.listManagedCustomers
    dailyAccountMetrics = mocks.dailyAccountMetrics
    dailyCampaignMetrics = mocks.dailyCampaignMetrics
    changeEvents = mocks.changeEvents
    conversionActions = mocks.conversionActions
    offlineConversionDiagnostics = mocks.offlineDiagnostics
  },
}))

import { runAvailableJobs, seedScheduledJobs } from './job-runner'

const workspaceId = '00000000-0000-4000-8000-000000000001'
const clientId = '00000000-0000-4000-8000-000000000002'
const entityId = '00000000-0000-4000-8000-000000000003'

function job(type: string, payload: Record<string, unknown>, overrides: Record<string, unknown> = {}) {
  return {
    id: `00000000-0000-4000-8000-${String(job.sequence++).padStart(12, '0')}`,
    workspaceId, type, payload, priority: 10, status: 'running', availableAt: new Date(), leaseOwner: 'worker',
    leaseExpiresAt: new Date(Date.now() + 60_000), attemptCount: 1, maximumAttempts: 5,
    deduplicationKey: `${type}:${job.sequence}`, lastError: null, deadLetteredAt: null, completedAt: null,
    createdAt: new Date(), updatedAt: new Date(), ...overrides,
  }
}
job.sequence = 100

function googleQueryDouble(input: { client?: unknown; connection?: unknown; approvals?: unknown[]; audit?: unknown[] } = {}) {
  return {
    clients: { findFirst: vi.fn(async () => input.client) },
    googleAdsConnections: { findFirst: vi.fn(async () => input.connection) },
    approvalRequests: { findMany: vi.fn(async () => input.approvals ?? []) },
    auditEvents: { findMany: vi.fn(async () => input.audit ?? []) },
  }
}

const client = {
  id: clientId, workspaceId, googleCustomerId: '1234567890', timezone: 'Europe/Paris', currencyCode: 'EUR', active: true,
}
const connection = { id: 'connection', workspaceId, status: 'active', encryptedRefreshToken: 'cipher', managerCustomerId: '9999999999' }

describe('durable job runner orchestration', () => {
  beforeEach(() => {
    mocks.databases = []
    mocks.jobs = []
    vi.clearAllMocks()
    job.sequence = 100
    mocks.featureEnabled.mockReturnValue(true)
    mocks.currentKid.mockReturnValue(null)
    mocks.claimNextJob.mockImplementation(async () => mocks.jobs.shift() ?? null)
    mocks.completeJob.mockResolvedValue(true)
    mocks.failJob.mockResolvedValue({ updated: true, deadLettered: false, nextAttemptAt: new Date() })
    mocks.enqueueJobs.mockImplementation(async (items: unknown[]) => ({ requested: items.length, created: items.length }))
    mocks.retryNotification.mockResolvedValue('delivered')
    mocks.deleteExports.mockResolvedValue({ deleted: 0 })
    mocks.reportRunKey.mockReturnValue('2026-08-10')
    mocks.digestRunKey.mockReturnValue('2026-08-10')
    mocks.trialDue.mockReturnValue([])
    mocks.deadLetterAlert.mockReturnValue(null)
    for (const method of [
      mocks.runMonitoring, mocks.weeklyDigest, mocks.reconcile, mocks.observeMutation, mocks.purgeWorkspace,
      mocks.runExport, mocks.scheduledReport, mocks.taskMention, mocks.taskDigest, mocks.lifecycleEmail,
      mocks.supportEmail, mocks.operationsAlert, mocks.dispatchNotifications, mocks.stripeUpdate,
      mocks.rotateSecrets, mocks.subprocessorFanout, mocks.subprocessorDelivery, mocks.authInvitation,
      mocks.stripeReconciliation, mocks.externalCleanup, mocks.revokeGoogleConnection,
      mocks.recordStripeCancellation, mocks.startOperationalRun, mocks.completeOperationalRun, mocks.failOperationalRun,
    ]) method.mockResolvedValue({ ok: true })
    mocks.stripeUpdate.mockResolvedValue({ status: 'active', cancel_at_period_end: true })
    mocks.dailyAccountMetrics.mockResolvedValue([])
    mocks.listManagedCustomers.mockResolvedValue([])
    mocks.dailyCampaignMetrics.mockResolvedValue([])
    mocks.changeEvents.mockResolvedValue([])
    mocks.conversionActions.mockResolvedValue([])
    mocks.offlineDiagnostics.mockResolvedValue([])
  })

  it('dispatches every non-sync job contract and records completion', async () => {
    const jobs = [
      job('auth.invitation_deliver', { invitationId: entityId, workspaceId }),
      job('monitoring.scan', { workspaceId }),
      job('monitoring.weekly_digest', { workspaceId }),
      job('report.schedule_deliver', { scheduleId: entityId, runKey: '2026-08-10' }),
      job('task.mention_deliver', { commentId: entityId, preferenceId: clientId }),
      job('task.personal_digest', { preferenceId: entityId, runKey: '2026-08-10' }),
      job('lifecycle.email', { workspaceId, kind: 'welcome', referenceKey: 'trial-1', effectiveAt: '2026-08-12T10:00:00.000Z' }),
      job('support.email', { ticketId: entityId, kind: 'new_ticket', referenceKey: 'ticket-1', messageId: null }),
      job('subprocessor.notice_fanout', { noticeId: entityId }, { workspaceId: null }),
      job('subprocessor.notice_deliver', { noticeId: entityId, workspaceId }),
      job('operations.alert', { kind: 'mutation_ambiguous', sourceId: 'approval-1', title: 'Mutation ambiguë', description: 'À vérifier' }),
      job('google.mutation.reconcile', { approvalId: entityId }),
      job('mutation.observe', { observationId: entityId }),
      job('notification.deliver', { deliveryId: entityId }),
      job('workspace.purge', { workspaceId }),
      job('workspace.external_cleanup', { workspaceHash: 'a'.repeat(64), logoUrl: null, hostnames: [] }, { workspaceId: null }),
      job('google.revoke_connection', { workspaceId }, { workspaceId: null }),
      job('workspace.export', { workspaceId, exportJobId: entityId }),
      job('stripe.cancel_subscription', { workspaceId, subscriptionId: 'sub_123' }, { workspaceId: null }),
      job('stripe.reconcile', { workspaceId }),
      job('secrets.rotate', { workspaceId, targetKid: 'kid-2' }),
    ]
    mocks.currentKid.mockReturnValue('kid-2')
    mocks.jobs.push(...jobs)
    const result = await runAvailableJobs({ workerId: 'worker', maximumJobs: 25 })
    expect(result.processed).toBe(jobs.length)
    expect(result.results.every((item) => item.status === 'completed')).toBe(true)
    expect(mocks.completeJob).toHaveBeenCalledTimes(jobs.length)
    expect(mocks.runMonitoring).toHaveBeenCalledWith(workspaceId)
    expect(mocks.authInvitation).toHaveBeenCalledWith({ invitationId: entityId, workspaceId })
    expect(mocks.lifecycleEmail).toHaveBeenCalledWith(expect.objectContaining({ effectiveAt: new Date('2026-08-12T10:00:00.000Z') }))
    expect(mocks.stripeUpdate).toHaveBeenCalledWith('sub_123', { cancel_at_period_end: true })
    expect(mocks.recordStripeCancellation).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId, subscriptionId: 'sub_123', state: 'confirmed',
    }))
    expect(mocks.externalCleanup).toHaveBeenCalledOnce()
    expect(mocks.revokeGoogleConnection).toHaveBeenCalledWith(workspaceId)
    expect(mocks.stripeReconciliation).toHaveBeenCalledWith(workspaceId, expect.any(Object))
    expect(mocks.rotateSecrets).toHaveBeenCalledWith(workspaceId)
  })

  it('excludes notification jobs when the notification kill switch is off', async () => {
    mocks.featureEnabled.mockReturnValue(false)
    await runAvailableJobs({ workerId: 'worker', maximumJobs: 1 })
    expect(mocks.claimNextJob).toHaveBeenCalledWith('worker', expect.any(Date), undefined, expect.arrayContaining(['notification.deliver']))
  })

  it('applies notification retry semantics and non-retryable dead-letter semantics', async () => {
    mocks.retryNotification.mockResolvedValueOnce('retrying').mockResolvedValueOnce('dead_letter')
    const retry = job('notification.deliver', { deliveryId: entityId })
    const terminal = job('notification.deliver', { deliveryId: entityId })
    const unsupported = job('unsupported', {})
    mocks.jobs.push(retry, terminal, unsupported)
    mocks.failJob
      .mockResolvedValueOnce({ updated: true, deadLettered: false })
      .mockResolvedValueOnce({ updated: true, deadLettered: true })
      .mockResolvedValueOnce({ updated: true, deadLettered: true })
    await expect(runAvailableJobs({ workerId: 'worker', maximumJobs: 3 })).resolves.toMatchObject({
      processed: 3,
      results: [{ status: 'retrying' }, { status: 'dead_letter' }, { status: 'dead_letter' }],
    })
    expect(mocks.failJob).toHaveBeenNthCalledWith(1, retry, 'worker', expect.any(Error), expect.objectContaining({ retryAttemptOffset: 1, forceDeadLetter: false }))
    expect(mocks.failJob).toHaveBeenNthCalledWith(2, terminal, 'worker', expect.any(Error), expect.objectContaining({ retryAttemptOffset: 1, forceDeadLetter: true }))
    expect(mocks.failJob).toHaveBeenNthCalledWith(3, unsupported, 'worker', expect.any(Error), expect.objectContaining({ forceDeadLetter: true }))
  })

  it('safely skips a queued rotation that no longer targets the current key', async () => {
    const rotation = job('secrets.rotate', { workspaceId, targetKid: 'retired-kid' })
    mocks.jobs.push(rotation)
    mocks.currentKid.mockReturnValue('current-kid')
    await expect(runAvailableJobs({ workerId: 'worker', maximumJobs: 1 })).resolves.toMatchObject({ results: [{ status: 'completed' }] })
    expect(mocks.rotateSecrets).not.toHaveBeenCalled()
    expect(mocks.failJob).not.toHaveBeenCalled()
  })

  it('alerts operations and the tenant when a critical tenant job dead-letters', async () => {
    const failed = job('monitoring.scan', { workspaceId }, { attemptCount: 5 })
    mocks.jobs.push(failed)
    mocks.runMonitoring.mockRejectedValue(new Error('refresh_token=secret'))
    mocks.failJob.mockResolvedValue({ updated: true, deadLettered: true })
    mocks.redact.mockReturnValue('refresh_token=[REDACTED]')
    mocks.deadLetterAlert.mockReturnValue({ type: 'operations.alert', deduplicationKey: 'ops:1' })
    await runAvailableJobs({ workerId: 'worker', maximumJobs: 1 })
    expect(mocks.enqueueJob).toHaveBeenCalledWith(expect.objectContaining({ type: 'operations.alert' }))
    expect(mocks.dispatchNotifications).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId, severity: 'critical', description: 'refresh_token=[REDACTED]',
    }))
  })

  it('syncs account and campaign daily metrics with idempotent persistence', async () => {
    const metricJob = job('metrics.daily_sync', { workspaceId, clientId })
    mocks.jobs.push(metricJob)
    const contextDb = databaseDouble({ statementResults: [[client], [connection]] })
    const persistence = databaseDouble()
    mocks.databases.push(contextDb.db, persistence.db)
    mocks.dailyAccountMetrics.mockResolvedValue([{ date: '2026-08-12', costMicros: '100', impressions: '10', clicks: '2', conversions: 1.5, conversionValue: 12.5 }])
    mocks.dailyCampaignMetrics.mockResolvedValue([{ campaignId: '1', date: '2026-08-12', campaignName: 'Brand', campaignType: 'SEARCH', status: 'ENABLED', costMicros: '100', impressions: '10', clicks: '2', conversions: 1.5, conversionValue: 12.5 }])
    const result = await runAvailableJobs({ workerId: 'worker', maximumJobs: 1 })
    expect(result.results[0].status).toBe('completed')
    expect(mocks.dailyAccountMetrics).toHaveBeenCalledWith(client.googleCustomerId, '2026-08-01', '2026-08-12')
    expect(persistence.capture.values).toHaveLength(2)
    expect(persistence.capture.values[0]).toMatchObject({ conversionValueMicros: '12500000', currencyCode: 'EUR' })
  })

  it('refreshes the complete Google account inventory after a billing plan change', async () => {
    mocks.jobs.push(job('google.accounts_sync', { workspaceId }))
    const contextDb = databaseDouble({ statementResults: [
      [{ plan: 'solo', accessState: 'active' }],
      [connection],
    ] })
    const persistence = databaseDouble()
    mocks.databases.push(contextDb.db, persistence.db)
    mocks.listManagedCustomers.mockResolvedValue([
      { customerId: '1000000000', name: 'Manager', currencyCode: 'EUR', timezone: 'Europe/Paris', isManager: true },
      { customerId: '2000000000', name: 'A', currencyCode: 'EUR', timezone: 'Europe/Paris', isManager: false },
      { customerId: '3000000000', name: 'B', currencyCode: 'EUR', timezone: 'Europe/Paris', isManager: false },
      { customerId: '4000000000', name: 'C', currencyCode: 'EUR', timezone: 'Europe/Paris', isManager: false },
      { customerId: '5000000000', name: 'D', currencyCode: 'EUR', timezone: 'Europe/Paris', isManager: false },
    ])
    const result = await runAvailableJobs({ workerId: 'worker', maximumJobs: 1 })
    expect(result.results[0].status).toBe('completed')
    expect(mocks.listManagedCustomers).toHaveBeenCalledOnce()
    expect(persistence.capture.values.slice(0, 5)).toEqual(expect.arrayContaining([
      expect.objectContaining({ googleCustomerId: '1000000000', active: true }),
      expect.objectContaining({ googleCustomerId: '4000000000', active: true }),
      expect.objectContaining({ googleCustomerId: '5000000000', active: false }),
    ]))
    expect(persistence.capture.values.at(-1)).toMatchObject({
      action: 'google_ads.accounts_synced_after_plan_change',
      metadata: expect.objectContaining({ advertiserLimit: 3, excludedCount: 1 }),
    })
  })

  it('dead-letters metric sync when its tenant context no longer exists', async () => {
    const metricJob = job('metrics.daily_sync', { workspaceId, clientId })
    mocks.jobs.push(metricJob)
    mocks.databases.push(databaseDouble({ statementResults: [[], [connection]] }).db)
    mocks.failJob.mockResolvedValue({ updated: true, deadLettered: true })
    await runAvailableJobs({ workerId: 'worker', maximumJobs: 1 })
    expect(mocks.failJob).toHaveBeenCalledWith(metricJob, 'worker', expect.any(Error), expect.objectContaining({ forceDeadLetter: true }))
  })

  it('synchronizes Google change events and correlates internal approval audit', async () => {
    const changedAt = new Date('2026-08-12T10:00:00Z')
    const change = {
      resourceName: 'change/1', changedResourceName: 'campaign/1', changedAt, changedBy: 'user@example.test',
      clientType: 'GOOGLE_ADS_WEB_CLIENT', resourceType: 'CAMPAIGN', operation: 'UPDATE', changedFields: ['status'],
      oldResource: { status: 'ENABLED' }, newResource: { status: 'PAUSED' },
    }
    mocks.jobs.push(job('google.change_sync', { workspaceId, clientId }))
    mocks.databases.push(
      databaseDouble({ query: googleQueryDouble({ client, connection }) }).db,
      databaseDouble({ query: googleQueryDouble({
        approvals: [{ id: 'approval-1', resourceName: 'campaign/1', executedAt: changedAt }],
        audit: [{ id: 'audit-1', entityId: 'approval-1' }],
      }) }).db,
    )
    mocks.changeEvents.mockResolvedValue([change])
    const result = await runAvailableJobs({ workerId: 'worker', maximumJobs: 1 })
    expect(result.results[0].status).toBe('completed')
    expect(mocks.changeEvents).toHaveBeenCalledOnce()
  })

  it('synchronizes conversion actions and offline diagnostics', async () => {
    mocks.jobs.push(job('conversion.actions_sync', { workspaceId, clientId }))
    const persistence = databaseDouble()
    mocks.databases.push(databaseDouble({ query: googleQueryDouble({ client, connection }) }).db, persistence.db)
    mocks.conversionActions.mockResolvedValue([{
      resourceName: 'conversion/1', name: 'Purchase', status: 'ENABLED', category: 'PURCHASE', origin: 'WEBSITE',
      actionType: 'WEBPAGE', primaryForGoal: true, includeInConversionsMetric: true,
      lastActivityAt: new Date(), lastConversionAt: new Date(), lastReceivedAt: new Date(),
    }])
    mocks.offlineDiagnostics.mockResolvedValue([{
      uploadClient: 'GOOGLE_ADS_API', status: 'SUCCESS', lastUploadAt: new Date(), totalEventCount: '2',
      successfulEventCount: '2', pendingEventCount: '0', successRate: 1, alerts: [],
    }])
    await runAvailableJobs({ workerId: 'worker', maximumJobs: 1 })
    expect(persistence.capture.values).toHaveLength(2)
    expect(persistence.capture.values[1]).toMatchObject({ successRate: '1', uploadClient: 'GOOGLE_ADS_API' })
  })

  it('applies all retention windows and includes expired export artifacts', async () => {
    mocks.jobs.push(job('retention.run', {}, { workspaceId: null }))
    mocks.deleteExports.mockResolvedValue({ expired: 3 })
    const retentionDb = databaseDouble()
    mocks.databases.push(retentionDb.db)
    const result = await runAvailableJobs({ workerId: 'worker', maximumJobs: 1 })
    expect(result.results[0].status).toBe('completed')
    expect(mocks.deleteExports).toHaveBeenCalledOnce()
  })

  it('seeds every due scheduler family with deterministic deduplication', async () => {
    const now = new Date('2026-08-10T08:00:00Z')
    const trialStartedAt = new Date('2026-08-03T08:00:00Z')
    const trialEndsAt = new Date('2026-08-17T08:00:00Z')
    mocks.trialDue.mockReturnValue(['welcome', 'trial_day_7'])
    mocks.currentKid.mockReturnValue('kid-2')
    const schedulerDb = databaseDouble({ statementResults: [
      [{ workspaceId, timezone: 'Europe/Paris' }, { workspaceId, timezone: 'Europe/Paris' }],
      [{ approvalId: entityId, workspaceId }],
      [{ workspaceId, purgeAt: new Date('2026-08-09T00:00:00Z') }],
      [{ workspaceId, clientId, timezone: 'Europe/Paris' }],
      [{ exportJobId: entityId, workspaceId }],
      [{ id: entityId, workspaceId, cadence: 'weekly', scheduleWeekday: 1, scheduleMonthday: null, sendHour: 8, timezone: 'Europe/Paris', lastRunKey: null }],
      [{ id: clientId, workspaceId, cadence: 'daily', digestHour: 8, timezone: 'Europe/Paris', lastDigestKey: null }],
      [{ id: workspaceId, accessState: 'trial', trialStartedAt, trialEndsAt }],
      [{ workspaceId }],
      [{ id: entityId }],
      [{ workspaceId }],
    ] })
    mocks.databases.push(schedulerDb.db)
    await seedScheduledJobs(now)
    const [pending] = mocks.enqueueJobs.mock.calls[0] as [Array<{ type: string; deduplicationKey: string }>]
    expect(new Set(pending.map((item) => item.type))).toEqual(new Set([
      'retention.run', 'lifecycle.email', 'monitoring.scan', 'monitoring.weekly_digest', 'report.schedule_deliver',
      'task.personal_digest', 'metrics.daily_sync', 'google.change_sync', 'conversion.actions_sync',
      'google.mutation.reconcile', 'workspace.purge', 'workspace.export',
      'secrets.rotate', 'subprocessor.notice_fanout', 'stripe.reconcile',
    ]))
    expect(pending).toContainEqual(expect.objectContaining({
      type: 'secrets.rotate',
      deduplicationKey: `secrets.rotate:${workspaceId}:kid-2`,
    }))
    expect(pending.every((item) => item.deduplicationKey.length > 5)).toBe(true)
  })
})
