import 'dotenv/config'

import { performance } from 'node:perf_hooks'
import { count, eq, inArray, sql } from 'drizzle-orm'
import { Pool } from 'pg'
import {
  approvalRequests,
  clients,
  googleAdsConnections,
  jobs,
  monitoringAgents,
  notificationChannels,
  notificationDeliveries,
  rateLimitBuckets,
  shareLinks,
  workspaces,
} from '../src/db/schema'
import { withSystemTransaction } from '../src/db/transactions'

const loadApplicationName = `yodev_database_load_runtime_${process.pid}`
import { listApiApprovals } from '../src/lib/api-v1-repository'
import { voteAndClaimGoogleApproval } from '../src/lib/google-approval-management'
import { seedScheduledJobs } from '../src/lib/job-scheduler'
import { getPublicShare } from '../src/lib/public-share-repository'
import { consumePublicReportRateLimits } from '../src/lib/rate-limit'
import { hashToken } from '../src/lib/tokens'

const WORKSPACE_COUNT = 100
const AGENCY_CLIENT_COUNT = 50
const MONITOR_COUNT = 200
const REPORT_OPEN_COUNT = 1_000
const DELIVERY_COUNT = 10_000
const APPROVAL_COUNT = 100
const schedulerNow = new Date('2037-08-18T08:00:00.000Z')
const reportToken = 'ya_share_database_load_fixture'

function fixtureId(namespace: string, index: number) {
  return `${namespace}-0000-4000-8000-${String(index).padStart(12, '0')}`
}

const workspaceIds = Array.from({ length: WORKSPACE_COUNT }, (_, index) => fixtureId('71000000', index + 1))
const agencyWorkspaceId = workspaceIds[0]
const suspendedWorkspaceId = workspaceIds.at(-1)!
const clientIds = Array.from({ length: AGENCY_CLIENT_COUNT + WORKSPACE_COUNT - 1 }, (_, index) => fixtureId('72000000', index + 1))
const agencyClientIds = clientIds.slice(0, AGENCY_CLIENT_COUNT)
const approvalIds = Array.from({ length: APPROVAL_COUNT }, (_, index) => fixtureId('74000000', index + 1))
const channelId = fixtureId('75000000', 1)
const shareId = fixtureId('76000000', 1)
const connectionId = fixtureId('77000000', 1)
const schedulerRetentionKey = `retention.run:${schedulerNow.toISOString().slice(0, 10)}`

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function taggedConnectionString(connectionString: string, applicationName: string) {
  const parsed = new URL(connectionString)
  parsed.searchParams.set('application_name', applicationName)
  return parsed.toString()
}

function percentile(values: number[], ratio: number) {
  const ordered = [...values].sort((left, right) => left - right)
  return ordered[Math.min(ordered.length - 1, Math.floor(ordered.length * ratio))] ?? 0
}

async function cleanup() {
  await withSystemTransaction(async (db) => {
    await db.delete(workspaces).where(inArray(workspaces.id, workspaceIds))
    await db.delete(jobs).where(eq(jobs.deduplicationKey, schedulerRetentionKey))
  })
}

