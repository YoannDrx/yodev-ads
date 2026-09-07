import { beforeEach, describe, expect, it, vi } from 'vitest'
import { databaseDouble } from '../../test/fluent-db'

const mocks = vi.hoisted(() => ({
  databases: [] as unknown[],
  contexts: [] as unknown[],
  transaction: vi.fn(async (context: unknown, callback: (db: unknown) => unknown) => {
    mocks.contexts.push(context)
    return callback(mocks.databases.shift())
  }),
}))

vi.mock('@/db/transactions', () => ({ withTenantTransaction: mocks.transaction }))
vi.mock('@/lib/report-editions', () => ({ createReportEditionInTransaction: vi.fn(async () => ({ edition: { id: 'edition-1' } })), ReportDataUnavailable: class extends Error {} }))
vi.mock('@/lib/crypto', () => ({ encryptSecret: (value: string) => `encrypted:${value}`, decryptSecret: (value: string) => value.slice('encrypted:'.length) }))
vi.mock('@/lib/tokens', () => ({ hashToken: () => 'hash' }))

import { collectionScope, writeCollectionCursor, readCollectionCursor } from './collection-pagination'
import { entitlementContext } from './entitlements'
import {
  createApiApproval,
  createApiReport,
  getApiPerformance,
  getApiPortfolio,
  listApiAlerts,
  listApiApprovals,
  listApiReports,
} from './api-v1-repository'

const workspaceId = '00000000-0000-4000-8000-000000000001'
const clientId = '00000000-0000-4000-8000-000000000002'
const actorId = 'api-key:00000000-0000-4000-8000-000000000003'

function queryMap(input: Record<string, { first?: unknown; many?: unknown[] }> = {}) {
  return new Proxy({}, {
    get(_target, table) {
      const value = input[String(table)] ?? {}
      return {
        findFirst: vi.fn(async () => value.first),
        findMany: vi.fn(async () => value.many ?? []),
      }
    },
  }) as Record<string, Record<string, (...args: unknown[]) => unknown>>
}

