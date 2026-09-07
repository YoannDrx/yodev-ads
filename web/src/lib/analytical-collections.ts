import 'server-only'

import { and, desc, eq, getTableColumns, gte, inArray, sql } from 'drizzle-orm'
import { z } from 'zod'
import { analyticalCollections, auditEvents, clients, googleAdsConnections, jobs, workspaces } from '@/db/schema'
import { withSystemTransaction, withTenantTransaction } from '@/db/transactions'
import { analyticalFamilies, ANALYTICAL_CONTRACT_VERSION, ANALYTICAL_FAMILIES, type AnalyticalAttempt, type AnalyticalFamily } from '@/lib/analytical-model'
import { accountCalendarDate, calendarDates, reportCalendarWindow, shiftCalendarDate } from '@/lib/calendar-window'
import { GoogleAdsGateway } from '@/lib/google-ads'
import { NonRetryableJobError, type ClaimedJob, type EnqueueJobInput } from '@/lib/jobs'
import { requireFeature } from '@/lib/feature-flags'
import { lockWorkspaceEntitlements } from '@/lib/workspace-transaction-guard'
import { workspaceLifecycleAllowsPermission } from '@/lib/workspace-access'
import { googleCollectionCoverageSchema, googleCoverageState, type GoogleCollectionCoverage } from '@/lib/google-collection-coverage'

const payloadSchema = z.object({
  workspaceId: z.string().uuid(), clientId: z.string().uuid(), family: z.enum(analyticalFamilies),
  timezone: z.string().min(1), currencyCode: z.string().length(3),
  from: z.string(), through: z.string(), contractVersion: z.literal(ANALYTICAL_CONTRACT_VERSION),
})

export function analyticalCollectionJobs(input: { workspaceId: string; clientId: string; timezone: string; currencyCode: string; generation: string; now: Date }): EnqueueJobInput[] {
  const { from, through } = reportCalendarWindow({ period: '30', now: input.now, timezone: input.timezone })
  return analyticalFamilies.map((family, index) => ({
    workspaceId: input.workspaceId, type: 'analytics.collect', priority: index < 5 ? 48 : 60,
    payload: { workspaceId: input.workspaceId, clientId: input.clientId, family, timezone: input.timezone, currencyCode: input.currencyCode, from, through, contractVersion: ANALYTICAL_CONTRACT_VERSION },
    deduplicationKey: `analytics:${input.clientId}:${family}:${input.generation}:v${ANALYTICAL_CONTRACT_VERSION}`,
  }))
}

export function getAnalyticalCollections(workspaceId: string, clientId: string, requestedFamilies: AnalyticalFamily[] = analyticalFamilies, previewRows?: number) {
  if (previewRows !== undefined && (!Number.isInteger(previewRows) || previewRows < 1 || previewRows > 200)) throw new Error('Invalid analytical preview size')
  return withTenantTransaction({ workspaceId, userId: 'repository:analytics' }, async (db) => {
    const workspace = await db.query.workspaces.findFirst({ where: eq(workspaces.id, workspaceId) })
    if (!workspace || !workspaceLifecycleAllowsPermission(workspace.accessState, 'portfolio:read')) throw new Error('Stored analysis is unavailable')
    const client = await db.query.clients.findFirst({ where: and(eq(clients.id, clientId), eq(clients.workspaceId, workspaceId), eq(clients.active, true), eq(clients.isManager, false)) })
    if (!client) throw new Error('Stored analysis is unavailable')
    const payload = previewRows === undefined ? sql`${analyticalCollections.payload}` : sql`case when jsonb_typeof(${analyticalCollections.payload})='array' then
      (select coalesce(jsonb_agg(p.value order by p.position), '[]'::jsonb) from (select e.value, e.position from jsonb_array_elements(${analyticalCollections.payload}) with ordinality e(value,position) order by e.position limit ${previewRows}) p)
      else ${analyticalCollections.payload} end`
    const snapshots = await db.select({ ...getTableColumns(analyticalCollections),
      storedRowCount: sql<number>`case when jsonb_typeof(${analyticalCollections.payload})='array' then jsonb_array_length(${analyticalCollections.payload}) else 1 end`,
      payload: sql<unknown>`case when ${inArray(analyticalCollections.family, requestedFamilies)} then ${payload} else null end`,
    }).from(analyticalCollections).where(and(eq(analyticalCollections.workspaceId, workspaceId), eq(analyticalCollections.clientId, clientId)))
    const result = await db.execute<{ family: string; status: string; created_at: Date; started_at: Date | null; available_at: Date; updated_at: Date }>(sql`
      select distinct on (payload->>'family') payload->>'family' as family, status, created_at, available_at, updated_at,
        (select started_at from job_attempts where job_attempts.workspace_id = jobs.workspace_id and job_attempts.job_id = jobs.id order by attempt desc limit 1) as started_at
      from jobs where workspace_id = ${workspaceId} and type = 'analytics.collect' and payload->>'clientId' = ${clientId}
      order by payload->>'family', created_at desc, id desc
    `)
    const attempts: AnalyticalAttempt[] = result.rows.map((row) => ({ family: row.family, status: row.status, createdAt: new Date(row.created_at), startedAt: row.started_at ? new Date(row.started_at) : null, availableAt: new Date(row.available_at), updatedAt: new Date(row.updated_at) }))
    return { snapshots, attempts }
  })
}

