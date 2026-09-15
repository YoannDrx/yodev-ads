import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { databaseDouble } from '../../test/fluent-db'
import type { ClaimedJob } from './jobs'
import { normalizeMetricSyncData } from './metric-sync-data'

const mocks = vi.hoisted(() => ({ dbs: [] as unknown[], transaction: vi.fn(async (fn: (db: unknown) => unknown) => fn(mocks.dbs.shift())), enqueue: vi.fn(), lookback: vi.fn(), accounts: vi.fn(), campaigns: vi.fn() }))
vi.mock('@/db/transactions', () => ({ withSystemTransaction: mocks.transaction }))
vi.mock('@/lib/jobs', async (original) => ({ ...await original<typeof import('./jobs')>(), enqueueJobs: mocks.enqueue }))
vi.mock('@/lib/google-ads', () => ({ GoogleAdsGateway: class { conversionLookbackDays = mocks.lookback; dailyAccountMetrics = mocks.accounts; dailyCampaignMetrics = mocks.campaigns } }))
import { executeMetricSyncChunk, fanOutMetricSync, persistMetricSyncChunk } from './metrics-sync'

const workspaceId = '00000000-0000-4000-8000-000000000001'
const clientId = '00000000-0000-4000-8000-000000000002'
const jobId = '00000000-0000-4000-8000-000000000003'
const window = { from: '2026-08-11', through: '2026-08-12' }
const client = { id: clientId, workspaceId, active: true, isManager: false, timezone: 'Europe/Paris', currencyCode: 'EUR', googleCustomerId: '1234567890' }
const base = { id: jobId, workspaceId, type: 'metrics.sync_chunk', status: 'running', attemptCount: 1, leaseOwner: 'worker', leaseExpiresAt: new Date('2026-08-12T11:00:00Z'), payload: { workspaceId, clientId, parentJobId: workspaceId, timezone: client.timezone, window } } as unknown as ClaimedJob
const account = { date: window.from, costMicros: '100', impressions: '10', clicks: '2', conversions: 1, conversionValue: 10 }
const campaign = { ...account, campaignId: '42', campaignName: 'Brand', campaignType: 'SEARCH', status: 'REMOVED' }
function db(options: { job?: ClaimedJob | null; client?: unknown; workspace?: unknown; connection?: unknown; previous?: unknown[]; statements?: unknown[] } = {}) {
  return databaseDouble({ statementResults: options.statements ?? [options.job === null ? [] : [options.job ?? base]], query: {
    clients: { findFirst: async () => options.client === undefined ? client : options.client },
    workspaces: { findFirst: async () => options.workspace === undefined ? { accessState: 'active' } : options.workspace },
    googleAdsConnections: { findFirst: async () => options.connection === undefined ? {} : options.connection },
    dailyAccountMetrics: { findMany: async () => options.previous ?? [] },
  } })
}
function persistInput(job = base) {
  return { job, clientId, timezone: client.timezone, currencyCode: client.currencyCode, observedAt: new Date(), window,
    dataset: normalizeMetricSyncData({ window, today: window.through, complete: true, accounts: [account], campaigns: [campaign] }) }
}

beforeEach(() => {
  vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(new Date('2026-08-12T10:00:00Z'))
  mocks.dbs = []; mocks.lookback.mockResolvedValue(30); mocks.accounts.mockResolvedValue([account]); mocks.campaigns.mockResolvedValue([campaign]);
  mocks.enqueue.mockImplementation(async (jobs: unknown[]) => ({ created: jobs.length }))
})
afterEach(() => vi.useRealTimers())

