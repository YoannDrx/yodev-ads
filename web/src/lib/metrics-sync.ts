import 'server-only'

import { and, count, eq, gte, inArray, isNotNull, lte, min, or, sql } from 'drizzle-orm'
import { z } from 'zod'
import { auditEvents, clients, dailyAccountMetrics, dailyCampaignMetrics, googleAdsConnections, jobs, workspaces } from '@/db/schema'
import { withSystemTransaction } from '@/db/transactions'
import { accountCalendarDate, calendarDates, shiftCalendarDate } from '@/lib/calendar-window'
import { GoogleAdsGateway } from '@/lib/google-ads'
import { enqueueJobs, NonRetryableJobError, type ClaimedJob } from '@/lib/jobs'
import { metricSyncPlan } from '@/lib/metric-sync-plan'
import { normalizeMetricSyncData } from '@/lib/metric-sync-data'
import { remainingWorkMs } from '@/lib/work-deadline'

const windowSchema = z.object({ from: z.string(), through: z.string() })
const identitySchema = z.object({ workspaceId: z.string().uuid(), clientId: z.string().uuid() })
const coordinatorSchema = identitySchema.extend({ requestedWindow: windowSchema.optional() })
const chunkSchema = identitySchema.extend({ parentJobId: z.string().uuid(), timezone: z.string().min(1), window: windowSchema })
const planSchema = z.object({ v: z.literal(1), today: z.string(), timezone: z.string(), conversionLookbackDays: z.number().nullable(), plannedAt: z.string(),
  windows: z.array(windowSchema.extend({ reason: z.enum(['recent', 'backfill', 'historical_review']), priority: z.number() })).max(110) })
const resultSchema = z.object({ accountDays: z.number(), campaignDays: z.number(), ignoredOlderDays: z.number(), period: windowSchema })

function leaseCondition(job: ClaimedJob) {
  if (!job.workspaceId || !job.leaseOwner) throw new NonRetryableJobError('Metrics job workspace or owner missing')
  return and(eq(jobs.id, job.id), eq(jobs.workspaceId, job.workspaceId), eq(jobs.type, job.type), eq(jobs.status, 'running'),
    eq(jobs.attemptCount, job.attemptCount), eq(jobs.leaseOwner, job.leaseOwner), sql`${jobs.leaseExpiresAt} > clock_timestamp()`)
}

async function syncContext(job: ClaimedJob, input: z.infer<typeof identitySchema>) {
  if (job.workspaceId !== input.workspaceId) throw new NonRetryableJobError('Metrics job workspace mismatch')
  return withSystemTransaction(async (db) => {
    const [current] = await db.select().from(jobs).where(leaseCondition(job)).limit(1)
    if (!current) throw new Error('Metrics job lease lost')
    const workspace = await db.query.workspaces.findFirst({ where: eq(workspaces.id, input.workspaceId) })
    const client = await db.query.clients.findFirst({ where: and(eq(clients.id, input.clientId), eq(clients.workspaceId, input.workspaceId)) })
    if (!workspace || !['internal', 'trial', 'active'].includes(workspace.accessState) || !client?.active || client.isManager) {
      throw new NonRetryableJobError('Metrics sync client or workspace unavailable')
    }
    const connection = await db.query.googleAdsConnections.findFirst({ where: and(eq(googleAdsConnections.workspaceId, input.workspaceId), eq(googleAdsConnections.status, 'active')) })
    return { current, client, connection }
  })
}