export function requestAnalyticalRefresh(input: { workspaceId: string; clientId: string; actorUserId: string; now?: Date }) {
  requireFeature('googleReads', 'Google collection is temporarily unavailable')
  requireFeature('scheduler', 'Background collection is temporarily unavailable')
  return withTenantTransaction({ workspaceId: input.workspaceId, userId: input.actorUserId }, async (db) => {
    await lockWorkspaceEntitlements(db, input.workspaceId, 'google.read')
    const client = await db.query.clients.findFirst({ where: and(eq(clients.id, input.clientId), eq(clients.workspaceId, input.workspaceId), eq(clients.active, true), eq(clients.isManager, false)) })
    const connection = await db.query.googleAdsConnections.findFirst({ where: and(eq(googleAdsConnections.workspaceId, input.workspaceId), eq(googleAdsConnections.status, 'active')) })
    if (!client || !connection) throw new Error('Active account and Google connection required')
    const now = input.now ?? new Date()
    const scope = and(eq(jobs.workspaceId, input.workspaceId), eq(jobs.type, 'analytics.collect'), sql`${jobs.payload}->>'clientId' = ${input.clientId}`)
    const running = await db.query.jobs.findFirst({ where: and(scope, inArray(jobs.status, ['queued', 'running', 'retrying'])), columns: { id: true } })
    if (running) return { created: false, reason: 'pending' as const }
    const recent = await db.query.jobs.findFirst({ where: and(scope, gte(jobs.createdAt, new Date(now.getTime() - 15 * 60_000))), orderBy: [desc(jobs.createdAt)], columns: { id: true } })
    if (recent) return { created: false, reason: 'recent' as const }
    const generation = `manual:${Math.floor(now.getTime() / (15 * 60_000))}`
    const created = await db.insert(jobs).values(analyticalCollectionJobs({ ...input, timezone: client.timezone, currencyCode: client.currencyCode, generation, now })).onConflictDoNothing().returning({ id: jobs.id })
    // Repair the financial history independently; analytical lists do not certify daily totals.
    await db.insert(jobs).values({ workspaceId: input.workspaceId, type: 'metrics.daily_sync', payload: { workspaceId: input.workspaceId, clientId: input.clientId }, priority: 40,
      deduplicationKey: `metrics.refresh:${input.clientId}:${generation}` }).onConflictDoNothing()
    await db.insert(auditEvents).values({ workspaceId: input.workspaceId, actorUserId: input.actorUserId, action: 'analytics.refresh_requested', entityType: 'client', entityId: input.clientId, metadata: { jobs: created.length, generation } })
    return { created: created.length > 0, reason: 'queued' as const }
  })
}

function leasedJob(job: ClaimedJob) {
  return and(eq(jobs.id, job.id), eq(jobs.type, 'analytics.collect'), eq(jobs.workspaceId, job.workspaceId!), eq(jobs.status, 'running'),
    eq(jobs.attemptCount, job.attemptCount), eq(jobs.leaseOwner, job.leaseOwner!), sql`${jobs.leaseExpiresAt} > clock_timestamp()`)
}

