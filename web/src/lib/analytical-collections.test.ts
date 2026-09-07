import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { databaseDouble } from '../../test/fluent-db'
import type { ClaimedJob } from './jobs'
import { analyticalFamilies, ANALYTICAL_FAMILIES } from './analytical-model'

const mocks = vi.hoisted(() => ({ dbs: [] as unknown[], transaction: vi.fn(async (fn: (db: unknown) => unknown) => fn(mocks.dbs.shift())), constructor: vi.fn(), read: vi.fn(), lock: vi.fn() }))
vi.mock('@/db/transactions', () => ({ withSystemTransaction: mocks.transaction, withTenantTransaction: vi.fn() }))
vi.mock('@/lib/workspace-transaction-guard', () => ({ lockWorkspaceEntitlements: mocks.lock }))
vi.mock('@/lib/google-ads', () => ({ GoogleAdsGateway: class {
  constructor(...args: unknown[]) {
    mocks.constructor(...args)
    return new Proxy(this, { get(target, key) { return key === 'collectedRequestIds' ? () => ['request-1'] : (...args: unknown[]) => mocks.read(key, ...args) } })
  }
} }))
import { analyticalCollectionJobs, collectAnalyticalFamily, persistAnalyticalCollection } from './analytical-collections'

const now = new Date('2026-09-07T09:00:00Z')
const workspaceId = '00000000-0000-4000-8000-000000000001'
const clientId = '00000000-0000-4000-8000-000000000002'
const jobId = '00000000-0000-4000-8000-000000000003'
const client = { id: clientId, workspaceId, googleCustomerId: '1234567890', timezone: 'Europe/Paris', currencyCode: 'EUR' }
const connection = { id: workspaceId, status: 'active' }
function job(family = 'campaigns'): ClaimedJob {
  return { id: jobId, workspaceId, type: 'analytics.collect', attemptCount: 1, leaseOwner: 'worker', status: 'running',
    payload: { workspaceId, clientId, family, timezone: client.timezone, currencyCode: 'EUR', from: '2026-08-08', through: '2026-09-06', contractVersion: 1 } } as unknown as ClaimedJob
}
function db(current = job(), options: { client?: unknown; connection?: unknown; statements?: unknown[] } = {}) {
  return databaseDouble({ statementResults: options.statements ?? [[current]], query: {
    clients: { findFirst: async () => options.client === undefined ? client : options.client },
    googleAdsConnections: { findFirst: async () => options.connection === undefined ? connection : options.connection },
  } })
}
beforeEach(() => { vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(now); mocks.dbs = []; mocks.read.mockResolvedValue([]); mocks.lock.mockResolvedValue({}) })
afterEach(() => vi.useRealTimers())

describe('analytical collection worker', () => {
  it.each(analyticalFamilies)('pins the period and saves %s independently with provider receipt and checkpoint', async (family) => {
    const current = job(family)
    const persistence = db(current, { statements: [[current], [{ id: jobId }], [], [{ id: jobId }]] })
    mocks.dbs.push(db(current).db, persistence.db)
    await expect(collectAnalyticalFamily(current)).resolves.toMatchObject({ family, stored: true, requestIds: ['request-1'] })
    expect(mocks.constructor).toHaveBeenCalledWith(connection, { from: '2026-08-08', through: '2026-09-06' })
    expect(mocks.read).toHaveBeenCalledExactlyOnceWith(ANALYTICAL_FAMILIES[family].method, client.googleCustomerId, ...(family === 'assets' ? ['2026-09-07'] : []))
    expect(persistence.capture.values[0]).toMatchObject({ workspaceId, clientId, family, sourceVersion: jobId, periodThrough: '2026-09-06', payload: [] })
    expect(persistence.capture.sets[0]).toMatchObject({ payload: { analyticalResult: { family, stored: true } } })
  })
  it('does not open a write transaction after provider failure or an oversized response', async () => {
    mocks.dbs.push(db().db)
    mocks.read.mockRejectedValueOnce(new Error('provider failure'))
    await expect(collectAnalyticalFamily(job())).rejects.toThrow('provider failure')
    expect(mocks.transaction).toHaveBeenCalledTimes(1)
    mocks.dbs.push(db().db); mocks.read.mockResolvedValueOnce(['x'.repeat(2_000_000)])
    await expect(collectAnalyticalFamily(job())).rejects.toThrow('supported collection size')
    expect(mocks.transaction).toHaveBeenCalledTimes(2)
  })
  it('rejects changed scope, timezone, missing connection and a lost final lease', async () => {
    await expect(collectAnalyticalFamily({ ...job(), workspaceId: clientId })).rejects.toThrow('scope mismatch')
    mocks.dbs.push(db({ ...job(), payload: { ...job().payload, family: 'ads' } }).db)
    await expect(collectAnalyticalFamily(job())).rejects.toThrow('payload changed')
    mocks.dbs.push(db(job(), { client: { ...client, timezone: 'UTC' } }).db)
    await expect(collectAnalyticalFamily(job())).rejects.toThrow('context changed')
    mocks.dbs.push(db(job(), { connection: null }).db)
    await expect(collectAnalyticalFamily(job())).rejects.toThrow('context changed')
    expect(mocks.read).not.toHaveBeenCalled()
    mocks.dbs.push(db(job(), { statements: [[job()], [{ id: jobId }], [], []] }).db)
    await expect(persistAnalyticalCollection({ job: job(), connectionId: connection.id, observedAt: now, payload: [], requestIds: [] })).rejects.toThrow('before checkpoint')
  })
  it('returns a committed result without the provider even after revocation', async () => {
    mocks.dbs.push(db({ ...job(), payload: { ...job().payload, analyticalResult: { stored: true } } }, { connection: null }).db)
    await expect(collectAnalyticalFamily(job())).resolves.toEqual({ stored: true })
    expect(mocks.read).not.toHaveBeenCalled()
    expect(mocks.lock).not.toHaveBeenCalled()
  })
  it('partitions one daily generation across 17 families with stable keys and account-local dates', () => {
    const input = { workspaceId, clientId, timezone: 'Pacific/Honolulu', currencyCode: 'USD', generation: 'daily:2026-09-06', now: new Date('2026-09-07T01:00:00Z') }
    const batch = analyticalCollectionJobs(input)
    expect(batch).toHaveLength(17)
    expect(new Set(batch.map((item) => item.deduplicationKey)).size).toBe(17)
    expect(batch[0].payload).toMatchObject({ from: '2026-08-07', through: '2026-09-05', currencyCode: 'USD' })
    expect(analyticalCollectionJobs(input)).toEqual(batch)
  })
})