/** Legacy daily_sync jobs become bounded, resumable coordinators. */
export async function fanOutMetricSync(job: ClaimedJob, now = new Date()) {
  const input = coordinatorSchema.parse(job.payload)
  const context = await syncContext(job, input)
  let plan: z.infer<typeof planSchema>
  if (context.current.payload.metricSyncPlan) {
    plan = planSchema.parse(context.current.payload.metricSyncPlan)
  } else {
    if (!context.connection) throw new NonRetryableJobError('Metrics sync Google connection unavailable')
    const today = accountCalendarDate(now, context.client.timezone)
    const conversionLookbackDays = await new GoogleAdsGateway(context.connection).conversionLookbackDays(context.client.googleCustomerId)
    const history = await withSystemTransaction(async (db) => {
      const [oldest] = await db.select({ date: min(dailyAccountMetrics.metricDate) }).from(dailyAccountMetrics).where(and(eq(dailyAccountMetrics.workspaceId, input.workspaceId), eq(dailyAccountMetrics.clientId, input.clientId)))
      const [coverage] = await db.select({ days: count() }).from(dailyAccountMetrics).where(and(
        eq(dailyAccountMetrics.workspaceId, input.workspaceId), eq(dailyAccountMetrics.clientId, input.clientId),
        eq(dailyAccountMetrics.timezone, context.client.timezone),
        or(eq(dailyAccountMetrics.coverageStatus, 'complete'), and(eq(dailyAccountMetrics.coverageStatus, 'partial'), eq(dailyAccountMetrics.metricDate, shiftCalendarDate(today, -1)))),
        isNotNull(dailyAccountMetrics.sourceVersion),
        gte(dailyAccountMetrics.metricDate, shiftCalendarDate(today, -90)), lte(dailyAccountMetrics.metricDate, shiftCalendarDate(today, -1)),
      ))
      return { oldestMetricDate: oldest.date, hasCoverage: coverage.days === 90 }
    })
    const proposed = { v: 1 as const, today, timezone: context.client.timezone, conversionLookbackDays, plannedAt: now.toISOString(),
      windows: metricSyncPlan({ today, conversionLookbackDays, ...history, requestedWindow: input.requestedWindow }) }
    plan = await withSystemTransaction(async (db) => {
      const [current] = await db.select().from(jobs).where(leaseCondition(job)).limit(1).for('update')
      if (!current) throw new Error('Metrics coordinator lease lost')
      if (current.payload.metricSyncPlan) return planSchema.parse(current.payload.metricSyncPlan)
      await db.update(jobs).set({ payload: { ...current.payload, metricSyncPlan: proposed }, updatedAt: new Date() }).where(eq(jobs.id, job.id))
      return proposed
    })
  }
  let created = 0
  for (let index = 0; index < plan.windows.length; index += 50) {
    remainingWorkMs(1_000)
    const batch = plan.windows.slice(index, index + 50).map((window) => ({
      workspaceId: input.workspaceId, type: 'metrics.sync_chunk' as const,
      payload: { ...input, parentJobId: job.id, timezone: plan.timezone, window: { from: window.from, through: window.through }, reason: window.reason },
      priority: window.priority, deduplicationKey: `metrics.chunk:${job.id}:${window.from}:${window.through}`,
    }))
    created += (await enqueueJobs(batch)).created
  }
  return { chunks: plan.windows.length, created, timezone: plan.timezone, conversionLookbackDays: plan.conversionLookbackDays }
}

export async function executeMetricSyncChunk(job: ClaimedJob) {
  const input = chunkSchema.parse(job.payload)
  calendarDates(input.window, 7)
  const context = await syncContext(job, input)
  if (context.current.payload.metricSyncResult) return resultSchema.parse(context.current.payload.metricSyncResult)
  if (!context.connection) throw new NonRetryableJobError('Metrics sync Google connection unavailable')
  if (context.client.timezone !== input.timezone) throw new NonRetryableJobError('Metrics account timezone changed; schedule a fresh collection')
  const observedAt = new Date()
  const today = accountCalendarDate(observedAt, input.timezone)
  if (input.window.from < shiftCalendarDate(today, -729) || input.window.through > today) throw new NonRetryableJobError('Metrics range is outside retained history')
  const gateway = new GoogleAdsGateway(context.connection)
  const [accounts, campaigns] = await Promise.all([
    gateway.dailyAccountMetrics(context.client.googleCustomerId, input.window.from, input.window.through),
    gateway.dailyCampaignMetrics(context.client.googleCustomerId, input.window.from, input.window.through),
  ])
  const dataset = normalizeMetricSyncData({ window: input.window, today, complete: true, accounts, campaigns })
  return persistMetricSyncChunk({ job, clientId: input.clientId, timezone: input.timezone, currencyCode: context.client.currencyCode, observedAt, window: input.window, dataset })
}