export async function collectAnalyticalFamily(job: ClaimedJob) {
  const input = payloadSchema.parse(job.payload)
  if (!job.workspaceId || !job.leaseOwner || input.workspaceId !== job.workspaceId) throw new NonRetryableJobError('Analytical job scope mismatch')
  if (calendarDates({ from: input.from, through: input.through }, 30).length !== 30) throw new NonRetryableJobError('Analytical period must contain 30 completed days')
  const context = await withSystemTransaction(async (db) => {
    const [current] = await db.select().from(jobs).where(leasedJob(job)).limit(1)
    if (!current) throw new Error('Analytical job lease lost')
    if (JSON.stringify(payloadSchema.parse(current.payload)) !== JSON.stringify(input)) throw new NonRetryableJobError('Analytical job payload changed')
    if (current.payload.analyticalResult) return { result: current.payload.analyticalResult }
    await lockWorkspaceEntitlements(db, input.workspaceId, 'google.read')
    const client = await db.query.clients.findFirst({ where: and(eq(clients.id, input.clientId), eq(clients.workspaceId, input.workspaceId), eq(clients.active, true), eq(clients.isManager, false)) })
    const connection = await db.query.googleAdsConnections.findFirst({ where: and(eq(googleAdsConnections.workspaceId, input.workspaceId), eq(googleAdsConnections.status, 'active')) })
    if (!client || !connection || client.timezone !== input.timezone || client.currencyCode !== input.currencyCode) throw new NonRetryableJobError('Analytical collection context changed')
    return { client, connection }
  })
  if ('result' in context) return context.result
  const observedAt = new Date()
  const today = accountCalendarDate(observedAt, input.timezone)
  if (input.through >= today || input.from < shiftCalendarDate(today, -729)) throw new NonRetryableJobError('Analytical dates are outside retained complete days')
  const gateway = new GoogleAdsGateway(context.connection, { from: input.from, through: input.through })
  const payload = input.family === 'assets'
    ? await gateway.assetPerformance(context.client.googleCustomerId, shiftCalendarDate(input.through, 1))
    : await gateway[ANALYTICAL_FAMILIES[input.family].method](context.client.googleCustomerId)
  // Bound one cache entry, and keep its former successful value on failure.
  if (Buffer.byteLength(JSON.stringify(payload), 'utf8') > 1_900_000) throw new NonRetryableJobError('Analytical result exceeds the supported collection size')
  return persistAnalyticalCollection({ job, connectionId: context.connection.id, observedAt, payload, requestIds: gateway.collectedRequestIds(), coverage: gateway.collectedCoverage() })
}

export async function persistAnalyticalCollection(resultInput: { job: ClaimedJob; connectionId: string; observedAt: Date; payload: unknown; requestIds: string[]; coverage?: GoogleCollectionCoverage }) {
  const { job, observedAt, payload } = resultInput
  const coverage = resultInput.coverage === undefined ? null : googleCollectionCoverageSchema.parse(resultInput.coverage)
  const input = payloadSchema.parse(job.payload)
  if (!job.workspaceId || !job.leaseOwner || input.workspaceId !== job.workspaceId) throw new NonRetryableJobError('Analytical job scope mismatch')
  if (calendarDates({ from: input.from, through: input.through }, 30).length !== 30) throw new NonRetryableJobError('Invalid analytical period')
  return withSystemTransaction(async (db) => {
    const [current] = await db.select().from(jobs).where(leasedJob(job)).limit(1).for('update')
    if (!current) throw new Error('Analytical job lease lost before commit')
    if (JSON.stringify(payloadSchema.parse(current.payload)) !== JSON.stringify(input)) throw new NonRetryableJobError('Analytical job payload changed')
    if (current.payload.analyticalResult) return current.payload.analyticalResult
    await lockWorkspaceEntitlements(db, input.workspaceId, 'google.read')
    const client = await db.query.clients.findFirst({ where: and(eq(clients.id, input.clientId), eq(clients.workspaceId, input.workspaceId), eq(clients.active, true), eq(clients.isManager, false)) })
    const connection = await db.query.googleAdsConnections.findFirst({ where: and(eq(googleAdsConnections.id, resultInput.connectionId), eq(googleAdsConnections.workspaceId, input.workspaceId), eq(googleAdsConnections.status, 'active')) })
    if (!client || !connection || client.timezone !== input.timezone || client.currencyCode !== input.currencyCode) throw new NonRetryableJobError('Analytical account changed during collection')
    const stored = await db.insert(analyticalCollections).values({ workspaceId: input.workspaceId, clientId: input.clientId, family: input.family,
      contractVersion: input.contractVersion, periodFrom: input.from, periodThrough: input.through, timezone: input.timezone, currencyCode: input.currencyCode,
      sourceVersion: job.id, observedAt, payload, coverage }).onConflictDoUpdate({ target: [analyticalCollections.clientId, analyticalCollections.family],
      set: { contractVersion: input.contractVersion, periodFrom: input.from, periodThrough: input.through, timezone: input.timezone, currencyCode: input.currencyCode, sourceVersion: job.id, observedAt, collectedAt: new Date(), payload, coverage },
      setWhere: sql`${analyticalCollections.observedAt} <= ${observedAt} and ${analyticalCollections.periodThrough} <= ${input.through}` }).returning({ id: analyticalCollections.id })
    const result = { family: input.family, stored: stored.length > 0, from: input.from, through: input.through, requestIds: resultInput.requestIds, coverageState: googleCoverageState(coverage) }
    await db.insert(auditEvents).values({ workspaceId: input.workspaceId, actorUserId: 'system:analytics', action: 'analytics.collected', entityType: 'client', entityId: input.clientId,
      metadata: { ...result, jobId: job.id, sourceVersion: job.id, observedAt: observedAt.toISOString(), contractVersion: input.contractVersion } })
    const checkpoint = await db.update(jobs).set({ payload: { ...current.payload, analyticalResult: result }, updatedAt: new Date() }).where(leasedJob(job)).returning({ id: jobs.id })
    if (!checkpoint.length) throw new Error('Analytical job lease lost before checkpoint')
    return result
  })
}
