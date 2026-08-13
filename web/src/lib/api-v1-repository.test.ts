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
    })).resolves.toEqual({ client, metrics })
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
      statementResults: [[], [{ count: 2 }], [{ id: 'report-1', expiresAt }]],
      query: queryMap({ clients: { first: { id: clientId } } }),
    })
    mocks.databases.push(database.db)
    await expect(createApiReport({
      workspaceId,
      actorId,
      clientId,
      label: 'Monthly report',
      tokenHash: 'hash',
      tokenPrefix: 'prefix',
      entitlements: entitlementContext('active', 'agency'),
    })).resolves.toEqual({ id: 'report-1', expiresAt })
    expect(database.capture.values[0]).toMatchObject({
      workspaceId,
      clientId,
      createdBy: actorId,
      tokenHash: 'hash',
    })
  })

  it('fails report creation inside the transaction when the quota is exhausted', async () => {
    mocks.databases.push(databaseDouble({
      statementResults: [[], [{ count: 3 }]],
      query: queryMap({ clients: { first: { id: clientId } } }),
    }).db)
    await expect(createApiReport({
      workspaceId,
      actorId,
      clientId,
      label: 'Over quota',
      tokenHash: 'hash',
      tokenPrefix: 'prefix',
      entitlements: entitlementContext('active', 'solo'),
    })).rejects.toThrow('Quota exceeded')
  })

  it('lists reports and approvals with both initial and cursor pages', async () => {
    const createdAt = new Date('2026-08-12T00:00:00Z')
    const reportRows = [{ report: { id: 'report-1', createdAt }, client: { id: clientId, name: 'Client' } }]
    const approvalRows = [{ approval: { id: 'approval-1', createdAt }, client: { id: clientId, name: 'Client' } }]
    mocks.databases.push(
      databaseDouble({ statementResults: [reportRows] }).db,
      databaseDouble({ statementResults: [approvalRows] }).db,
      databaseDouble({ statementResults: [reportRows] }).db,
      databaseDouble({ statementResults: [approvalRows] }).db,
    )
    await expect(listApiReports({ workspaceId, actorId, cursor: null, limit: 20 })).resolves.toEqual(reportRows)
    await expect(listApiApprovals({ workspaceId, actorId, cursor: null, limit: 20 })).resolves.toEqual(approvalRows)
    const cursor = { at: createdAt, id: '00000000-0000-4000-8000-000000000009' }
    await expect(listApiReports({ workspaceId, actorId, cursor, limit: 20 })).resolves.toEqual(reportRows)
    await expect(listApiApprovals({ workspaceId, actorId, cursor, limit: 20 })).resolves.toEqual(approvalRows)
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

  it('applies cursor pagination queries without escaping the tenant repository', async () => {
    const rows = [{ alert: { id: 'alert-1', detectedAt: new Date() }, client: { id: clientId, name: 'Client' } }]
    mocks.databases.push(databaseDouble({ statementResults: [rows] }).db)
    await expect(listApiAlerts({
      workspaceId,
      actorId,
      status: 'open',
      cursor: { at: new Date('2026-08-12T00:00:00Z'), id: '00000000-0000-4000-8000-000000000004' },
      limit: 50,
    })).resolves.toEqual(rows)
    expect(mocks.contexts.at(-1)).toEqual({ workspaceId, userId: actorId })
  })
})