async function seedLoadFixtures() {
  const workspaceRows: Array<typeof workspaces.$inferInsert> = workspaceIds.map((id, index) => ({
    id,
    ownerUserId: `database-load-owner-${index + 1}`,
    name: `Database load workspace ${index + 1}`,
    slug: `database-load-${index + 1}`,
    plan: 'agency',
    accessState: id === suspendedWorkspaceId ? 'suspended' : 'active',
    timezone: 'UTC',
  }))
  const clientRows: Array<typeof clients.$inferInsert> = []
  for (let index = 0; index < AGENCY_CLIENT_COUNT; index += 1) {
    clientRows.push({
      id: agencyClientIds[index],
      workspaceId: agencyWorkspaceId,
      googleCustomerId: String(8_100_000_000 + index),
      name: `Agency client ${index + 1}`,
      timezone: 'UTC',
    })
  }
  for (let index = 1; index < WORKSPACE_COUNT; index += 1) {
    clientRows.push({
      id: clientIds[AGENCY_CLIENT_COUNT + index - 1],
      workspaceId: workspaceIds[index],
      googleCustomerId: String(8_200_000_000 + index),
      name: `Tenant client ${index + 1}`,
      timezone: 'UTC',
    })
  }
  const firstClientByWorkspace = new Map<string, string>()
  for (const client of clientRows) {
    if (!firstClientByWorkspace.has(client.workspaceId)) firstClientByWorkspace.set(client.workspaceId, client.id!)
  }
  const monitorRows: Array<typeof monitoringAgents.$inferInsert> = Array.from({ length: MONITOR_COUNT }, (_, index) => {
    const workspaceId = workspaceIds[index % WORKSPACE_COUNT]
    return {
      id: fixtureId('73000000', index + 1),
      workspaceId,
      clientId: firstClientByWorkspace.get(workspaceId),
      createdBy: 'database-load-seed',
      kind: 'spend_anomaly',
      name: `Database load monitor ${index + 1}`,
      description: 'Durable scheduler load fixture',
      threshold: '20',
      schedule: 'daily',
    }
  })
  const approvalRows: Array<typeof approvalRequests.$inferInsert> = approvalIds.map((id, index) => ({
    id,
    workspaceId: agencyWorkspaceId,
    clientId: agencyClientIds[index % agencyClientIds.length],
    requestedBy: 'database-load-requester',
    kind: 'campaign_status',
    title: `Database load approval ${index + 1}`,
    payload: {},
    expectedState: { status: 'ENABLED' },
    proposedState: { status: 'PAUSED' },
    expectedStateHash: `database-load-state-${index + 1}`,
    requiredApprovals: 1,
    expiresAt: new Date('2038-01-01T00:00:00.000Z'),
    createdAt: new Date('2037-08-18T07:00:00.000Z'),
    updatedAt: new Date('2037-08-18T07:00:00.000Z'),
  }))
  const deliveryRows: Array<typeof notificationDeliveries.$inferInsert> = Array.from(
    { length: DELIVERY_COUNT },
    (_, index) => ({
      workspaceId: agencyWorkspaceId,
      channelId,
      eventKey: `database-load-delivery-${index + 1}`,
      payload: { sequence: index + 1 },
      status: 'delivered',
      attemptCount: 1,
      terminalAt: schedulerNow,
    }),
  )

  await withSystemTransaction(async (db) => {
    await db.insert(workspaces).values(workspaceRows)
    await db.insert(clients).values(clientRows)
    await db.insert(monitoringAgents).values(monitorRows)
    await db.insert(googleAdsConnections).values({
      id: connectionId,
      workspaceId: agencyWorkspaceId,
      managerCustomerId: '8100000000',
      encryptedRefreshToken: 'database-load-encrypted-token',
      scopes: ['https://www.googleapis.com/auth/adwords'],
      connectedBy: 'database-load-seed',
    })
    await db.insert(notificationChannels).values({
      id: channelId,
      workspaceId: agencyWorkspaceId,
      createdBy: 'database-load-seed',
      kind: 'email',
      label: 'Database load channel',
      encryptedDestination: 'database-load-encrypted-destination',
      destinationHint: 'load@example.test',
    })
    await db.insert(shareLinks).values({
      id: shareId,
      workspaceId: agencyWorkspaceId,
      clientId: agencyClientIds[0],
      createdBy: 'database-load-seed',
      label: 'Database load report',
      tokenHash: hashToken(reportToken),
      tokenPrefix: reportToken.slice(0, 12),
      expiresAt: new Date('2038-01-01T00:00:00.000Z'),
    })
    await db.insert(approvalRequests).values(approvalRows)
    for (let offset = 0; offset < deliveryRows.length; offset += 1_000) {
      await db.insert(notificationDeliveries).values(deliveryRows.slice(offset, offset + 1_000))
    }
  })

  const evidence = await withSystemTransaction(async (db) => ({
    workspaces: (await db.select({ value: count() }).from(workspaces).where(inArray(workspaces.id, workspaceIds)))[0].value,
    clients: (await db.select({ value: count() }).from(clients).where(inArray(clients.workspaceId, workspaceIds)))[0].value,
    monitors: (await db.select({ value: count() }).from(monitoringAgents).where(inArray(monitoringAgents.workspaceId, workspaceIds)))[0].value,
    deliveries: (await db.select({ value: count() }).from(notificationDeliveries).where(eq(notificationDeliveries.workspaceId, agencyWorkspaceId)))[0].value,
    approvals: (await db.select({ value: count() }).from(approvalRequests).where(eq(approvalRequests.workspaceId, agencyWorkspaceId)))[0].value,
  }))
  invariant(evidence.workspaces === WORKSPACE_COUNT, 'The load fixture does not contain 100 workspaces')
  invariant(evidence.clients === clientRows.length, 'The load fixture client count is inconsistent')
  invariant(evidence.monitors === MONITOR_COUNT, 'The load fixture does not contain 200 monitors')
  invariant(evidence.deliveries === DELIVERY_COUNT, 'The load fixture does not contain 10,000 notification deliveries')
  invariant(evidence.approvals === APPROVAL_COUNT, 'The load fixture does not contain 100 approvals')
  return evidence
}

