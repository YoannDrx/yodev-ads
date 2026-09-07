import 'server-only'

import { createHash, randomUUID } from 'node:crypto'
import { and, asc, desc, eq, gte, lte, sql } from 'drizzle-orm'
import { auditEvents, clients, dailyAccountMetrics, reportEditions, shareLinks, workspaces } from '@/db/schema'
import { type DatabaseTransaction, withSystemTransaction, withTenantTransaction } from '@/db/transactions'
import { buildClientReportModel, deserializeClientReport, serializeClientReport, type ClientReportModel } from '@/lib/client-report-model'
import { encryptSecret } from '@/lib/crypto'
import { metricCoverage } from '@/lib/metric-coverage'
import { resolveReportPeriod, storedReportPeriod, type ReportPeriodSelection } from '@/lib/report-period-selection'
import { lockWorkspaceEntitlements } from '@/lib/workspace-transaction-guard'

export const REPORT_MODEL_VERSION = 1
export class ReportDataUnavailable extends Error {
  constructor() { super('Les données complètes de cette période ne sont pas disponibles. Actualisez l’historique du compte avant de publier ce bilan.') }
}
export type ReportDeliveryPayload = { from: string; to: string[]; subject: string; html: string }
type EditionInput = {
  workspaceId: string; shareId: string; actorUserId: string
  kind: 'dynamic' | 'initial' | 'revision' | 'scheduled'
  now?: Date; anchorAt?: Date; previousEditionId?: string
  period?: ReportPeriodSelection
  periodSource?: { periodDays: number; periodConfig?: unknown }
  editorial?: { locale: string; editorialComment: string | null; actionPlan: string | null }
  delivery?: { scheduleId: string; runKey: string; tokenHash: string; build: (editionId: string, model: ClientReportModel) => ReportDeliveryPayload }
}
function conversionUnits(value: string) {
  const match = /^(-?)(\d+)(?:\.(\d{1,4}))?$/.exec(value)
  if (!match) throw new ReportDataUnavailable()
  return BigInt(`${match[1]}${match[2]}${(match[3] ?? '').padEnd(4, '0')}`)
}
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')

async function reportContext(db: DatabaseTransaction, workspaceId: string, shareId: string) {
  // Shares the workspace lock with selection and the metric lock with collectors.
  await lockWorkspaceEntitlements(db, workspaceId, 'google.read')
  const [share] = await db.select().from(shareLinks).where(and(eq(shareLinks.id, shareId), eq(shareLinks.workspaceId, workspaceId), eq(shareLinks.active, true))).limit(1).for('update')
  if (!share) throw new ReportDataUnavailable()
  const client = await db.query.clients.findFirst({ where: and(eq(clients.id, share.clientId), eq(clients.workspaceId, workspaceId), eq(clients.active, true), eq(clients.isManager, false)) })
  const workspace = await db.query.workspaces.findFirst({ where: eq(workspaces.id, workspaceId) })
  if (!client || !workspace) throw new ReportDataUnavailable()
  return { share, client, workspace }
}

function editionModel(edition: typeof reportEditions.$inferSelect, now: Date) {
  if (edition.modelVersion !== REPORT_MODEL_VERSION || edition.expiresAt <= now) throw new ReportDataUnavailable()
  const model = deserializeClientReport(edition.payload)
  if (model.window?.from !== edition.periodFrom || model.window.through !== edition.periodThrough || model.window.timezone !== edition.timezone || model.currencyCode !== edition.currencyCode || model.sourceVersion !== edition.sourceVersion || model.generatedAt.getTime() !== edition.generatedAt.getTime()) throw new ReportDataUnavailable()
  return model
}

type CampaignAggregate = {
  campaign_id: string; name: string; channel_type: string; status: string; currency_valid: boolean
  cost_micros: string; impressions: string; clicks: string; conversions: string; conversion_value_micros: string
}

