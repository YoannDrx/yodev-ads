import { beforeEach, describe, expect, it, vi } from 'vitest'
import { databaseDouble } from '../../test/fluent-db'

const mocks = vi.hoisted(() => ({
  dbs: [] as unknown[], enqueue: vi.fn(), run: vi.fn(),
  transaction: vi.fn(async (fn: (db: unknown) => unknown) => fn(mocks.dbs.shift())),
}))
vi.mock('@/db/transactions', () => ({ withSystemTransaction: mocks.transaction }))
vi.mock('@/lib/jobs', () => ({ enqueueJobs: mocks.enqueue }))
vi.mock('@/lib/run-monitoring', () => ({ runWorkspaceMonitoring: mocks.run }))
import { executeMonitoringChunk, fanOutMonitoringScan } from './monitoring-scan-jobs'

const workspaceId = '00000000-0000-4000-8000-000000000001'
const parentJobId = '00000000-0000-4000-8000-000000000002'
function context(state = 'active', count = 1) {
  return databaseDouble({ query: {
    workspaces: { findFirst: async () => ({ accessState: state }) },
    monitoringAgents: { findMany: async () => Array.from({ length: count }, (_, index) => ({ id: `agent-${index}`, clientId: null, enabled: true, kind: 'no_delivery' })) },
    clients: { findMany: async () => [{ id: 'client', active: true, isManager: false }] },
  } }).db
}

describe('monitoring coordinator and worker', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.dbs = []
    mocks.enqueue.mockImplementation(async (jobs: unknown[]) => ({ created: jobs.length }))
    mocks.run.mockResolvedValue({ detected: 2, resolved: 0 })
  })
  it('resumes an interrupted fanout with identical deduplication keys and bounded writes', async () => {
    mocks.dbs.push(context('active', 510), context('active', 510))
    mocks.enqueue.mockResolvedValueOnce({ created: 100 }).mockRejectedValueOnce(new Error('database unavailable'))
    await expect(fanOutMonitoringScan({ workspaceId, parentJobId })).rejects.toThrow('database unavailable')
    const firstBatch = mocks.enqueue.mock.calls[0][0]
    const secondBatch = mocks.enqueue.mock.calls[1][0]
    mocks.enqueue.mockResolvedValueOnce({ created: 0 }).mockResolvedValueOnce({ created: 2 })
    await expect(fanOutMonitoringScan({ workspaceId, parentJobId })).resolves.toMatchObject({ chunks: 102, created: 2 })
    expect(mocks.enqueue.mock.calls[2][0]).toEqual(firstBatch)
    expect(mocks.enqueue.mock.calls[3][0]).toEqual(secondBatch)
    expect(firstBatch).toHaveLength(100)
    expect(secondBatch).toHaveLength(2)
    expect(firstBatch[0]).toMatchObject({ workspaceId, type: 'monitoring.scan_chunk', payload: { parentJobId, clientId: 'client' } })
  })
  it.each(['grace', 'suspended', 'deletion_pending'])('does not collect or enqueue after the workspace enters %s', async (state) => {
    mocks.dbs.push(context(state), context(state))
    await expect(fanOutMonitoringScan({ workspaceId, parentJobId })).resolves.toMatchObject({ skipped: true })
    await expect(executeMonitoringChunk({ workspaceId, parentJobId, clientId: 'client', agentIds: ['agent'] })).resolves.toEqual({ skipped: true })
    expect(mocks.enqueue).not.toHaveBeenCalled()
    expect(mocks.run).not.toHaveBeenCalled()
  })
  it('passes the exact client and vigie scope and audits the partial completion', async () => {
    const audit = databaseDouble()
    mocks.dbs.push(context(), audit.db)
    await executeMonitoringChunk({ workspaceId, parentJobId, clientId: 'client', agentIds: ['agent'] })
    expect(mocks.run).toHaveBeenCalledWith(workspaceId, undefined, { clientId: 'client', agentIds: ['agent'] })
    expect(audit.capture.values[0]).toMatchObject({ action: 'monitoring.chunk_completed', entityId: 'client', metadata: { parentJobId, detected: 2 } })
  })
})