describe('API v1 tenant repository', () => {
  beforeEach(() => {
    mocks.databases = []
    mocks.contexts = []
    vi.clearAllMocks()
  })

  it('loads performance only through the explicit tenant context', async () => {
    const client = { id: clientId, name: 'Client', currencyCode: 'EUR', timezone: 'Europe/Paris' }
    const metrics = [{ metricDate: '2026-08-12', costMicros: '100' }]
    mocks.databases.push(databaseDouble({ query: queryMap({
      clients: { first: client },
      dailyAccountMetrics: { many: metrics },
    }) }).db)
    await expect(getApiPerformance({
      workspaceId,
      actorId,
      clientId,
      from: '2026-08-01',
      to: '2026-08-12',
    })).resolves.toMatchObject({ client, metrics, coverage: { state: 'incomplete', expectedDays: 12, completeDays: 0, unqualifiedDates: ['2026-08-12'] } })
    expect(mocks.contexts).toEqual([{ workspaceId, userId: actorId }])
  })

  it('rejects a foreign or missing performance client before reading metrics', async () => {
    mocks.databases.push(databaseDouble({ query: queryMap({ clients: {} }) }).db)
    await expect(getApiPerformance({
      workspaceId,
      actorId,
      clientId,
      from: '2026-08-01',
      to: '2026-08-12',
    })).rejects.toMatchObject({ code: 'CLIENT_NOT_FOUND', status: 404 })
  })

  it('builds the portfolio summary inside one transaction', async () => {
    const accounts = [{ id: clientId, name: 'Client', isManager: false }]
    mocks.databases.push(databaseDouble({
      statementResults: [[{ count: 2 }], [{ count: 1 }]],
      query: queryMap({ clients: { many: accounts } }),
    }).db)
    await expect(getApiPortfolio({ workspaceId, actorId })).resolves.toEqual({
      accounts,
      alerts: { count: 2 },
      agents: { count: 1 },
    })
  })

  it('checks report quota under an advisory lock before insertion', async () => {
    const expiresAt = new Date('2026-11-10T00:00:00Z')
    const database = databaseDouble({
      statementResults: [[], [], [{ count: 2 }], [{ id: 'report-1', expiresAt }]],
      query: queryMap({ workspaces: { first: { accessState: 'active', plan: 'agency' } }, clients: { first: { id: clientId } } }),
    })
    mocks.databases.push(database.db)
    await expect(createApiReport({
      workspaceId,
      actorId,
      clientId,
      label: 'Monthly report',
      token: 'raw-token',
      entitlements: entitlementContext('active', 'agency'),
    })).resolves.toMatchObject({ id: 'report-1', expiresAt, editionId: 'edition-1' })
    expect(database.capture.values[0]).toMatchObject({
      workspaceId,
      clientId,
      createdBy: actorId,
      tokenHash: 'hash',
    })
  })

  it('fails report creation inside the transaction when the quota is exhausted', async () => {
    mocks.databases.push(databaseDouble({
      statementResults: [[], [], [{ count: 100 }]],
      query: queryMap({ workspaces: { first: { accessState: 'active', plan: 'agency' } }, clients: { first: { id: clientId } } }),
    }).db)
    await expect(createApiReport({
      workspaceId,
      actorId,
      clientId,
      label: 'Over quota',
      token: 'raw-token',
      entitlements: entitlementContext('active', 'solo'),
    })).rejects.toThrow('Quota exceeded')
  })

  it.each([['reports', listApiReports, 'report'], ['approvals', listApiApprovals, 'approval'], ['alerts', listApiAlerts, 'alert']] as const)('paginates %s with exact dates and hides cursor metadata', async (kind, list, field) => {
    const at = '2026-08-12T00:00:00.123456Z', snapshot = '2026-08-13T00:00:00.000000Z'
    const id = '00000000-0000-4000-8000-000000000009'
    const row = { [field]: { id, createdAt: new Date(at) }, client: { id: clientId, name: 'Client' }, cursorId: id, cursorAt: at }
    mocks.databases.push(databaseDouble({ statementResults: [{ rows: [{ at: snapshot }] }, [row, row]] }).db)
    const first = await list({ workspaceId, actorId, cursor: null, limit: 1 })
    expect(first.data).toEqual([{ [field]: row[field], client: row.client }])
    expect(first.nextCursor).toBeTruthy()
    const scope = collectionScope(workspaceId, `api:${kind}`, { actorId, ...(kind === 'alerts' ? { status: null } : {}) })
    expect(readCollectionCursor(first.nextCursor!, scope)).toMatchObject({ at, snapshot })
    mocks.databases.push(databaseDouble({ statementResults: [[row]] }).db)
    await expect(list({ workspaceId, actorId, cursor: first.nextCursor, limit: 20 })).resolves.toEqual({ data: first.data, nextCursor: null })
    expect(mocks.contexts.at(-1)).toEqual({ workspaceId, userId: actorId })
  })

  it.each([listApiReports, listApiApprovals, listApiAlerts])('rejects invalid cursors and page sizes', async (list) => {
    mocks.databases.push(databaseDouble().db, databaseDouble().db)
    await expect(list({ workspaceId, actorId, cursor: 'forged', limit: 20 })).rejects.toMatchObject({ code: 'INVALID_CURSOR', status: 400 })
    await expect(list({ workspaceId, actorId, limit: 101 })).rejects.toMatchObject({ code: 'INVALID_INPUT', status: 400 })
  })

  it('creates an API approval and immutable audit in the same transaction', async () => {
    const database = databaseDouble({ statementResults: [[{ id: 'approval-1' }]] })
    mocks.databases.push(database.db)
    await expect(createApiApproval({
      workspaceId,
      actorId,
      clientId,
      kind: 'campaign_status',
      title: 'Pause campaign',
      payload: { campaignId: '1', status: 'PAUSED' },
      resourceName: 'customers/1/campaigns/1',
      expectedState: { status: 'ENABLED' },
      proposedState: { status: 'PAUSED' },
      expectedStateHash: 'state-hash',
      requiredApprovals: 2,
      validationRequestId: 'google-request-1',
      requestId: 'api-request-1',
    })).resolves.toEqual({ id: 'approval-1' })
    expect(database.capture.values[0]).toMatchObject({
      workspaceId,
      requestedBy: actorId,
      requiredApprovals: 2,
    })
    expect(database.capture.values[1]).toMatchObject({
      action: 'approval.requested_via_api',
      metadata: expect.objectContaining({ requestId: 'api-request-1' }),
    })
  })

  it('binds the alert cursor to its filter, tenant and API key', async () => {
    const scope = collectionScope(workspaceId, 'api:alerts', { actorId, status: 'open' })
    const cursor = writeCollectionCursor({ scope, id: clientId, at: '2026-08-12T00:00:00.123456Z', snapshot: '2026-08-13T00:00:00.000000Z', expires: Date.now() + 60_000 })
    for (const change of [{ actorId: 'foreign-key' }, { workspaceId: clientId }, { status: 'resolved' as const }]) {
      mocks.databases.push(databaseDouble().db)
      await expect(listApiAlerts({ workspaceId, actorId, status: 'open', cursor, limit: 50, ...change })).rejects.toMatchObject({ code: 'INVALID_CURSOR' })
    }
  })
})
