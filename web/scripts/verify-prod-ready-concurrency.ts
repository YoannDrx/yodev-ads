import assert from 'node:assert/strict'
import { fork } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { and, count, eq } from 'drizzle-orm'
import { alertIncidents, clients, jobAttempts, jobs, monitoringAgents, notificationChannels, notificationDeliveries, workspaces } from '../src/db/schema'
import { withSystemTransaction } from '../src/db/transactions'
import { entitlementContext } from '../src/lib/entitlements'
import { claimNextJob, completeJob, enqueueJob, recoverExpiredJobs, type ClaimedJob } from '../src/lib/jobs'
import { createWorkspaceMonitoringAgent, requestWorkspaceMonitoringScan, setWorkspaceMonitoringAgentEnabled } from '../src/lib/monitoring-workflows'
import { fanOutMonitoringScan } from '../src/lib/monitoring-scan-jobs'
import { deliverAlertReminder, pendingAlertReminderJobs } from '../src/lib/alert-reminders'
import { retryNotificationDelivery } from '../src/lib/notifications'
import { alertReminderEventKey } from '../src/lib/alert-reminder-plan'

const url = new URL(process.env.DATABASE_SYSTEM_URL ?? '')
assert(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && url.pathname.startsWith('/yodev_test'), 'Disposable local database required')
const workspaceId = '70000000-0000-4000-8000-000000000001'
const actorUserId = 'prod-ready-fixture-owner'
let recoveryAlertKey: string | undefined

