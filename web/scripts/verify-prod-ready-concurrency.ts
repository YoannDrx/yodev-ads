import assert from 'node:assert/strict'
import { fork } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { and, count, eq } from 'drizzle-orm'
import { jobAttempts, jobs, monitoringAgents, workspaces } from '../src/db/schema'
import { withSystemTransaction } from '../src/db/transactions'
import { entitlementContext } from '../src/lib/entitlements'
import { claimNextJob, completeJob, enqueueJob, recoverExpiredJobs, type ClaimedJob } from '../src/lib/jobs'
import { createWorkspaceMonitoringAgent, setWorkspaceMonitoringAgentEnabled } from '../src/lib/monitoring-workflows'

const url = new URL(process.env.DATABASE_SYSTEM_URL ?? '')
assert(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && url.pathname.startsWith('/yodev_test'), 'Disposable local database required')
const workspaceId = '70000000-0000-4000-8000-000000000001'
const actorUserId = 'prod-ready-fixture-owner'

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
    const now = new Date(Date.now() + 1_000)
    const recovery = await Promise.all([recoverExpiredJobs(now), recoverExpiredJobs(now)])
    assert.equal(recovery.reduce((sum, item) => sum + item.deadLettered, 0), 1)
    assert.equal(await completeJob(claimed, 'crashed-worker', now), false)
    const evidence = await withSystemTransaction(async (db) => ({
      job: await db.query.jobs.findFirst({ where: eq(jobs.id, job.id) }),
      attempt: await db.query.jobAttempts.findFirst({ where: eq(jobAttempts.jobId, job.id) }),
    }))
    assert.equal(evidence.job?.status, 'dead_letter')
    assert.equal(evidence.attempt?.state, 'dead_letter')
    console.log(JSON.stringify({ ok: true, verified: ['monitor_quota_concurrent_create_reactivate', 'current_plan_under_lock', 'worker_sigkill_final_attempt', 'concurrent_lease_recovery', 'stale_worker_finalization_rejected'] }))
  } finally {
    await withSystemTransaction((db) => db.delete(workspaces).where(eq(workspaces.id, workspaceId)))
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
