import { beforeEach, describe, expect, it, vi } from 'vitest'
import { databaseDouble } from '../../test/fluent-db'

const mocks = vi.hoisted(() => ({ db: undefined as unknown, queue: vi.fn(), transaction: vi.fn(async (fn: (db: unknown) => unknown) => fn(mocks.db)) }))
vi.mock('@/db/transactions', () => ({ withSystemTransaction: mocks.transaction }))
vi.mock('@/lib/notifications', () => ({ queueIncidentNotifications: mocks.queue }))
import { monitoringProgress, persistMonitoringObservation, readMonitoringProgress } from './monitoring-observations'

const workspaceId = '00000000-0000-4000-8000-000000000001'
const clientId = '00000000-0000-4000-8000-000000000002'
const agent = { id: '00000000-0000-4000-8000-000000000003', kind: 'no_delivery', threshold: '0' }
const claim = { jobId: '00000000-0000-4000-8000-000000000004', attempt: 1, workerId: 'worker' }
const finding = { fingerprint: 'campaign', title: 'Alerte', description: 'Description', severity: 'critical' as const, value: 0 }
const input = { workspaceId, claim, agent, clientId, findings: [finding], observedAt: new Date('2026-09-07T00:00:00Z') }
const job = { id: claim.jobId, payload: { clientId, agentIds: [agent.id] } }
function setup(options: { statements?: unknown[]; workspace?: unknown; agent?: unknown; client?: unknown; existing?: unknown[]; previous?: unknown } = {}) {
  const db = databaseDouble({ statementResults: options.statements ?? [[job], [], [{ id: 'incident' }], [], [], [{ id: job.id }]], query: {
    workspaces: { findFirst: async () => options.workspace === undefined ? { accessState: 'active' } : options.workspace },
    monitoringAgents: { findFirst: async () => options.agent === undefined ? { ...agent, enabled: true, clientId: null } : options.agent },
    clients: { findFirst: async () => options.client === undefined ? { id: clientId, active: true, isManager: false, name: 'ACME' } : options.client },
    alertIncidents: { findMany: async () => options.existing ?? [] },
    auditEvents: { findFirst: async () => options.previous },
  } })
  mocks.db = db.db
  return db.capture
}
const oldIncident = { id: 'incident', fingerprint: `${finding.fingerprint}:${clientId}`, status: 'open', severity: 'warning', createdAt: new Date('2026-08-01'), lastNotifiedAt: null, snoozedUntil: null }

beforeEach(() => { vi.clearAllMocks(); mocks.queue.mockResolvedValue(1) })

