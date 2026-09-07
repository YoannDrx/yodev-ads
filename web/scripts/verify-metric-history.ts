import assert from 'node:assert/strict'
import { and, eq } from 'drizzle-orm'
import { clients, dailyAccountMetrics, dailyCampaignMetrics, jobs, workspaces } from '../src/db/schema'
import { withSystemTransaction } from '../src/db/transactions'
import { accountCalendarDate, shiftCalendarDate } from '../src/lib/calendar-window'
import { normalizeMetricSyncData } from '../src/lib/metric-sync-data'
import { persistMetricSyncChunk } from '../src/lib/metrics-sync'
import { aggregateMutationObservationMetrics } from '../src/lib/mutation-observations'

const url = new URL(process.env.DATABASE_SYSTEM_URL ?? '')
assert(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && url.pathname.startsWith('/yodev_test'), 'Disposable local database required')
const workspaceId = '72000000-0000-4000-8000-000000000001'
const owner = 'metric-history-fixture'

async function main() {
  await withSystemTransaction((db) => db.delete(workspaces).where(eq(workspaces.id, workspaceId)))
  await withSystemTransaction((db) => db.insert(workspaces).values({ id: workspaceId, ownerUserId: owner, name: 'Metric history fixture', slug: 'metric-history-fixture', plan: 'internal', accessState: 'internal' }))
  try {
    const [client] = await withSystemTransaction((db) => db.insert(clients).values({ workspaceId, googleCustomerId: '7200000000', name: 'History', currencyCode: 'EUR', timezone: 'Europe/Paris' }).returning())
    const today = accountCalendarDate(new Date(), client.timezone)
    const window = { from: shiftCalendarDate(today, -3), through: today }
    const observedAt = new Date(Date.now() - 60_000)
    const account = { date: window.from, costMicros: '100', impressions: '10', clicks: '2', conversions: 1, conversionValue: 10 }
    const campaign = { ...account, campaignId: '42', campaignName: 'Removed campaign', campaignType: 'SEARCH', status: 'REMOVED' }
    const dataset = normalizeMetricSyncData({ window, today, complete: true, accounts: [account], campaigns: [campaign] })
    async function newJob() {
      const [job] = await withSystemTransaction((db) => db.insert(jobs).values({ workspaceId, type: 'metrics.sync_chunk', status: 'running', attemptCount: 1, leaseOwner: owner,
        leaseExpiresAt: new Date(Date.now() + 5 * 60_000), payload: { workspaceId, clientId: client.id, parentJobId: workspaceId, timezone: client.timezone, window },
      }).returning())
      return job
    }
    const job = await newJob()
    const input = { job, clientId: client.id, timezone: client.timezone, currencyCode: client.currencyCode, observedAt, window, dataset }
    // Pre-migration rows are intentionally unqualified until collected again.
    await withSystemTransaction((db) => db.insert(dailyAccountMetrics).values({ workspaceId, clientId: client.id, metricDate: window.from, currencyCode: 'EUR', costMicros: '999' }))
    const legacy = await withSystemTransaction((db) => db.query.dailyAccountMetrics.findFirst({ where: eq(dailyAccountMetrics.clientId, client.id) }))
    assert.equal(legacy?.coverageStatus, 'legacy')
    await withSystemTransaction((db) => db.insert(dailyCampaignMetrics).values({ workspaceId, clientId: client.id, campaignId: '99', campaignName: 'Now zero', metricDate: window.from, currencyCode: 'EUR', costMicros: '999' }))
    const concurrent = await Promise.all([persistMetricSyncChunk(input), persistMetricSyncChunk(input)])
    assert.deepEqual(concurrent[0], concurrent[1])
    assert.equal(concurrent[0].accountDays, 4)
    let accounts = await withSystemTransaction((db) => db.query.dailyAccountMetrics.findMany({ where: eq(dailyAccountMetrics.clientId, client.id), orderBy: dailyAccountMetrics.metricDate }))
    assert.equal(accounts.length, 4)
    assert.equal(accounts[0].costMicros, '100')
    assert.equal(accounts[0].timezone, client.timezone)
    assert.equal(accounts[0].coverageStatus, 'complete')
    assert.equal(accounts[1].costMicros, '0')
    assert.equal(accounts[1].accountRows, 0)
    assert.equal(accounts[1].coverageStatus, 'complete')
    assert.equal(accounts[3].coverageStatus, 'partial')
    const zeroed = await withSystemTransaction((db) => db.query.dailyCampaignMetrics.findFirst({ where: and(eq(dailyCampaignMetrics.clientId, client.id), eq(dailyCampaignMetrics.campaignId, '99')) }))
    assert.equal(zeroed?.costMicros, '0', 'A complete unfiltered response replaces omitted segmented zero rows without deleting their identity')
    const removed = await withSystemTransaction((db) => db.query.dailyCampaignMetrics.findFirst({ where: and(eq(dailyCampaignMetrics.clientId, client.id), eq(dailyCampaignMetrics.campaignId, '42')) }))
    assert.equal(removed?.status, 'REMOVED')

    // Late conversions update the past while an older overlapping read cannot
    // replace the newer values, even when the older job finishes afterwards.
    const lateJob = await newJob()
    const lateDataset = normalizeMetricSyncData({ window, today, complete: true, accounts: [{ ...account, conversions: 2 }], campaigns: [{ ...campaign, conversions: 2 }] })
    await persistMetricSyncChunk({ ...input, job: lateJob, dataset: lateDataset, observedAt: new Date(observedAt.getTime() + 30_000) })
    const olderResult = await persistMetricSyncChunk({ ...input, job: await newJob() })
    assert.equal(olderResult.ignoredOlderDays, 4)
    accounts = await withSystemTransaction((db) => db.query.dailyAccountMetrics.findMany({ where: eq(dailyAccountMetrics.clientId, client.id), orderBy: dailyAccountMetrics.metricDate }))
    assert.equal(Number(accounts[0].conversions), 2)
    assert.equal(accounts[0].sourceVersion, lateJob.id)

    const rollbackJob = await newJob()
    const invalidDataset = normalizeMetricSyncData({ window, today, complete: true, accounts: [{ ...account, costMicros: '555' }], campaigns: [{ ...campaign, campaignName: 'X'.repeat(221) }] })
    await assert.rejects(persistMetricSyncChunk({ ...input, job: rollbackJob, dataset: invalidDataset, observedAt: new Date() }))
    const afterRollback = await withSystemTransaction((db) => db.query.dailyAccountMetrics.findFirst({ where: and(eq(dailyAccountMetrics.clientId, client.id), eq(dailyAccountMetrics.metricDate, window.from)) }))
    assert.equal(afterRollback?.costMicros, '100')
    assert.equal(afterRollback?.sourceVersion, lateJob.id)
    const incompleteJob = await withSystemTransaction((db) => db.query.jobs.findFirst({ where: eq(jobs.id, rollbackJob.id) }))
    assert.equal(incompleteJob?.payload.metricSyncResult, undefined)

    await withSystemTransaction((db) => db.update(jobs).set({ attemptCount: 2 }).where(eq(jobs.id, job.id)))
    await assert.rejects(persistMetricSyncChunk(input), /lease lost/)
    const resumed = await persistMetricSyncChunk({ ...input, job: { ...job, attemptCount: 2 } })
    assert.deepEqual(resumed, concurrent[0])
    const wrongScope = await newJob()
    await assert.rejects(persistMetricSyncChunk({ ...input, job: wrongScope, clientId: workspaceId }), /outside its job scope/)
    const coveredObservation = await withSystemTransaction((db) => aggregateMutationObservationMetrics(db, { workspaceId, clientId: client.id, campaignIds: ['42', '99'], from: window.from, through: shiftCalendarDate(today, -1), windowDays: 3 }))
    assert.equal(coveredObservation.coverageVersion, 1)
    assert.equal(coveredObservation.dataPoints, 6, 'Covered all-zero campaign days count as known data, even when Google omitted the row')
    assert.equal(Number(coveredObservation.conversions), 2)
    const partialObservation = await withSystemTransaction((db) => aggregateMutationObservationMetrics(db, { workspaceId, clientId: client.id, campaignIds: ['42'], from: window.from, through: today, windowDays: 4 }))
    assert.equal(partialObservation.dataPoints, 3)
    assert.equal(partialObservation.expectedDataPoints, 4)
    await withSystemTransaction((db) => db.update(clients).set({ timezone: 'UTC' }).where(eq(clients.id, client.id)))
    const changedTimezoneObservation = await withSystemTransaction((db) => aggregateMutationObservationMetrics(db, { workspaceId, clientId: client.id, campaignIds: ['42'], from: window.from, through: today, windowDays: 4 }))
    assert.equal(changedTimezoneObservation.dataPoints, 0)
    await withSystemTransaction((db) => db.update(clients).set({ timezone: client.timezone }).where(eq(clients.id, client.id)))
    await withSystemTransaction((db) => db.update(clients).set({ active: false }).where(eq(clients.id, client.id)))
    await assert.rejects(persistMetricSyncChunk({ ...input, job: await newJob() }), /context changed/)
    console.log(JSON.stringify({ ok: true, verified: ['legacy_coverage_not_certified', 'covered_zero_vs_partial_day', 'removed_campaign_history_retained', 'concurrent_chunk_idempotence', 'late_conversion_reconciliation', 'older_read_does_not_overwrite', 'atomic_metric_rollback_and_checkpoint', 'resume_without_rewriting', 'expired_attempt_and_foreign_scope_rejected', 'deactivated_client_rejected', 'qualified_zero_campaign_observations', 'partial_days_and_timezone_mismatch_excluded'], providerCalls: 0 }))
  } finally {
    await withSystemTransaction((db) => db.delete(workspaces).where(eq(workspaces.id, workspaceId)))
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