describe('metric history coordinator', () => {
  it('freezes a resumable plan before fanout and keeps deduplication keys across midnight', async () => {
    const job = { ...base, type: 'metrics.daily_sync', payload: { workspaceId, clientId, requestedWindow: { from: '2024-10-01', through: '2026-08-12' } } }
    const context = db({ job }); const history = databaseDouble({ statementResults: [[{ date: null }], [{ days: 0 }]] }); const saved = db({ statements: [[job], []] })
    mocks.dbs.push(context.db, history.db, saved.db)
    mocks.enqueue.mockResolvedValueOnce({ created: 50 }).mockRejectedValueOnce(new Error('interrupted fanout'))
    await expect(fanOutMetricSync(job)).rejects.toThrow('interrupted fanout')
    const first = mocks.enqueue.mock.calls[0][0]; const second = mocks.enqueue.mock.calls[1][0]
    const savedPayload = (saved.capture.sets[0] as { payload: Record<string, unknown> }).payload
    expect(savedPayload.metricSyncPlan).toMatchObject({ v: 1, today: '2026-08-12', timezone: client.timezone, conversionLookbackDays: 30 })
    vi.setSystemTime(new Date('2026-08-13T10:00:00Z'))
    mocks.dbs.push(db({ job: { ...job, payload: savedPayload }, connection: null }).db)
    await expect(fanOutMetricSync(job)).resolves.toMatchObject({ chunks: 98 })
    expect(mocks.enqueue.mock.calls[2][0]).toEqual(first)
    expect(mocks.enqueue.mock.calls[3][0]).toEqual(second)
    expect(mocks.lookback).toHaveBeenCalledOnce()
    expect(first).toHaveLength(50)
  })
  it('rejects absent leases, tenant mismatch, inactive accounts and absent connections', async () => {
    const job = { ...base, type: 'metrics.daily_sync' }
    await expect(fanOutMetricSync({ ...job, workspaceId: clientId })).rejects.toThrow('workspace mismatch')
    mocks.dbs.push(db({ job: null }).db)
    await expect(fanOutMetricSync(job)).rejects.toThrow('lease lost')
    mocks.dbs.push(db({ job, client: { ...client, active: false } }).db)
    await expect(fanOutMetricSync(job)).rejects.toThrow('unavailable')
    mocks.dbs.push(db({ job, connection: null }).db)
    await expect(fanOutMetricSync(job)).rejects.toThrow('connection unavailable')
  })
})

describe('metric date chunk execution', () => {
  it('returns committed work after disconnection without another Google read', async () => {
    const result = { accountDays: 2, campaignDays: 1, ignoredOlderDays: 0, period: window }
    mocks.dbs.push(db({ job: { ...base, payload: { ...base.payload, metricSyncResult: result } }, connection: null }).db)
    expect(await executeMetricSyncChunk(base)).toEqual(result)
    expect(mocks.accounts).not.toHaveBeenCalled()
  })
  it('does not write history when either response fails or the account timezone changes', async () => {
    mocks.dbs.push(db().db)
    mocks.campaigns.mockRejectedValueOnce(new Error('partial Google failure'))
    await expect(executeMetricSyncChunk(base)).rejects.toThrow('partial Google failure')
    expect(mocks.transaction).toHaveBeenCalledOnce()
    mocks.dbs.push(db({ client: { ...client, timezone: 'UTC' } }).db)
    await expect(executeMetricSyncChunk(base)).rejects.toThrow('timezone changed')
  })
  it('persists complete zeros, partial current days and removed campaign metrics with the checkpoint', async () => {
    const persistence = db({ statements: [[base], [], [], [], [], [], [{ id: base.id }]] })
    mocks.dbs.push(db().db, persistence.db)
    expect(await executeMetricSyncChunk(base)).toEqual({ accountDays: 2, campaignDays: 1, ignoredOlderDays: 0, period: window })
    expect(mocks.accounts).toHaveBeenCalledWith(client.googleCustomerId, window.from, window.through)
    expect(persistence.capture.values[0]).toEqual(expect.arrayContaining([
      expect.objectContaining({ metricDate: window.from, coverageStatus: 'complete', sourceVersion: jobId }),
      expect.objectContaining({ metricDate: window.through, coverageStatus: 'partial', costMicros: '0', accountRows: 0 }),
    ]))
    expect(persistence.capture.values[1]).toEqual([expect.objectContaining({ status: 'REMOVED', conversionValueMicros: '10000000' })])
    expect(persistence.capture.sets.at(-1)).toMatchObject({ payload: { metricSyncResult: { accountDays: 2 } } })
  })
  it('does not overwrite overlapping data from a newer read', async () => {
    const persistence = db({ previous: [window.from, window.through].map((metricDate) => ({ metricDate, sourceObservedAt: new Date('2026-08-13T10:00:00Z') })), statements: [[base], [], [], [{ id: base.id }]] })
    mocks.dbs.push(persistence.db)
    expect(await persistMetricSyncChunk(persistInput())).toMatchObject({ accountDays: 0, campaignDays: 0, ignoredOlderDays: 2 })
    expect(persistence.capture.values).toHaveLength(1)
    expect(persistence.capture.values[0]).toMatchObject({ action: 'metrics.chunk_completed' })
  })
  it('rejects scope and lifecycle drift and checks ownership again before committing', async () => {
    mocks.dbs.push(db().db)
    await expect(persistMetricSyncChunk({ ...persistInput(), clientId: workspaceId })).rejects.toThrow('outside its job scope')
    mocks.dbs.push(db({ workspace: { accessState: 'grace' }, statements: [[base], []] }).db)
    await expect(persistMetricSyncChunk(persistInput())).rejects.toThrow('context changed')
    mocks.dbs.push(db({ statements: [[base], [], [], [], [], [], []] }).db)
    await expect(persistMetricSyncChunk(persistInput())).rejects.toThrow('before checkpoint')
  })
})
