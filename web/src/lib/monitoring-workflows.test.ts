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
  acknowledgeWorkspaceAlert,
  createWorkspaceMonitoringAgent,
  recordWorkspaceMonitoringScan,
  setWorkspaceMonitoringAgentEnabled,
  updateWorkspaceAlertWorkflow,
  type AlertWorkflowOperation,
} from './monitoring-workflows'

const workspaceId = '00000000-0000-4000-8000-000000000001'
const incidentId = '00000000-0000-4000-8000-000000000002'
const agentId = '00000000-0000-4000-8000-000000000003'
const actorUserId = 'user-1'
const now = new Date('2026-08-12T08:00:00.000Z')

describe('monitoring action workflows', () => {
  beforeEach(() => {
    mocks.databases = []
    mocks.contexts = []
    vi.clearAllMocks()
  })

  it('serializes monitor quota consumption, audits creation and records activation', async () => {
    const created = { id: agentId, clientId: null, reminderIntervalHours: 24 }
    const database = databaseDouble({ statementResults: [[], [{ count: 1 }], [created]] })
    mocks.databases.push(database.db)
    await expect(createWorkspaceMonitoringAgent({
      workspaceId,
      actorUserId,
      clientId: null,
      kind: 'no_delivery',
      name: 'Diffusion',
      description: 'Détecte les campagnes sans diffusion.',
      threshold: 0,
      reminderIntervalHours: 24,
      entitlements: entitlementContext('active', 'solo'),
    })).resolves.toEqual(created)
    expect(database.capture.values).toEqual(expect.arrayContaining([
      expect.objectContaining({ workspaceId, kind: 'no_delivery', threshold: '0' }),
      expect.objectContaining({ action: 'monitoring.agent_created', entityId: agentId }),
      expect.objectContaining({ milestone: 'first_monitor', sourceEntityId: agentId }),
    ]))
    expect(mocks.contexts).toEqual([{ workspaceId, userId: actorUserId }])
  })

  it('stops before insertion when monitor quota is exhausted', async () => {
    const database = databaseDouble({ statementResults: [[], [{ count: 5 }]] })
    mocks.databases.push(database.db)
    await expect(createWorkspaceMonitoringAgent({
      workspaceId,
      actorUserId,
      clientId: null,
      kind: 'high_cpa',
      name: 'CPA',
      description: 'CPA élevé.',
      threshold: 10,
      reminderIntervalHours: null,
      entitlements: entitlementContext('active', 'solo'),
    })).rejects.toThrow('Quota exceeded')
    expect(database.capture.values).toEqual([])
  })

  it('fails closed if creation or toggle returns no tenant-owned monitor', async () => {
    mocks.databases.push(
      databaseDouble({ statementResults: [[], [{ count: 0 }], []] }).db,
      databaseDouble({ statementResults: [[]] }).db,
    )
    await expect(createWorkspaceMonitoringAgent({
      workspaceId,
      actorUserId,
      clientId: null,
      kind: 'tracking_gap',
      name: 'Tracking',
      description: 'Tracking absent.',
      threshold: 0,
      reminderIntervalHours: null,
      entitlements: entitlementContext('trial', 'trial'),
    })).rejects.toThrow('création de la vigie')
    await expect(setWorkspaceMonitoringAgentEnabled({ workspaceId, actorUserId, agentId, enabled: false, now }))
      .rejects.toThrow('Vigie introuvable')
  })

  it('toggles a tenant-owned monitor and records scan results', async () => {
    const toggle = databaseDouble({ statementResults: [[{ id: agentId }]] })
    const scan = databaseDouble()
    mocks.databases.push(toggle.db, scan.db)
    await setWorkspaceMonitoringAgentEnabled({ workspaceId, actorUserId, agentId, enabled: false, now })
    await recordWorkspaceMonitoringScan({ workspaceId, actorUserId, result: { detected: 2, resolved: 1 } })
    expect(toggle.capture.sets[0]).toEqual({ enabled: false, updatedAt: now })
    expect(scan.capture.values[0]).toMatchObject({
      action: 'monitoring.scan_completed',
      metadata: { detected: 2, resolved: 1 },
    })
  })

  it('acknowledges a tenant-owned alert with one audit event', async () => {
    const database = databaseDouble({ statementResults: [[{ id: incidentId }]] })
    mocks.databases.push(database.db)
    await acknowledgeWorkspaceAlert({ workspaceId, actorUserId, incidentId, now })
    expect(database.capture.sets[0]).toMatchObject({ status: 'acknowledged', acknowledgedAt: now, updatedAt: now })
    expect(database.capture.values[0]).toMatchObject({ action: 'monitoring.alert_acknowledged', entityId: incidentId })
  })

  it('rejects an alert absent from the tenant', async () => {
    mocks.databases.push(databaseDouble({ statementResults: [[]] }).db)
    await expect(acknowledgeWorkspaceAlert({ workspaceId, actorUserId, incidentId, now }))
      .rejects.toThrow('Alerte introuvable')
  })

  it.each<{
    operation: AlertWorkflowOperation
    dueDate?: string
    expected: Record<string, unknown>
  }>([
    { operation: 'acknowledge', expected: { status: 'acknowledged', acknowledgedAt: now, snoozedUntil: null, resolvedAt: null } },
    { operation: 'snooze_24h', expected: { status: 'snoozed', snoozedUntil: new Date('2026-08-13T08:00:00.000Z'), resolvedAt: null } },
    { operation: 'resolve', expected: { status: 'resolved', resolvedAt: now, snoozedUntil: null } },
    { operation: 'reopen', expected: { status: 'reopened', resolvedAt: null, snoozedUntil: null } },
    { operation: 'assign_self', dueDate: '2026-08-20', expected: { assignedTo: actorUserId, dueAt: new Date('2026-08-20T12:00:00.000Z') } },
    { operation: 'assign_self', expected: { assignedTo: actorUserId } },
    { operation: 'unassign', expected: { assignedTo: null, dueAt: null } },
  ])('applies the $operation alert transition', async ({ operation, dueDate, expected }) => {
    const database = databaseDouble({ statementResults: [[{ id: incidentId }]] })
    mocks.databases.push(database.db)
    await updateWorkspaceAlertWorkflow({ workspaceId, actorUserId, incidentId, operation, dueDate, now })
    expect(database.capture.sets[0]).toMatchObject({ ...expected, updatedAt: now })
    expect(database.capture.values.at(-1)).toMatchObject({ action: `monitoring.alert_${operation}` })
  })

  it('persists an optional comment and due-date audit metadata', async () => {
    const database = databaseDouble({ statementResults: [[{ id: incidentId }]] })
    mocks.databases.push(database.db)
    await updateWorkspaceAlertWorkflow({
      workspaceId,
      actorUserId,
      incidentId,
      operation: 'assign_self',
      comment: 'Je prends cette alerte.',
      dueDate: '2026-08-20',
      now,
    })
    expect(database.capture.values[0]).toMatchObject({ incidentId, authorUserId: actorUserId, body: 'Je prends cette alerte.' })
    expect(database.capture.values[1]).toMatchObject({
      metadata: { hasComment: true, dueAt: '2026-08-20T12:00:00.000Z' },
    })
  })

  it('rejects an alert workflow update when the scoped update returns no incident', async () => {
    mocks.databases.push(databaseDouble({ statementResults: [[]] }).db)
    await expect(updateWorkspaceAlertWorkflow({
      workspaceId,
      actorUserId,
      incidentId,
      operation: 'resolve',
      now,
    })).rejects.toThrow('Alerte introuvable')
  })
})