describe('monitoring observation checkpoint contract', () => {
  it('accepts old payloads without progress and rejects corrupt progress', () => {
    expect(monitoringProgress({})).toEqual({})
    expect(() => monitoringProgress({ monitoringProgress: { [agent.id]: { detected: -1 } } })).toThrow()
  })
  it('reads only a still-owned job and rejects missing leases', async () => {
    setup({ statements: [[{ payload: { monitoringProgress: { [agent.id]: { detected: 1, resolved: 0, queued: 2 } } } }]] })
    expect(await readMonitoringProgress(workspaceId, claim)).toMatchObject({ [agent.id]: { queued: 2 } })
    setup({ statements: [[]] })
    await expect(readMonitoringProgress(workspaceId, claim)).rejects.toThrow('lease lost')
    setup({ statements: [[]] })
    await expect(persistMonitoringObservation(input)).rejects.toThrow('lease lost')
  })
  it('returns committed progress without touching incidents or outboxes', async () => {
    const result = { detected: 2, resolved: 1, queued: 1 }
    const capture = setup({ statements: [[{ ...job, payload: { ...job.payload, monitoringProgress: { [agent.id]: result } } }]] })
    expect(await persistMonitoringObservation(input)).toEqual(result)
    expect(capture.values).toEqual([])
    expect(mocks.queue).not.toHaveBeenCalled()
  })
  it('refuses a client/vigie outside the persisted job and changed thresholds', async () => {
    setup({ statements: [[{ ...job, payload: { ...job.payload, clientId: 'other' } }]] })
    await expect(persistMonitoringObservation(input)).rejects.toThrow('outside its job scope')
    setup({ statements: [[{ ...job, payload: { ...job.payload, agentIds: [] } }]] })
    await expect(persistMonitoringObservation(input)).rejects.toThrow('outside its job scope')
    setup({ agent: { ...agent, threshold: '10', enabled: true } })
    await expect(persistMonitoringObservation(input)).rejects.toThrow('configuration changed')
  })
  it.each(['workspace', 'suspended', 'agent', 'disabled', 'client', 'inactive', 'manager', 'different_client', 'older_read'])('checkpoints %s as skipped without incident changes', async (reason) => {
    const capture = setup({ statements: [[job], [], [{ id: job.id }]],
      workspace: reason === 'workspace' ? null : reason === 'suspended' ? { accessState: 'suspended' } : undefined,
      agent: reason === 'agent' ? null : { ...agent, enabled: reason !== 'disabled', clientId: reason === 'different_client' ? 'other' : null },
      client: reason === 'client' ? null : { id: clientId, active: reason !== 'inactive', isManager: reason === 'manager' },
      previous: reason === 'older_read' ? { metadata: { observedAt: '2026-09-08T00:00:00Z' } } : undefined,
    })
    expect(await persistMonitoringObservation(input)).toEqual({ detected: 0, resolved: 0, queued: 0, skipped: true })
    expect(capture.values).toEqual([])
    expect(mocks.queue).not.toHaveBeenCalled()
  })
  it('opens a vigie-scoped incident and queues its event in the same transaction', async () => {
    const capture = setup()
    expect(await persistMonitoringObservation({ ...input, findings: [finding, finding] })).toEqual({ detected: 1, resolved: 0, queued: 1 })
    expect(capture.values[0]).toMatchObject({ agentId: agent.id, clientId, fingerprint: expect.stringMatching(/^monitor:v2:[a-f0-9]{64}$/) })
    expect(mocks.queue).toHaveBeenCalledWith(mocks.db, expect.objectContaining({ eventKey: `monitoring:${claim.jobId}:incident:opened` }))
    expect(capture.sets.at(-1)).toMatchObject({ payload: { monitoringProgress: { [agent.id]: { detected: 1, queued: 1 } } } })
  })
  it.each(['resolved', 'acknowledged', 'snoozed', 'expired_snooze', 'open'])('preserves legacy identity and handles %s', async (state) => {
    const old = { ...oldIncident, severity: state === 'open' ? 'warning' : 'critical', status: state === 'expired_snooze' ? 'snoozed' : state, snoozedUntil: state === 'snoozed' ? new Date(Date.now() + 60_000) : new Date(0) }
    const capture = setup({ existing: [old] })
    const result = await persistMonitoringObservation(input)
    expect(capture.values[0]).toMatchObject({ fingerprint: old.fingerprint })
    expect(result.queued).toBe(['resolved', 'open'].includes(state) ? 1 : 0)
    if (state === 'resolved') expect(mocks.queue).toHaveBeenCalledWith(mocks.db, expect.objectContaining({ eventKey: expect.stringContaining(':reopened') }))
    expect(capture.conflicts[0]).toMatchObject({ set: { status: state === 'resolved' ? 'reopened' : ['acknowledged', 'snoozed'].includes(state) ? state : 'open' } })
  })
  it('resolves only incidents returned for this vigie/client after a complete empty result', async () => {
    const capture = setup({ existing: [oldIncident], statements: [[job], [], [], [], [], [{ id: job.id }]] })
    expect(await persistMonitoringObservation({ ...input, findings: [] })).toEqual({ detected: 0, resolved: 1, queued: 0 })
    expect(capture.sets[0]).toMatchObject({ status: 'resolved' })
  })
  it('aborts the transaction if the outbox fails or the lease expires before checkpoint', async () => {
    setup()
    mocks.queue.mockRejectedValueOnce(new Error('outbox unavailable'))
    await expect(persistMonitoringObservation(input)).rejects.toThrow('outbox unavailable')
    setup({ statements: [[job], [], [{ id: 'incident' }], [], [], []] })
    await expect(persistMonitoringObservation(input)).rejects.toThrow('before checkpoint')
  })
})