async function verifyBoundedPool(ownerConnectionString: string) {
  const configuredMaximum = Number(process.env.DATABASE_POOL_MAX ?? '10')
  invariant(Number.isInteger(configuredMaximum) && configuredMaximum > 0, 'DATABASE_POOL_MAX must be a positive integer')
  const monitor = new Pool({
    connectionString: ownerConnectionString,
    application_name: 'yodev_database_load_monitor',
    max: 1,
  })
  let complete = false
  let peak = 0
  const workload = Promise.all(Array.from({ length: 40 }, () => withSystemTransaction(async (db) => {
    await db.execute(sql`select pg_sleep(0.05)`)
  }))).finally(() => {
    complete = true
  })
  try {
    while (!complete) {
      const result = await monitor.query<{ count: number }>(`
        select count(*)::int as count
        from pg_stat_activity
        where datname = current_database()
          and application_name = $1
      `, [loadApplicationName])
      peak = Math.max(peak, result.rows[0]?.count ?? 0)
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    await workload
  } finally {
    await monitor.end()
  }
  invariant(peak > 0, 'The runtime pool was not observable under load')
  invariant(peak <= configuredMaximum, `Runtime pool exceeded DATABASE_POOL_MAX (${peak}/${configuredMaximum})`)
  return { configuredMaximum, observedPeak: peak }
}

async function verifyReportBurst() {
  const startedAt = performance.now()
  const durations: number[] = []
  const results = await Promise.all(Array.from({ length: REPORT_OPEN_COUNT }, async () => {
    const requestStartedAt = performance.now()
    const result = await getPublicShare(reportToken)
    durations.push(performance.now() - requestStartedAt)
    return result
  }))
  invariant(results.every((result) => result?.share.workspaceId === agencyWorkspaceId), 'A public report read failed or crossed tenants')
  return {
    count: results.length,
    totalMs: Math.round(performance.now() - startedAt),
    p95Ms: Math.round(percentile(durations, 0.95)),
  }
}

async function verifyPublicReportRateLimitBurst() {
  process.env.RATE_LIMIT_HASH_KEY = 'database-load-rate-limit-key'
  const results = await Promise.all(Array.from({ length: REPORT_OPEN_COUNT }, () => consumePublicReportRateLimits({
    workspaceId: agencyWorkspaceId,
    token: reportToken,
    ip: '198.51.100.42',
  })))
  const allowed = results.filter((result) => result.allowed).length
  invariant(allowed === 60, `Public report IP rate limit admitted ${allowed} requests instead of 60`)
  const buckets = await withSystemTransaction((db) => db.select({ value: rateLimitBuckets.count })
    .from(rateLimitBuckets)
    .where(eq(rateLimitBuckets.workspaceId, agencyWorkspaceId)))
  const counts = buckets.map((bucket) => bucket.value).sort((left, right) => left - right)
  invariant(counts.length === 2 && counts[0] === 60 && counts[1] === REPORT_OPEN_COUNT, 'Layered public report rate-limit counters are inconsistent')
  return { requests: results.length, allowed, bucketCounts: counts }
}

async function verifyApprovalBurstAndPagination() {
  const outcomes = await Promise.all(approvalIds.map((approvalId, index) => voteAndClaimGoogleApproval({
    workspaceId: agencyWorkspaceId,
    actorUserId: `database-load-approver-${index + 1}`,
    approvalId,
    allowSelfApproval: false,
    assertKindAllowed: (kind) => invariant(kind === 'campaign_status', 'Unexpected load approval kind'),
  })))
  invariant(outcomes.every((outcome) => outcome.outcome === 'claimed'), 'Not all 100 simultaneous approvals were claimed once')

  const seen = new Set<string>()
  let cursor: { at: Date; id: string } | null = null
  let pages = 0
  do {
    const rows = await listApiApprovals({
      workspaceId: agencyWorkspaceId,
      actorId: 'database-load-api',
      cursor,
      limit: 25,
    })
    const page = rows.slice(0, 25)
    for (const row of page) seen.add(row.approval.id)
    pages += 1
    const last = page.at(-1)
    cursor = rows.length > 25 && last ? { at: last.approval.createdAt, id: last.approval.id } : null
  } while (cursor)
  invariant(seen.size === APPROVAL_COUNT, 'Approval cursor pagination skipped or duplicated rows')
  invariant(pages === 4, 'Approval cursor pagination did not produce four stable pages')
  return { count: outcomes.length, pages }
}

async function verifyConcurrentScheduler() {
  delete process.env.APP_ENCRYPTION_KEY
  delete process.env.APP_ENCRYPTION_KEYS
  delete process.env.APP_ENCRYPTION_KID
  const previousGoogleReads = process.env.GOOGLE_READS_ENABLED
  process.env.GOOGLE_READS_ENABLED = '1'
  try {
    const results = await Promise.all([seedScheduledJobs(schedulerNow), seedScheduledJobs(schedulerNow)])
    const evidence = await withSystemTransaction(async (db) => {
      const scheduled = await db.select({
        workspaceId: jobs.workspaceId,
        deduplicationKey: jobs.deduplicationKey,
      }).from(jobs).where(inArray(jobs.workspaceId, workspaceIds))
      const duplicates = await db.execute<{ deduplication_key: string; occurrences: number }>(sql`
        select deduplication_key, count(*)::int as occurrences
        from jobs
        where workspace_id in (${sql.join(workspaceIds.map((id) => sql`${id}`), sql`, `)})
        group by deduplication_key
        having count(*) > 1
      `)
      return { scheduled, duplicates: duplicates.rows }
    })
    invariant(evidence.scheduled.length > 0, 'The concurrent scheduler did not create tenant jobs')
    invariant(evidence.duplicates.length === 0, 'The concurrent scheduler created duplicate jobs')
    invariant(
      evidence.scheduled.every((job) => job.workspaceId !== suspendedWorkspaceId),
      'A suspended tenant received a collection or monitoring job',
    )
    invariant(results.reduce((total, result) => total + result.created, 0) >= evidence.scheduled.length, 'Scheduler creation evidence is inconsistent')
    return { requested: results.reduce((total, result) => total + result.requested, 0), created: evidence.scheduled.length }
  } finally {
    if (previousGoogleReads === undefined) delete process.env.GOOGLE_READS_ENABLED
    else process.env.GOOGLE_READS_ENABLED = previousGoogleReads
  }
}

async function main() {
  invariant(process.env.NODE_ENV !== 'production', 'Database load verification is forbidden in production')
  invariant(process.env.DATABASE_DRIVER === 'node-postgres', 'Database load verification requires DATABASE_DRIVER=node-postgres')
  const ownerConnectionString = process.env.DATABASE_URL
  invariant(ownerConnectionString, 'DATABASE_URL is required')
  for (const name of ['DATABASE_URL', 'DATABASE_AUTHENTICATED_URL', 'DATABASE_SYSTEM_URL', 'DATABASE_PURGE_URL'] as const) {
    const connectionString = process.env[name] ?? ownerConnectionString
    process.env[name] = taggedConnectionString(connectionString, loadApplicationName)
  }

  await cleanup()
  try {
    const pool = await verifyBoundedPool(ownerConnectionString)
    const fixtures = await seedLoadFixtures()
    const reportBurst = await verifyReportBurst()
    const reportRateLimits = await verifyPublicReportRateLimitBurst()
    const approvals = await verifyApprovalBurstAndPagination()
    const scheduler = await verifyConcurrentScheduler()
    console.log(JSON.stringify({
      ok: true,
      fixtures,
      pool,
      reportBurst,
      reportRateLimits,
      approvals,
      scheduler,
    }))
  } finally {
    await cleanup()
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
