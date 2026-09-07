import 'server-only'

import { and, asc, count, desc, eq, gte, lt, lte, or, sql } from 'drizzle-orm'
import {
  alertIncidents,
  approvalRequests,
  auditEvents,
  clients,
  dailyAccountMetrics,
  googleAdsConnections,
  monitoringAgents,
  shareLinks,
} from '@/db/schema'
import { withTenantTransaction } from '@/db/transactions'
import { ApiV1Error, type CursorValue } from '@/lib/api-v1'
import { requireQuota, type EntitlementContext } from '@/lib/entitlements'
import { createReportEditionInTransaction, ReportDataUnavailable } from '@/lib/report-editions'
import { storedReportPeriod, type ReportPeriodSelection } from '@/lib/report-period-selection'
import { encryptSecret } from '@/lib/crypto'
import { hashToken } from '@/lib/tokens'
import { lockWorkspaceEntitlements } from '@/lib/workspace-transaction-guard'
import { metricCoverage } from '@/lib/metric-coverage'

type ApiTenant = { workspaceId: string; actorId: string }

export function listApiAlerts(input: ApiTenant & {
  status?: 'open' | 'acknowledged' | 'snoozed' | 'resolved' | 'reopened'
  cursor: CursorValue | null
  limit: number
}) {
  return withTenantTransaction({ workspaceId: input.workspaceId, userId: input.actorId }, (db) => {
    const filters = [eq(alertIncidents.workspaceId, input.workspaceId)]
    if (input.status) filters.push(eq(alertIncidents.status, input.status))
    if (input.cursor) filters.push(or(
      lt(alertIncidents.detectedAt, input.cursor.at),
      and(eq(alertIncidents.detectedAt, input.cursor.at), lt(alertIncidents.id, input.cursor.id)),
    )!)
    return db
      .select({ alert: alertIncidents, client: { id: clients.id, name: clients.name } })
      .from(alertIncidents)
      .innerJoin(clients, and(eq(clients.id, alertIncidents.clientId), eq(clients.workspaceId, alertIncidents.workspaceId)))
      .where(and(...filters))
      .orderBy(desc(alertIncidents.detectedAt), desc(alertIncidents.id))
      .limit(input.limit + 1)
  })
}

export function listApiApprovals(input: ApiTenant & { cursor: CursorValue | null; limit: number }) {
  return withTenantTransaction({ workspaceId: input.workspaceId, userId: input.actorId }, (db) => db
    .select({
      approval: {
        id: approvalRequests.id,
        clientId: approvalRequests.clientId,
        requestedBy: approvalRequests.requestedBy,
        kind: approvalRequests.kind,
        title: approvalRequests.title,
        resourceName: approvalRequests.resourceName,
        expectedState: approvalRequests.expectedState,
        proposedState: approvalRequests.proposedState,
        requiredApprovals: approvalRequests.requiredApprovals,
        executionState: approvalRequests.executionState,
        reconciliationState: approvalRequests.reconciliationState,
        status: approvalRequests.status,
        expiresAt: approvalRequests.expiresAt,
        executedAt: approvalRequests.executedAt,
        createdAt: approvalRequests.createdAt,
        updatedAt: approvalRequests.updatedAt,
      },
      client: { id: clients.id, name: clients.name },
    })
    .from(approvalRequests)
    .innerJoin(clients, and(
      eq(clients.id, approvalRequests.clientId),
      eq(clients.workspaceId, approvalRequests.workspaceId),
    ))
    .where(and(
      eq(approvalRequests.workspaceId, input.workspaceId),
      input.cursor ? or(
        lt(approvalRequests.createdAt, input.cursor.at),
        and(eq(approvalRequests.createdAt, input.cursor.at), lt(approvalRequests.id, input.cursor.id)),
      ) : undefined,
    ))
    .orderBy(desc(approvalRequests.createdAt), desc(approvalRequests.id))
    .limit(input.limit + 1))
}