export async function persistMetricSyncChunk(input: {
  job: ClaimedJob; clientId: string; timezone: string; currencyCode: string; observedAt: Date;
  window: z.infer<typeof windowSchema>; dataset: ReturnType<typeof normalizeMetricSyncData>;
}) {
  return withSystemTransaction(async (db) => {
    const [current] = await db.select().from(jobs).where(leaseCondition(input.job)).limit(1).for('update')
    if (!current) throw new Error('Metrics job lease lost before commit')
    const scoped = chunkSchema.parse(current.payload)
    if (scoped.workspaceId !== input.job.workspaceId || scoped.clientId !== input.clientId || scoped.timezone !== input.timezone ||
      scoped.window.from !== input.window.from || scoped.window.through !== input.window.through) throw new Error('Metric write is outside its job scope')
    if (current.payload.metricSyncResult) return resultSchema.parse(current.payload.metricSyncResult)
    await db.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`metrics:${input.job.workspaceId}:${input.clientId}`}, 0))`)
    const client = await db.query.clients.findFirst({ where: and(eq(clients.id, input.clientId), eq(clients.workspaceId, input.job.workspaceId!)) })
    const workspace = await db.query.workspaces.findFirst({ where: eq(workspaces.id, input.job.workspaceId!) })
    if (!workspace || !['internal', 'trial', 'active'].includes(workspace.accessState) || !client?.active || client.isManager || client.timezone !== input.timezone || client.currencyCode !== input.currencyCode) {
      throw new NonRetryableJobError('Metrics context changed during collection')
    }
    const previous = await db.query.dailyAccountMetrics.findMany({ where: and(eq(dailyAccountMetrics.clientId, input.clientId), eq(dailyAccountMetrics.workspaceId, input.job.workspaceId!),
      gte(dailyAccountMetrics.metricDate, input.window.from), lte(dailyAccountMetrics.metricDate, input.window.through)) })
    const dates = input.dataset.accounts.filter((metric) => !previous.some((old) => old.metricDate === metric.date && old.sourceObservedAt && old.sourceObservedAt > input.observedAt)).map((metric) => metric.date)
    const collectedAt = new Date()
    const accountValues = input.dataset.accounts.filter((metric) => dates.includes(metric.date)).map((metric) => ({
      workspaceId: input.job.workspaceId!, clientId: input.clientId, metricDate: metric.date, currencyCode: input.currencyCode,
      costMicros: metric.costMicros, impressions: metric.impressions, clicks: metric.clicks, conversions: String(metric.conversions),
      conversionValueMicros: String(Math.round(metric.conversionValue * 1_000_000)), collectedAt, timezone: input.timezone,
      coverageStatus: metric.coverageStatus, sourceObservedAt: input.observedAt, sourceVersion: input.job.id, accountRows: metric.accountRows, campaignRows: metric.campaignRows,
    }))
    const campaignValues = input.dataset.campaigns.filter((metric) => dates.includes(metric.date)).map((metric) => ({
      workspaceId: input.job.workspaceId!, clientId: input.clientId, campaignId: metric.campaignId, metricDate: metric.date, campaignName: metric.campaignName,
      campaignType: metric.campaignType, status: metric.status, currencyCode: input.currencyCode, costMicros: metric.costMicros, impressions: metric.impressions,
      clicks: metric.clicks, conversions: String(metric.conversions), conversionValueMicros: String(Math.round(metric.conversionValue * 1_000_000)), collectedAt,
    }))
    if (dates.length) {
      // A complete unfiltered segmented report omits all-zero rows. Keep their
      // historical identity but replace the previously observed amounts by zero.
      await db.update(dailyCampaignMetrics).set({ costMicros: '0', impressions: '0', clicks: '0', conversions: '0', conversionValueMicros: '0', collectedAt })
        .where(and(eq(dailyCampaignMetrics.workspaceId, input.job.workspaceId!), eq(dailyCampaignMetrics.clientId, input.clientId), inArray(dailyCampaignMetrics.metricDate, dates)))
      await db.insert(dailyAccountMetrics).values(accountValues).onConflictDoUpdate({ target: [dailyAccountMetrics.clientId, dailyAccountMetrics.metricDate], set: {
        currencyCode: sql`excluded.currency_code`, costMicros: sql`excluded.cost_micros`, impressions: sql`excluded.impressions`, clicks: sql`excluded.clicks`,
        conversions: sql`excluded.conversions`, conversionValueMicros: sql`excluded.conversion_value_micros`, collectedAt, timezone: input.timezone,
        coverageStatus: sql`excluded.coverage_status`, sourceObservedAt: input.observedAt, sourceVersion: input.job.id,
        accountRows: sql`excluded.account_rows`, campaignRows: sql`excluded.campaign_rows`,
      } })
      for (let index = 0; index < campaignValues.length; index += 250) {
        remainingWorkMs(1_000)
        await db.insert(dailyCampaignMetrics).values(campaignValues.slice(index, index + 250)).onConflictDoUpdate({ target: [dailyCampaignMetrics.clientId, dailyCampaignMetrics.campaignId, dailyCampaignMetrics.metricDate], set: {
          campaignName: sql`excluded.campaign_name`, campaignType: sql`excluded.campaign_type`, status: sql`excluded.status`, currencyCode: input.currencyCode,
          costMicros: sql`excluded.cost_micros`, impressions: sql`excluded.impressions`, clicks: sql`excluded.clicks`, conversions: sql`excluded.conversions`,
          conversionValueMicros: sql`excluded.conversion_value_micros`, collectedAt,
        } })
      }
    }
    const result = { accountDays: dates.length, campaignDays: campaignValues.length, ignoredOlderDays: input.dataset.accounts.length - dates.length, period: input.window }
    await db.insert(auditEvents).values({ workspaceId: input.job.workspaceId!, actorUserId: 'system:metrics', action: 'metrics.chunk_completed', entityType: 'client', entityId: input.clientId,
      metadata: { ...result, jobId: input.job.id, timezone: input.timezone, sourceObservedAt: input.observedAt.toISOString(), sourceVersion: input.job.id } })
    const [checkpoint] = await db.update(jobs).set({ payload: { ...current.payload, metricSyncResult: result }, updatedAt: collectedAt }).where(leaseCondition(input.job)).returning({ id: jobs.id })
    if (!checkpoint) throw new Error('Metrics job lease lost before checkpoint')
    return result
  })
}
