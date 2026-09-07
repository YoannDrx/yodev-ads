import assert from 'node:assert/strict'
import { Client } from 'pg'
import { and, count, eq, sql } from 'drizzle-orm'
import { alertIncidents, auditEvents, clients, jobs, monitoringAgents, notificationChannels, notificationDeliveries, workspaces } from '../src/db/schema'
import { withSystemTransaction } from '../src/db/transactions'
import { persistMonitoringObservation, readMonitoringProgress } from '../src/lib/monitoring-observations'

const url = new URL(process.env.DATABASE_SYSTEM_URL ?? '')
assert(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && url.pathname.startsWith('/yodev_test'), 'Disposable local database required')
const workspaceId = '71000000-0000-4000-8000-000000000001'
const owner = 'monitoring-checkpoint-fixture'
let sequence = 0
const observedAt = () => new Date(Date.now() + (++sequence) * 10)

async function main() {
  await withSystemTransaction((db) => db.delete(workspaces).where(eq(workspaces.id, workspaceId)))
  await withSystemTransaction((db) => db.insert(workspaces).values({ id: workspaceId, ownerUserId: owner, name: 'Checkpoint fixture', slug: 'checkpoint-fixture', plan: 'internal', accessState: 'internal' }))
  try {
    const [client, otherClient] = await withSystemTransaction((db) => db.insert(clients).values([0, 1].map((index) => ({ workspaceId, googleCustomerId: `710000000${index}`, name: `Fixture ${index}`, currencyCode: 'EUR', timezone: 'Europe/Paris' }))).returning())
    const agents = await withSystemTransaction((db) => db.insert(monitoringAgents).values([0, 1].map((index) => ({ workspaceId, createdBy: owner, name: `Rule ${index}`, description: 'Disposable', kind: 'no_delivery', threshold: '0', enabled: true }))).returning())
    await withSystemTransaction((db) => db.insert(notificationChannels).values({ workspaceId, createdBy: owner, kind: 'email', label: 'Queue only', encryptedDestination: 'never-decrypted', destinationHint: 'fixture', enabled: true }))
    const finding = { fingerprint: 'no-delivery:campaign-1', title: 'No delivery', description: 'Fixture only', severity: 'critical' as const, value: 0 }
    async function newClaim(clientId = client.id) {
      const [job] = await withSystemTransaction((db) => db.insert(jobs).values({ workspaceId, type: 'monitoring.scan_chunk', status: 'running', attemptCount: 1, leaseOwner: owner,
        leaseExpiresAt: new Date(Date.now() + 5 * 60_000), payload: { workspaceId, clientId, agentIds: agents.map((agent) => agent.id) },
      }).returning())
      return { jobId: job.id, workerId: owner, attempt: 1 }
    }
    const claim = await newClaim()
    const input = { workspaceId, claim, agent: agents[0], clientId: client.id, findings: [finding, finding], observedAt: observedAt() }
    const concurrent = await Promise.all([persistMonitoringObservation(input), persistMonitoringObservation(input)])
    assert.deepEqual(concurrent, [{ detected: 1, resolved: 0, queued: 1 }, { detected: 1, resolved: 0, queued: 1 }])
    let incidents = await withSystemTransaction((db) => db.query.alertIncidents.findMany({ where: eq(alertIncidents.workspaceId, workspaceId) }))
    assert.equal(incidents.length, 1)
    assert.equal(incidents[0].occurrenceCount, 1)
    assert.equal((await readMonitoringProgress(workspaceId, claim))[agents[0].id].queued, 1)
    // Simulate a process dying after the commit but before completing its job.
    await withSystemTransaction((db) => db.update(jobs).set({ attemptCount: 2 }).where(eq(jobs.id, claim.jobId)))
    await assert.rejects(persistMonitoringObservation(input), /lease lost/)
    await persistMonitoringObservation({ ...input, claim: { ...claim, attempt: 2 } })
    incidents = await withSystemTransaction((db) => db.query.alertIncidents.findMany({ where: eq(alertIncidents.workspaceId, workspaceId) }))
    assert.equal(incidents[0].occurrenceCount, 1)
    await persistMonitoringObservation({ ...input, claim: { ...claim, attempt: 2 }, agent: agents[1] })
    incidents = await withSystemTransaction((db) => db.query.alertIncidents.findMany({ where: eq(alertIncidents.workspaceId, workspaceId) }))
    assert.equal(incidents.length, 2, 'Two vigies with the same finding retain separate incidents')
    assert.equal(new Set(incidents.map((incident) => incident.agentId)).size, 2)

    const rollbackClaim = await newClaim()
    await assert.rejects(persistMonitoringObservation({ ...input, claim: rollbackClaim, findings: [
      { ...finding, fingerprint: 'atomic-first' }, { ...finding, fingerprint: 'atomic-invalid', title: 'X'.repeat(221) },
    ], observedAt: observedAt() }))
    assert.deepEqual(await readMonitoringProgress(workspaceId, rollbackClaim), {})
    const afterRollback = await withSystemTransaction((db) => db.query.alertIncidents.findMany({ where: eq(alertIncidents.workspaceId, workspaceId) }))
    assert.equal(afterRollback.length, 2, 'A later invalid finding rolls back earlier incidents and their outboxes')
    const [deliveryCount] = await withSystemTransaction((db) => db.select({ count: count() }).from(notificationDeliveries).where(eq(notificationDeliveries.workspaceId, workspaceId)))
    assert.equal(deliveryCount.count, 2)

    // Every reopen episode gets a distinct delivery identity; one older read
    // arriving after a newer clear observation must not resurrect the incident.
    const oldRead = input.observedAt
    for (let episode = 0; episode < 2; episode += 1) {
      await persistMonitoringObservation({ ...input, claim: await newClaim(), findings: [], observedAt: observedAt() })
      const reopened = await persistMonitoringObservation({ ...input, claim: await newClaim(), findings: [finding], observedAt: observedAt() })
      assert.equal(reopened.queued, 1)
    }
    const clear = await persistMonitoringObservation({ ...input, claim: await newClaim(), findings: [], observedAt: observedAt() })
    assert.equal(clear.resolved, 1)
    const stale = await persistMonitoringObservation({ ...input, claim: await newClaim(), observedAt: oldRead })
    assert.equal(stale.skipped, true)
    const reopenedDeliveries = await withSystemTransaction((db) => db.query.notificationDeliveries.findMany({ where: eq(notificationDeliveries.workspaceId, workspaceId) }))
    assert.equal(reopenedDeliveries.length, 4)
    assert.equal(new Set(reopenedDeliveries.map((delivery) => delivery.eventKey)).size, 4)

    const unrelated = await withSystemTransaction((db) => db.query.alertIncidents.findFirst({ where: and(eq(alertIncidents.workspaceId, workspaceId), eq(alertIncidents.agentId, agents[1].id)) }))
    assert.equal(unrelated?.status, 'open')
    await assert.rejects(persistMonitoringObservation({ ...input, claim: await newClaim(), clientId: otherClient.id }), /outside its job scope/)
    const [legacy] = await withSystemTransaction((db) => db.insert(alertIncidents).values({ workspaceId, agentId: agents[0].id, clientId: otherClient.id,
      fingerprint: `${finding.fingerprint}:${otherClient.id}`, title: 'Legacy incident', description: 'Pre-checkpoint format', severity: 'critical',
    }).returning())
    await persistMonitoringObservation({ ...input, claim: await newClaim(otherClient.id), clientId: otherClient.id, observedAt: observedAt() })
    const preservedLegacy = await withSystemTransaction((db) => db.query.alertIncidents.findMany({ where: and(eq(alertIncidents.workspaceId, workspaceId), eq(alertIncidents.clientId, otherClient.id)) }))
    assert.equal(preservedLegacy.length, 1)
    assert.equal(preservedLegacy[0].id, legacy.id)
    assert.equal(preservedLegacy[0].occurrenceCount, 2)
    const changedClaim = await newClaim()
    await withSystemTransaction((db) => db.update(monitoringAgents).set({ threshold: '10' }).where(eq(monitoringAgents.id, agents[0].id)))
    await assert.rejects(persistMonitoringObservation({ ...input, claim: changedClaim }), /configuration changed/)
    const expiredClaim = await newClaim()
    await withSystemTransaction((db) => db.update(jobs).set({ leaseExpiresAt: new Date(0) }).where(eq(jobs.id, expiredClaim.jobId)))
    await assert.rejects(persistMonitoringObservation({ ...input, claim: expiredClaim }), /lease lost/)
    await withSystemTransaction((db) => db.insert(auditEvents).values(Array.from({ length: 1_000 }, (_, index) => ({
      workspaceId, actorUserId: 'system:monitoring', action: 'monitoring.observation_committed', entityType: 'monitoring_agent', entityId: agents[0].id,
      metadata: { clientId: `unrelated-fixture-${index}`, observedAt: new Date().toISOString() },
    }))))
    // Refresh statistics after bulk fixture insertion; the administrator URL
    // has already been constrained to this disposable loopback database.
    const statistics = new Client({ connectionString: url.href, connectionTimeoutMillis: 5_000, query_timeout: 5_000 })
    try {
      await statistics.connect()
      await statistics.query('analyze audit_events')
    } finally {
      await statistics.end()
    }
    const plan = await withSystemTransaction((db) => db.execute(sql`explain (analyze, buffers, format json)
      select id from audit_events where workspace_id = ${workspaceId} and action = 'monitoring.observation_committed'
      and entity_id = ${agents[0].id} and metadata->>'clientId' = ${otherClient.id}
      order by created_at desc, id desc limit 1`))
    if (!JSON.stringify(plan.rows).includes('audit_monitoring_observation_idx')) console.log(JSON.stringify({ observationLookupPlan: plan.rows }))
    assert(JSON.stringify(plan.rows).includes('audit_monitoring_observation_idx'), 'The targeted observation index must serve the latest-read lookup')
    console.log(JSON.stringify({ ok: true, verified: ['atomic_incident_outbox_checkpoint', 'concurrent_checkpoint_idempotence', 'resume_after_commit_without_occurrence_increment', 'separate_vigie_fingerprints', 'rollback_incidents_and_notifications', 'distinct_reopen_episodes', 'older_read_cannot_resurrect_cleared_incident', 'client_and_agent_scope', 'configuration_drift_rejected', 'expired_worker_rejected', 'legacy_incident_identity_preserved', 'indexed_latest_observation_lookup'], providerCalls: 0 }))
  } finally {
    await withSystemTransaction((db) => db.delete(workspaces).where(eq(workspaces.id, workspaceId)))
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