async function main() {
  if (process.argv.includes('--crash-worker')) {
    const job = await claimNextJob('crashed-worker', new Date(), 100)
    process.send?.(job)
    setInterval(() => {}, 1_000)
    return
  }
  await withSystemTransaction((db) => db.delete(workspaces).where(eq(workspaces.id, workspaceId)))
  await withSystemTransaction((db) => db.insert(workspaces).values({ id: workspaceId, ownerUserId: actorUserId, name: 'Prod ready fixture', slug: 'prod-ready-fixture', plan: 'solo', accessState: 'active' }))
  try {
    const agents = await withSystemTransaction((db) => db.insert(monitoringAgents).values(Array.from({ length: 5 }, (_, index) => ({
      workspaceId, createdBy: actorUserId, name: `Fixture ${index}`, description: 'Disposable', kind: 'no_delivery', threshold: '0', enabled: index < 4,
    }))).returning())
    const transitions = await Promise.allSettled([
      createWorkspaceMonitoringAgent({ workspaceId, actorUserId, clientId: null, kind: 'no_delivery', name: 'Concurrent', description: 'Disposable', threshold: 0, reminderIntervalHours: null, entitlements: entitlementContext('active', 'agency') }),
      setWorkspaceMonitoringAgentEnabled({ workspaceId, actorUserId, agentId: agents[4].id, enabled: true }),
    ])
    assert.equal(transitions.filter((result) => result.status === 'fulfilled').length, 1, 'Only one transition may consume the last slot')
    const [usage] = await withSystemTransaction((db) => db.select({ count: count() }).from(monitoringAgents).where(and(eq(monitoringAgents.workspaceId, workspaceId), eq(monitoringAgents.enabled, true))))
    assert.equal(usage.count, 5)

    const { job } = await enqueueJob({ workspaceId, type: 'monitoring.scan', maximumAttempts: 1, priority: -10000, deduplicationKey: `prod-ready:crash:${Date.now()}` })
    const child = fork(fileURLToPath(import.meta.url), ['--crash-worker'], {
      execArgv: ['--conditions=react-server', '--import', 'tsx'], stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
    })
    const claimed = await new Promise<ClaimedJob>((resolve, reject) => {
      const timeout = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Worker did not claim within 30 seconds')) }, 30_000)
      child.once('error', (error) => { clearTimeout(timeout); reject(error) })
      child.once('message', (value) => { clearTimeout(timeout); resolve(value as ClaimedJob) })
    })
    await new Promise<void>((resolve) => { child.once('exit', () => resolve()); child.kill('SIGKILL') })
    assert.equal(claimed.id, job.id)
    // An expired retryable attempt must not be reclaimed before its previous
    // attempt is closed and audited by recovery.
    const retryable = await enqueueJob({ workspaceId, type: 'monitoring.scan', maximumAttempts: 2, priority: -9999, deduplicationKey: `prod-ready:retryable:${Date.now()}` })
    const retryableClaim = await claimNextJob('expired-retryable', new Date(), 1)
    assert.equal(retryableClaim?.id, retryable.job.id)
    const now = new Date(Date.now() + 1_000)
    assert.equal(await claimNextJob('must-not-bypass-recovery', now), null)
    recoveryAlertKey = `operations.alert:job_dead_letter:${job.id}`
    const recovery = await Promise.all([recoverExpiredJobs(now), recoverExpiredJobs(now)])
    assert.equal(recovery.reduce((sum, item) => sum + item.deadLettered, 0), 1)
    assert.equal(await completeJob(claimed, 'crashed-worker', now), false)
    const evidence = await withSystemTransaction(async (db) => ({
      job: await db.query.jobs.findFirst({ where: eq(jobs.id, job.id) }),
      attempt: await db.query.jobAttempts.findFirst({ where: eq(jobAttempts.jobId, job.id) }),
    }))
    assert.equal(evidence.job?.status, 'dead_letter')
    assert.equal(evidence.attempt?.state, 'dead_letter')
    const recoveredAttempt = await withSystemTransaction((db) => db.query.jobAttempts.findFirst({ where: eq(jobAttempts.jobId, retryable.job.id) }))
    assert.equal(recoveredAttempt?.state, 'failed')
    const alertEvidence = await withSystemTransaction((db) => db.query.jobs.findMany({ where: eq(jobs.deduplicationKey, recoveryAlertKey!) }))
    assert.equal(alertEvidence.length, 1, 'Terminal recovery must enqueue exactly one durable operational alert')
    assert.equal(alertEvidence[0].type, 'operations.alert')
    const resumed = await claimNextJob('resumed-worker', now, 1_000, ['operations.alert'])
    assert.equal(resumed?.id, retryable.job.id)
    assert.equal(resumed?.attemptCount, 2)
    assert.equal(await completeJob(resumed!, 'resumed-worker', now), true)

    // These flags authorize only queue/fixture operations here. No Google
    // worker executes, and the only notification channel is disabled.
    process.env.GOOGLE_READS_ENABLED = '1'
    process.env.SCHEDULER_ENABLED = '1'
    process.env.NOTIFICATIONS_ENABLED = '1'
    const accounts = await withSystemTransaction((db) => db.insert(clients).values([0, 1].map((index) => ({
      workspaceId, googleCustomerId: `700000000${index}`, name: `Fixture client ${index}`, currencyCode: 'EUR', timezone: 'Europe/Paris',
    }))).returning())
    const manual = await Promise.all([
      requestWorkspaceMonitoringScan({ workspaceId, actorUserId }), requestWorkspaceMonitoringScan({ workspaceId, actorUserId }),
    ])
    assert.equal(manual.filter((item) => item.created).length, 1)
    const parentJobId = manual.find((item) => item.created)!.jobId!
    const chunks = await Promise.all([
      fanOutMonitoringScan({ workspaceId, parentJobId }), fanOutMonitoringScan({ workspaceId, parentJobId }),
    ])
    assert.equal(chunks.reduce((sum, item) => sum + item.created, 0), 2)
    const storedChunks = await withSystemTransaction((db) => db.query.jobs.findMany({ where: and(eq(jobs.workspaceId, workspaceId), eq(jobs.type, 'monitoring.scan_chunk')) }))
    assert.equal(storedChunks.length, 2)
    assert.equal(new Set(storedChunks.map((item) => item.payload.clientId)).size, 2)

    const reminderNow = new Date()
    const createdAt = new Date(reminderNow.getTime() - 4 * 3_600_000)
    await withSystemTransaction((db) => db.update(monitoringAgents).set({ reminderIntervalHours: 4 }).where(eq(monitoringAgents.id, agents[0].id)))
    const [incident] = await withSystemTransaction((db) => db.insert(alertIncidents).values({
      workspaceId, agentId: agents[0].id, clientId: accounts[0].id, fingerprint: 'local-reminder', title: 'Local reminder', description: 'No external send', createdAt,
    }).returning())
    const reminder = (await pendingAlertReminderJobs(reminderNow)).find((item) => item.payload?.incidentId === incident.id)
    assert(reminder, 'A reminder must be due independently of the daily scan')
    const reminderInput = reminder.payload as { workspaceId: string; incidentId: string; dueAt: string }
    assert.equal((await deliverAlertReminder(reminderInput, reminderNow)).reason, 'not_accepted')
    const [channel] = await withSystemTransaction((db) => db.insert(notificationChannels).values({
      workspaceId, createdBy: actorUserId, kind: 'email', label: 'Disabled fixture', encryptedDestination: 'never-decrypted', destinationHint: 'fixture', enabled: false,
    }).returning())
    await withSystemTransaction((db) => db.insert(notificationDeliveries).values({
      workspaceId, channelId: channel.id, incidentId: incident.id, status: 'accepted', terminalAt: reminderNow,
      eventKey: alertReminderEventKey(incident.id, new Date(reminderInput.dueAt)),
    }))
    const accepted = await deliverAlertReminder(reminderInput, reminderNow)
    assert.equal(accepted.accepted, true)
    assert.equal((await deliverAlertReminder(reminderInput, reminderNow)).reason, 'stale')
    assert(!(await pendingAlertReminderJobs(reminderNow)).some((item) => item.payload?.incidentId === incident.id))
    // A resolved occurrence must cancel before decrypting this deliberately
    // unusable destination. Two workers contend for the same deferred delivery.
    const [queuedChannel] = await withSystemTransaction((db) => db.insert(notificationChannels).values({
      workspaceId, createdBy: actorUserId, kind: 'email', label: 'Cancellation fixture', encryptedDestination: 'never-decrypted', destinationHint: 'fixture', enabled: true,
    }).returning())
    await withSystemTransaction((db) => db.update(alertIncidents).set({ status: 'resolved' }).where(eq(alertIncidents.id, incident.id)))
    const eventKey = alertReminderEventKey(incident.id, new Date(reminderInput.dueAt))
    const [deferred] = await withSystemTransaction((db) => db.insert(notificationDeliveries).values({
      workspaceId, channelId: queuedChannel.id, incidentId: incident.id, status: 'retrying', eventKey,
      payload: { workspaceId, incidentId: incident.id, eventKey, severity: 'warning', title: 'Local', description: 'No send', clientName: 'Fixture' },
    }).returning())
    assert.deepEqual(await Promise.all([retryNotificationDelivery(deferred.id), retryNotificationDelivery(deferred.id)]), ['cancelled', 'cancelled'])
    const cancelled = await withSystemTransaction((db) => db.query.notificationDeliveries.findFirst({ where: eq(notificationDeliveries.id, deferred.id) }))
    assert.equal(cancelled?.status, 'cancelled')
    assert.equal(cancelled?.attemptCount, 1)
    assert.equal(cancelled?.providerMessageId, null)

    console.log(JSON.stringify({ ok: true, verified: ['monitor_quota_concurrent_create_reactivate', 'current_plan_under_lock', 'worker_sigkill_final_attempt', 'concurrent_lease_recovery', 'stale_worker_finalization_rejected', 'manual_scan_concurrency', 'fanout_concurrency_and_client_scope', 'independent_reminder_due_query', 'reminder_acceptance_recovery_without_send', 'stale_reminder_suppressed', 'deferred_reminder_cancelled_concurrently_before_transport', 'expired_retryable_attempt_audited_before_reclaim', 'terminal_recovery_alert_outbox'] }))
  } finally {
    if (recoveryAlertKey) await withSystemTransaction((db) => db.delete(jobs).where(eq(jobs.deduplicationKey, recoveryAlertKey!)))
    await withSystemTransaction((db) => db.delete(workspaces).where(eq(workspaces.id, workspaceId)))
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