export function getApiApprovalContext(input: ApiTenant & { clientId: string }) {
  return withTenantTransaction({ workspaceId: input.workspaceId, userId: input.actorId }, async (db) => ({
    client: await db.query.clients.findFirst({
      where: and(eq(clients.id, input.clientId), eq(clients.workspaceId, input.workspaceId), eq(clients.active, true)),
    }),
    connection: await db.query.googleAdsConnections.findFirst({
      where: and(eq(googleAdsConnections.workspaceId, input.workspaceId), eq(googleAdsConnections.status, 'active')),
    }),
  }))
}

export function createApiApproval(input: ApiTenant & {
  clientId: string
  kind: string
  title: string
  payload: Record<string, unknown>
  resourceName: string
  expectedState: Record<string, unknown>
  proposedState: Record<string, unknown>
  expectedStateHash: string
  requiredApprovals: number
  validationRequestId: string | null
  requestId: string
}) {
  return withTenantTransaction({ workspaceId: input.workspaceId, userId: input.actorId }, async (db) => {
    const [approval] = await db.insert(approvalRequests).values({
      workspaceId: input.workspaceId,
      clientId: input.clientId,
      requestedBy: input.actorId,
      kind: input.kind,
      title: input.title,
      payload: input.payload,
      resourceName: input.resourceName,
      expectedState: input.expectedState,
      proposedState: input.proposedState,
      expectedStateHash: input.expectedStateHash,
      requiredApprovals: input.requiredApprovals,
      validationRequestId: input.validationRequestId,
      expiresAt: new Date(Date.now() + 24 * 60 * 60_000),
    }).returning()
    await db.insert(auditEvents).values({
      workspaceId: input.workspaceId,
      actorUserId: input.actorId,
      action: 'approval.requested_via_api',
      entityType: 'approval_request',
      entityId: approval.id,
      metadata: {
        kind: input.kind,
        clientId: input.clientId,
        validationRequestId: input.validationRequestId,
        requestId: input.requestId,
      },
    })
    return approval
  })
}

export function getApiPerformance(input: ApiTenant & { clientId: string; from: string; to: string }) {
  return withTenantTransaction({ workspaceId: input.workspaceId, userId: input.actorId }, async (db) => {
    const client = await db.query.clients.findFirst({
      where: and(eq(clients.id, input.clientId), eq(clients.workspaceId, input.workspaceId)),
      columns: { id: true, name: true, currencyCode: true, timezone: true },
    })
    if (!client) throw new ApiV1Error('CLIENT_NOT_FOUND', 'Client not found', 404)
    const metrics = await db.query.dailyAccountMetrics.findMany({
      where: and(
        eq(dailyAccountMetrics.workspaceId, input.workspaceId),
        eq(dailyAccountMetrics.clientId, client.id),
        gte(dailyAccountMetrics.metricDate, input.from),
        lte(dailyAccountMetrics.metricDate, input.to),
      ),
      orderBy: [asc(dailyAccountMetrics.metricDate)],
      limit: 750,
    })
    return { client, metrics, coverage: metricCoverage({ window: { from: input.from, through: input.to }, timezone: client.timezone, currencyCode: client.currencyCode, rows: metrics }) }
  })
}

export function getApiPortfolio(input: ApiTenant) {
  return withTenantTransaction({ workspaceId: input.workspaceId, userId: input.actorId }, async (db) => ({
    accounts: await db.query.clients.findMany({
      where: and(eq(clients.workspaceId, input.workspaceId), eq(clients.active, true)),
      columns: { id: true, googleCustomerId: true, name: true, currencyCode: true, timezone: true, isManager: true },
      orderBy: [clients.name],
    }),
    alerts: (await db.select({ count: count() }).from(alertIncidents).where(and(
      eq(alertIncidents.workspaceId, input.workspaceId),
      eq(alertIncidents.status, 'open'),
    )))[0],
    agents: (await db.select({ count: count() }).from(monitoringAgents).where(and(
      eq(monitoringAgents.workspaceId, input.workspaceId),
      eq(monitoringAgents.enabled, true),
    )))[0],
  }))
}

