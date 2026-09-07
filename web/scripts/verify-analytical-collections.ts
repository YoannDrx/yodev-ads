import assert from 'node:assert/strict'
import { eq } from 'drizzle-orm'
import { analyticalCollections, auditEvents, clients, googleAdsConnections, jobs, workspaces } from '../src/db/schema'
import { withSystemTransaction, withTenantTransaction } from '../src/db/transactions'
import { analyticalCollectionJobs, collectAnalyticalFamily, getAnalyticalCollections, persistAnalyticalCollection, requestAnalyticalRefresh } from '../src/lib/analytical-collections'
import { analyticalSnapshotData, analyticalSnapshotState } from '../src/lib/analytical-model'

const url = new URL(process.env.DATABASE_SYSTEM_URL ?? '')
assert(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && url.pathname.startsWith('/yodev_test'), 'Disposable local database required')
const workspaceId = '73000000-0000-4000-8000-000000000001'
const foreignId = '73000000-0000-4000-8000-000000000002'
const owner = 'analytical-fixture'
// No transport may run in this fixture, even while testing enqueue permissions.
globalThis.fetch = async () => { throw new Error('Provider calls are forbidden in this local fixture') }

async function main() {
  for (const id of [workspaceId, foreignId]) await withSystemTransaction((db) => db.delete(workspaces).where(eq(workspaces.id, id)))
  await withSystemTransaction((db) => db.insert(workspaces).values([workspaceId, foreignId].map((id) => ({ id, ownerUserId: owner, name: 'Analytical fixture', slug: `analytical-${id}`, plan: 'internal', accessState: 'internal' }))))
  try {
    const [client] = await withSystemTransaction((db) => db.insert(clients).values({ workspaceId, googleCustomerId: '7300000000', name: 'Analysis', timezone: 'Europe/Paris', currencyCode: 'EUR' }).returning())
    const [connection] = await withSystemTransaction((db) => db.insert(googleAdsConnections).values({ workspaceId, managerCustomerId: '7300000001', encryptedRefreshToken: 'not-a-real-token', connectedBy: owner }).returning())
    const now = new Date()
    const planned = analyticalCollectionJobs({ workspaceId, clientId: client.id, timezone: client.timezone, currencyCode: client.currencyCode, generation: 'fixture', now })
    async function newJob() {
      const [job] = await withSystemTransaction((db) => db.insert(jobs).values({ ...planned[0], deduplicationKey: null, status: 'running', attemptCount: 1, leaseOwner: owner, leaseExpiresAt: new Date(Date.now() + 5 * 60_000) }).returning())
      return job
    }
    assert.equal((await getAnalyticalCollections(workspaceId, client.id)).snapshots.length, 0)
    const job = await newJob()
    const input = { job, connectionId: connection.id, observedAt: new Date(now.getTime() - 1_000), payload: [{ id: '42', name: 'Stored fixture campaign' }], requestIds: ['fixture-request'] }
    const concurrent = await Promise.all([persistAnalyticalCollection(input), persistAnalyticalCollection(input)])
    assert.deepEqual(concurrent[0], concurrent[1])
    const loaded = await getAnalyticalCollections(workspaceId, client.id)
    assert.equal(loaded.snapshots.length, 1)
    assert.deepEqual(analyticalSnapshotData(loaded.snapshots, 'campaigns', client), input.payload)
    assert.equal(analyticalSnapshotState(loaded.snapshots[0], client), 'available')
    assert.equal(loaded.attempts.length, 1)
    const audits = await withSystemTransaction((db) => db.query.auditEvents.findMany({ where: eq(auditEvents.workspaceId, workspaceId) }))
    assert.equal(audits.filter((audit) => audit.action === 'analytics.collected').length, 1)
    const resumed = await collectAnalyticalFamily(job)
    assert.deepEqual(resumed, concurrent[0], 'Persisted checkpoint bypasses all provider calls')
    const older = await persistAnalyticalCollection({ ...input, job: await newJob(), observedAt: new Date(now.getTime() - 60_000), payload: [] })
    assert.equal((older as { stored: boolean }).stored, false)
    const oversizeJob = await newJob()
    await assert.rejects(persistAnalyticalCollection({ ...input, job: oversizeJob, observedAt: new Date(), payload: ['X'.repeat(2_100_000)] }))
    assert.equal((await getAnalyticalCollections(workspaceId, client.id)).snapshots[0].sourceVersion, job.id)
    const unchanged = await withSystemTransaction((db) => db.query.jobs.findFirst({ where: eq(jobs.id, oversizeJob.id) }))
    assert.equal(unchanged?.payload.analyticalResult, undefined)
    await assert.rejects(getAnalyticalCollections(foreignId, client.id), /unavailable/)
    const foreignRows = await withTenantTransaction({ workspaceId: foreignId, userId: owner }, (db) => db.query.analyticalCollections.findMany({ where: eq(analyticalCollections.clientId, client.id) }))
    assert.equal(foreignRows.length, 0)
    await assert.rejects(withTenantTransaction({ workspaceId, userId: owner }, (db) => db.insert(analyticalCollections).values({ ...loaded.snapshots[0], id: undefined })), /permission denied|Failed query/)
    await withSystemTransaction((db) => db.update(jobs).set({ attemptCount: 2 }).where(eq(jobs.id, job.id)))
    await assert.rejects(persistAnalyticalCollection(input), /lease lost/)
    await withSystemTransaction((db) => db.update(workspaces).set({ accessState: 'grace' }).where(eq(workspaces.id, workspaceId)))
    assert.equal((await getAnalyticalCollections(workspaceId, client.id)).snapshots.length, 1)
    await assert.rejects(persistAnalyticalCollection({ ...input, job: await newJob() }))
    await withSystemTransaction((db) => db.update(workspaces).set({ accessState: 'suspended' }).where(eq(workspaces.id, workspaceId)))
    await assert.rejects(getAnalyticalCollections(workspaceId, client.id), /unavailable/)
    await withSystemTransaction((db) => db.update(workspaces).set({ accessState: 'internal' }).where(eq(workspaces.id, workspaceId)))
    await withSystemTransaction((db) => db.update(googleAdsConnections).set({ status: 'revoked' }).where(eq(googleAdsConnections.id, connection.id)))
    assert.equal((await getAnalyticalCollections(workspaceId, client.id)).snapshots.length, 1)
    await assert.rejects(persistAnalyticalCollection({ ...input, job: await newJob() }), /changed during collection/)
    await withSystemTransaction((db) => db.update(googleAdsConnections).set({ status: 'active' }).where(eq(googleAdsConnections.id, connection.id)))
    await withSystemTransaction((db) => db.delete(jobs).where(eq(jobs.workspaceId, workspaceId)))
    process.env.GOOGLE_READS_ENABLED = '1'
    process.env.SCHEDULER_ENABLED = '1'
    const refreshes = await Promise.all([1, 2, 3].map(() => requestAnalyticalRefresh({ workspaceId, clientId: client.id, actorUserId: owner })))
    assert.equal(refreshes.filter((refresh) => refresh.created).length, 1)
    const queued = await withSystemTransaction((db) => db.query.jobs.findMany({ where: eq(jobs.workspaceId, workspaceId) }))
    assert.equal(queued.length, 18)
    await withSystemTransaction((db) => db.update(jobs).set({ status: 'completed' }).where(eq(jobs.workspaceId, workspaceId)))
    assert.equal((await requestAnalyticalRefresh({ workspaceId, clientId: client.id, actorUserId: owner })).reason, 'recent')
    await withSystemTransaction((db) => db.update(clients).set({ active: false }).where(eq(clients.id, client.id)))
    await assert.rejects(getAnalyticalCollections(workspaceId, client.id), /unavailable/)
    await assert.rejects(requestAnalyticalRefresh({ workspaceId, clientId: client.id, actorUserId: owner }), /required/)
    await withSystemTransaction((db) => db.delete(clients).where(eq(clients.id, client.id)))
    assert.equal((await withSystemTransaction((db) => db.query.analyticalCollections.findMany({ where: eq(analyticalCollections.clientId, client.id) }))).length, 0)
    console.log(JSON.stringify({ ok: true, verified: ['cold_and_warm_persisted_read', 'concurrent_snapshot_checkpoint', 'resume_without_provider', 'older_read_preserves_newer_value', 'failed_write_preserves_snapshot_and_checkpoint', 'tenant_rls_and_read_only_app', 'expired_worker_rejected', 'grace_read_without_refresh', 'suspension_and_deactivation_deny_cached_read', 'revoked_connection_retains_history_without_new_write', 'deduplicated_refresh_and_cost_cooldown', 'client_deletion_cascades_cache'], providerCalls: 0 }))
  } finally {
    for (const id of [workspaceId, foreignId]) await withSystemTransaction((db) => db.delete(workspaces).where(eq(workspaces.id, id)))
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
