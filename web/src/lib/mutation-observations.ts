import 'server-only'

import { and, count, eq, gte, inArray, lte, sum } from 'drizzle-orm'
import {
  approvalRequests,
  auditEvents,
  clients,
  dailyCampaignMetrics,
  jobs,
  mutationObservations,
} from '@/db/schema'
import { type DatabaseTransaction, withSystemTransaction } from '@/db/transactions'
import {
  mutationObservationCalendar,
  mutationObservationOutcome,
  type MutationObservationMetrics,
} from '@/lib/mutation-observation'

type Approval = typeof approvalRequests.$inferSelect
type Client = typeof clients.$inferSelect

export function mutationCampaignIds(payload: Record<string, unknown>) {
  const direct = typeof payload.campaignId === 'string' ? [payload.campaignId] : []
  const directMany = Array.isArray(payload.campaignIds) ? payload.campaignIds.map(String) : []
  const changes = Array.isArray(payload.changes) ? payload.changes : []
  const operations = Array.isArray(payload.operations) ? payload.operations : []
  const nested = [...changes, ...operations].flatMap((item) =>
    item && typeof item === 'object' && typeof (item as Record<string, unknown>).campaignId === 'string'
      ? [String((item as Record<string, unknown>).campaignId)]
      : [],
  )
  return [...new Set([...direct, ...directMany, ...nested].filter((id) => /^\d+$/.test(id)))]
    .sort((left, right) => BigInt(left) < BigInt(right) ? -1 : BigInt(left) > BigInt(right) ? 1 : 0)
}

async function aggregateMetrics(
  db: DatabaseTransaction,
  input: { workspaceId: string; clientId: string; campaignIds: string[]; from: string; through: string; windowDays: number },
): Promise<MutationObservationMetrics> {
  const expectedDataPoints = input.campaignIds.length * input.windowDays
  if (expectedDataPoints === 0) return {
    dataPoints: 0,
    expectedDataPoints: 0,
    costMicros: '0', impressions: '0', clicks: '0', conversions: '0', conversionValueMicros: '0',
  }
  const [metrics] = await db.select({
    dataPoints: count(),
    costMicros: sum(dailyCampaignMetrics.costMicros),
    impressions: sum(dailyCampaignMetrics.impressions),
    clicks: sum(dailyCampaignMetrics.clicks),
    conversions: sum(dailyCampaignMetrics.conversions),
    conversionValueMicros: sum(dailyCampaignMetrics.conversionValueMicros),
  }).from(dailyCampaignMetrics).where(and(
    eq(dailyCampaignMetrics.workspaceId, input.workspaceId),
    eq(dailyCampaignMetrics.clientId, input.clientId),
    inArray(dailyCampaignMetrics.campaignId, input.campaignIds),
    gte(dailyCampaignMetrics.metricDate, input.from),
    lte(dailyCampaignMetrics.metricDate, input.through),
  ))
  return {
    dataPoints: Number(metrics.dataPoints),
    expectedDataPoints,
    costMicros: metrics.costMicros ?? '0',
    impressions: metrics.impressions ?? '0',
    clicks: metrics.clicks ?? '0',
    conversions: metrics.conversions ?? '0',
    conversionValueMicros: metrics.conversionValueMicros ?? '0',
  }
}

export async function scheduleMutationObservationWithDatabase(
  db: DatabaseTransaction,
  input: { approval: Approval; client: Client; executedAt: Date },
) {
  const windowDays = input.approval.observationWindowDays
  const calendar = mutationObservationCalendar(input.executedAt, input.client.timezone, windowDays)
  const campaignIds = mutationCampaignIds(input.approval.payload)
  if (campaignIds.length === 0) throw new Error('Mutation observation requires at least one campaign')
  const baselineMetrics = await aggregateMetrics(db, {
    workspaceId: input.approval.workspaceId,
    clientId: input.approval.clientId,
    campaignIds,
    from: calendar.baselineFrom,
    through: calendar.baselineThrough,
    windowDays,
  })
  const [observation] = await db.insert(mutationObservations).values({
    workspaceId: input.approval.workspaceId,
    approvalId: input.approval.id,
    clientId: input.approval.clientId,
    windowDays,
    campaignIds,
    baselineFrom: calendar.baselineFrom,
    baselineThrough: calendar.baselineThrough,
    observationFrom: calendar.observationFrom,
    observationThrough: calendar.observationThrough,
    baselineMetrics,
  }).onConflictDoNothing({ target: mutationObservations.approvalId }).returning()

  const observationId = observation?.id ?? (await db.query.mutationObservations.findFirst({
    where: eq(mutationObservations.approvalId, input.approval.id),
    columns: { id: true },
  }))?.id
  if (!observationId) throw new Error('Mutation observation could not be resolved')
  await db.insert(jobs).values({
    workspaceId: input.approval.workspaceId,
    type: 'mutation.observe',
    payload: { observationId },
    priority: 70,
    availableAt: calendar.availableAt,
    deduplicationKey: `mutation.observe:${input.approval.id}`,
  }).onConflictDoNothing({ target: jobs.deduplicationKey })
  return observation ?? null
}

export async function completeMutationObservation(observationId: string, completedAt = new Date()) {
  return withSystemTransaction(async (db) => {
    const [observation] = await db.select().from(mutationObservations).where(and(
      eq(mutationObservations.id, observationId),
      eq(mutationObservations.status, 'scheduled'),
    )).limit(1).for('update')
    if (!observation) return { status: 'already_processed' as const }
    const observedMetrics = await aggregateMetrics(db, {
      workspaceId: observation.workspaceId,
      clientId: observation.clientId,
      campaignIds: observation.campaignIds,
      from: observation.observationFrom,
      through: observation.observationThrough,
      windowDays: observation.windowDays,
    })
    const outcome = mutationObservationOutcome(observation.baselineMetrics, observedMetrics)
    await db.update(mutationObservations).set({
      status: outcome.state,
      observedMetrics,
      outcome,
      completedAt,
      updatedAt: completedAt,
    }).where(and(eq(mutationObservations.id, observation.id), eq(mutationObservations.status, 'scheduled')))
    await db.insert(auditEvents).values({
      workspaceId: observation.workspaceId,
      actorUserId: 'system:mutation-observer',
      action: 'mutation.observation_completed',
      entityType: 'approval_request',
      entityId: observation.approvalId,
      metadata: { observationId: observation.id, state: outcome.state, coverage: outcome.coverage },
    })
    return { status: outcome.state, outcome }
  })
}