export function listApiReports(input: ApiTenant & { cursor: CursorValue | null; limit: number }) {
  return withTenantTransaction({ workspaceId: input.workspaceId, userId: input.actorId }, (db) => db
    .select({
      report: {
        id: shareLinks.id,
        clientId: shareLinks.clientId,
        label: shareLinks.label,
        mode: shareLinks.mode, periodDays: shareLinks.periodDays, periodConfig: shareLinks.periodConfig, locale: shareLinks.locale,
        active: shareLinks.active,
        allowFeedback: shareLinks.allowFeedback,
        lastViewedAt: shareLinks.lastViewedAt,
        expiresAt: shareLinks.expiresAt,
        createdAt: shareLinks.createdAt,
        updatedAt: shareLinks.updatedAt,
      },
      client: { id: clients.id, name: clients.name },
    })
    .from(shareLinks)
    .innerJoin(clients, and(eq(clients.id, shareLinks.clientId), eq(clients.workspaceId, shareLinks.workspaceId)))
    .where(and(
      eq(shareLinks.workspaceId, input.workspaceId),
      input.cursor ? or(
        lt(shareLinks.createdAt, input.cursor.at),
        and(eq(shareLinks.createdAt, input.cursor.at), lt(shareLinks.id, input.cursor.id)),
      ) : undefined,
    ))
    .orderBy(desc(shareLinks.createdAt), desc(shareLinks.id))
    .limit(input.limit + 1))
}

export function createApiReport(input: ApiTenant & {
  clientId: string
  label: string
  token: string
  periodConfig?: ReportPeriodSelection
  mode?: 'dynamic' | 'fixed'
  locale?: 'fr' | 'en'
  entitlements: EntitlementContext
}) {
  return withTenantTransaction({ workspaceId: input.workspaceId, userId: input.actorId }, async (db) => {
    const entitlements = await lockWorkspaceEntitlements(db, input.workspaceId, 'api.propose')
    if (!['agency', 'internal'].includes(entitlements.plan)) throw new ApiV1Error('ENTITLEMENT_REQUIRED', 'Report creation through API requires Agency', 403)
    const client = await db.query.clients.findFirst({
      where: and(eq(clients.id, input.clientId), eq(clients.workspaceId, input.workspaceId), eq(clients.active, true), eq(clients.isManager, false)),
      columns: { id: true },
    })
    if (!client) throw new ApiV1Error('CLIENT_NOT_FOUND', 'Active advertiser account not found', 404)
    await db.execute(sql`select pg_advisory_xact_lock(hashtext(${`${input.workspaceId}:reports`}))`)
    const [usage] = await db.select({ count: count() }).from(shareLinks).where(and(eq(shareLinks.workspaceId, input.workspaceId), eq(shareLinks.active, true)))
    requireQuota(entitlements, 'reports', usage.count)
    const periodConfig = storedReportPeriod({ periodDays: 30, periodConfig: input.periodConfig })
    const [created] = await db.insert(shareLinks).values({
      workspaceId: input.workspaceId, clientId: client.id, createdBy: input.actorId, label: input.label,
      tokenHash: hashToken(input.token), tokenPrefix: input.token.slice(0, 12), encryptedReportToken: encryptSecret(input.token),
      mode: input.mode ?? 'fixed', locale: input.locale ?? 'fr', periodConfig,
      periodDays: ['7', '30', '90'].includes(periodConfig.period) ? Number(periodConfig.period) : 30,
      expiresAt: new Date(Date.now() + 90 * 86_400_000),
    }).returning({ id: shareLinks.id, expiresAt: shareLinks.expiresAt })
    if (!created) throw new ApiV1Error('REPORT_UNAVAILABLE', 'Report publication failed', 409)
    try {
      const issued = await createReportEditionInTransaction(db, { workspaceId: input.workspaceId, shareId: created.id, actorUserId: input.actorId, kind: input.mode === 'dynamic' ? 'dynamic' : 'initial' })
      return { ...created, editionId: issued.edition.id, periodFrom: issued.edition.periodFrom, periodThrough: issued.edition.periodThrough, timezone: issued.edition.timezone, sourceVersion: issued.edition.sourceVersion }
    } catch (error) {
      if (error instanceof ReportDataUnavailable) throw new ApiV1Error('REPORT_DATA_UNAVAILABLE', 'Complete stored history is required for this period', 409)
      throw error
    }
  })
}