/** No provider calls: coherent history is read under the collector's transaction lock. */
export async function createReportEditionInTransaction(db: DatabaseTransaction, input: EditionInput) {
  const now = input.now ?? new Date()
  const context = await reportContext(db, input.workspaceId, input.shareId)
  const scope = and(eq(reportEditions.workspaceId, input.workspaceId), eq(reportEditions.shareId, input.shareId))
  const fixedKey = input.kind === 'initial' ? 'initial' : input.kind === 'scheduled' && input.delivery ? `scheduled:${input.delivery.scheduleId}:${input.delivery.runKey}` : null
  if (fixedKey) {
    const existing = await db.query.reportEditions.findFirst({ where: and(scope, eq(reportEditions.deduplicationKey, fixedKey)) })
    if (existing) return { edition: existing, model: editionModel(existing, now), created: false }
  }
  const previous = input.kind === 'revision' && input.previousEditionId
    ? await db.query.reportEditions.findFirst({ where: and(scope, eq(reportEditions.id, input.previousEditionId)) }) : undefined
  if (input.kind === 'revision' && !previous) throw new ReportDataUnavailable()
  const previousModel = previous ? editionModel(previous, now) : undefined
  const period = previous ? { period: 'custom' as const, from: previous.periodFrom, through: previous.periodThrough } : input.period ?? storedReportPeriod(input.periodSource ?? context.share)
  const window = resolveReportPeriod(period, input.anchorAt ?? now, previous?.timezone ?? context.client.timezone)
  if (context.client.timezone !== window.timezone || (previous && context.client.currencyCode !== previous.currencyCode)) throw new ReportDataUnavailable()
  await db.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`metrics:${input.workspaceId}:${context.client.id}`}, 0))`)
  const rows = await db.query.dailyAccountMetrics.findMany({ where: and(eq(dailyAccountMetrics.workspaceId, input.workspaceId), eq(dailyAccountMetrics.clientId, context.client.id), gte(dailyAccountMetrics.metricDate, window.from), lte(dailyAccountMetrics.metricDate, window.through)), orderBy: [asc(dailyAccountMetrics.metricDate)] })
  const coverage = metricCoverage({ window, timezone: window.timezone, currencyCode: context.client.currencyCode, now, rows })
  if (coverage.state !== 'complete') throw new ReportDataUnavailable()
  const aggregates = await db.execute<CampaignAggregate>(sql`
    select campaign_id, (array_agg(campaign_name order by metric_date desc))[1] as name,
      coalesce((array_agg(campaign_type order by metric_date desc))[1], 'UNKNOWN') as channel_type,
      coalesce((array_agg(status order by metric_date desc))[1], 'UNKNOWN') as status,
      bool_and(currency_code = ${context.client.currencyCode}) as currency_valid,
      sum(cost_micros)::text as cost_micros, sum(impressions)::text as impressions, sum(clicks)::text as clicks,
      sum(conversions)::text as conversions, sum(conversion_value_micros)::text as conversion_value_micros
    from daily_campaign_metrics where workspace_id = ${input.workspaceId} and client_id = ${context.client.id}
      and metric_date >= ${window.from} and metric_date <= ${window.through}
    group by campaign_id order by campaign_id
  `)
  if (aggregates.rows.some((row) => !row.currency_valid)) throw new ReportDataUnavailable()
  const accountTotals = {
    costMicros: rows.reduce((sum, row) => sum + BigInt(row.costMicros), BigInt(0)).toString(),
    impressions: rows.reduce((sum, row) => sum + BigInt(row.impressions), BigInt(0)).toString(),
    clicks: rows.reduce((sum, row) => sum + BigInt(row.clicks), BigInt(0)).toString(),
    conversions: Number(rows.reduce((sum, row) => sum + conversionUnits(row.conversions), BigInt(0))) / 10_000,
    conversionValueMicros: rows.reduce((sum, row) => sum + BigInt(row.conversionValueMicros), BigInt(0)).toString(),
  }
  // Provenance includes account coverage versions and the exact campaign aggregates.
  const sourceVersion = digest({ window: { from: window.from, through: window.through, timezone: window.timezone }, currency: context.client.currencyCode, rows: rows.map((row) => ({ date: row.metricDate, version: row.sourceVersion, observedAt: row.sourceObservedAt, cost: row.costMicros, impressions: row.impressions, clicks: row.clicks, conversions: row.conversions, value: row.conversionValueMicros })), campaigns: aggregates.rows })
  const whiteLabel = ['studio', 'agency', 'internal'].includes(context.workspace.plan)
  const model = buildClientReportModel({ generatedAt: now, window: { from: window.from, through: window.through, timezone: window.timezone }, sourceVersion, accountTotals,
    brandName: previousModel?.brandName ?? (whiteLabel ? context.workspace.brandName : 'Ads by Yodev'),
    poweredByYodev: previousModel?.poweredByYodev ?? context.workspace.plan === 'studio',
    clientName: previousModel?.clientName ?? context.client.name, currencyCode: context.client.currencyCode,
    locale: input.editorial?.locale ?? previousModel?.locale ?? context.share.locale,
    editorialComment: input.editorial ? input.editorial.editorialComment : previousModel ? previousModel.editorialComment : context.share.editorialComment,
    actionPlan: input.editorial ? input.editorial.actionPlan : previousModel ? previousModel.actionPlan : context.share.actionPlan,
    campaigns: aggregates.rows.map((row) => ({ id: row.campaign_id, name: row.name, status: row.status, channelType: row.channel_type,
      budgetResourceName: '', budgetMicros: '0', costMicros: row.cost_micros, impressions: row.impressions, clicks: row.clicks, conversions: Number(row.conversions), conversionValueMicros: row.conversion_value_micros,
      searchBudgetLostImpressionShare: null, searchRankLostImpressionShare: null })),
  })
  const payload = serializeClientReport(model)
  const contentVersion = digest({ ...payload, generatedAt: undefined })
  const deduplicationKey = fixedKey ?? `${input.kind}:${previous?.id ?? ''}:${contentVersion}${input.kind === 'dynamic' ? `:${Math.floor(now.getTime() / (90 * 86_400_000))}` : ''}`
  const existing = await db.query.reportEditions.findFirst({ where: and(scope, eq(reportEditions.deduplicationKey, deduplicationKey)) })
  if (existing) return { edition: existing, model: editionModel(existing, now), created: false }
  if (Buffer.byteLength(JSON.stringify(payload), 'utf8') > 15_000_000) throw new ReportDataUnavailable()
  const latest = await db.query.reportEditions.findFirst({ where: scope, orderBy: [desc(reportEditions.editionNumber)], columns: { editionNumber: true } })
  const id = randomUUID()
  if ((input.kind === 'scheduled') !== Boolean(input.delivery)) throw new Error('Invalid scheduled report edition')
  const [edition] = await db.insert(reportEditions).values({ id, workspaceId: input.workspaceId, clientId: context.client.id, shareId: context.share.id,
    scheduleId: input.delivery?.scheduleId, runKey: input.delivery?.runKey, kind: input.kind, previousEditionId: previous?.id,
    editionNumber: (latest?.editionNumber ?? 0) + 1, deduplicationKey, modelVersion: REPORT_MODEL_VERSION,
    periodFrom: window.from, periodThrough: window.through, timezone: window.timezone, currencyCode: context.client.currencyCode,
    sourceVersion, payload, generatedAt: now, expiresAt: new Date(now.getTime() + 90 * 86_400_000),
    encryptedDelivery: input.delivery ? encryptSecret(JSON.stringify(input.delivery.build(id, model))) : null,
    deliveryTokenHash: input.delivery?.tokenHash,
  }).returning()
  await db.insert(auditEvents).values({ workspaceId: input.workspaceId, actorUserId: input.actorUserId, action: 'report.edition_created', entityType: 'report_edition', entityId: edition.id,
    metadata: { shareId: context.share.id, kind: input.kind, editionNumber: edition.editionNumber, from: window.from, through: window.through, timezone: window.timezone, sourceVersion, previousEditionId: previous?.id ?? null } })
  return { edition, model, created: true }
}

export function getPublicReportEdition(input: { workspaceId: string; shareId: string; editionId?: string; now?: Date }) {
  if (input.editionId && !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(input.editionId)) throw new ReportDataUnavailable()
  return withSystemTransaction(async (db) => {
    const now = input.now ?? new Date()
    const { share } = await reportContext(db, input.workspaceId, input.shareId)
    if (share.expiresAt && share.expiresAt <= now) throw new ReportDataUnavailable()
    if (input.editionId || share.mode === 'fixed') {
      const edition = await db.query.reportEditions.findFirst({ where: and(eq(reportEditions.workspaceId, input.workspaceId), eq(reportEditions.shareId, input.shareId), input.editionId ? eq(reportEditions.id, input.editionId) : undefined), orderBy: [asc(reportEditions.editionNumber)] })
      if (!edition) throw new ReportDataUnavailable()
      return { edition, model: editionModel(edition, now), created: false }
    }
    return createReportEditionInTransaction(db, { ...input, kind: 'dynamic', actorUserId: 'system:public-report', now })
  })
}

export function listWorkspaceReportEditions(workspaceId: string) {
  return withTenantTransaction({ workspaceId, userId: 'repository:report-editions' }, (db) => db.query.reportEditions.findMany({ where: eq(reportEditions.workspaceId, workspaceId),
    columns: { id: true, shareId: true, clientId: true, kind: true, editionNumber: true, periodFrom: true, periodThrough: true, timezone: true, sourceVersion: true, generatedAt: true, expiresAt: true, previousEditionId: true },
    orderBy: [desc(reportEditions.generatedAt)], limit: 100,
  }))
}
