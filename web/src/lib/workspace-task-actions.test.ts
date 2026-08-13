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

import {
  addTenantWorkspaceTaskComment,
  createTenantWorkspaceTask,
  updateTenantWorkspaceTask,
  type WorkspaceTaskOperation,
} from './workspace-task-actions'

const workspaceId = '00000000-0000-4000-8000-000000000001'
const taskId = '00000000-0000-4000-8000-000000000002'
const sourceId = '00000000-0000-4000-8000-000000000003'
const clientId = '00000000-0000-4000-8000-000000000004'
const actorUserId = 'user-1'
const now = new Date('2026-08-12T08:00:00.000Z')

function createDatabase(input: {
  statementResults?: unknown[]
  incident?: unknown
  approval?: unknown
  client?: unknown
  task?: unknown
  preferences?: unknown[]
} = {}) {
  return databaseDouble({
    statementResults: input.statementResults,
    query: {
      alertIncidents: { findFirst: vi.fn(async () => input.incident) },
      approvalRequests: { findFirst: vi.fn(async () => input.approval) },
      clients: { findFirst: vi.fn(async () => input.client) },
      workspaceTasks: { findFirst: vi.fn(async () => input.task) },
      memberNotificationPreferences: { findMany: vi.fn(async () => input.preferences ?? []) },
    },
  })
}

describe('workspace task action repository', () => {
  beforeEach(() => {
    mocks.databases = []
    mocks.contexts = []
    vi.clearAllMocks()
  })

  it('creates and audits a manually assigned task with an SLA', async () => {
    const database = createDatabase({ statementResults: [[{ id: taskId }]] })
    mocks.databases.push(database.db)
    await createTenantWorkspaceTask({
      workspaceId,
      actorUserId,
      timezone: 'Europe/Paris',
      sourceType: 'manual',
      title: 'Optimiser la campagne',
      priority: 'high',
      slaHours: 24,
      assignSelf: true,
      now,
    })
    expect(database.capture.values[0]).toMatchObject({
      workspaceId,
      title: 'Optimiser la campagne',
      assignedTo: actorUserId,
      slaMinutes: 1440,
      dueAt: new Date('2026-08-13T08:00:00.000Z'),
    })
    expect(database.capture.values[1]).toMatchObject({ action: 'task.created', entityId: taskId })
  })

  it('derives alert task content only from a scoped source and client', async () => {
    const database = createDatabase({
      statementResults: [[{ id: taskId }]],
      incident: { id: sourceId, clientId, title: 'CPA élevé', description: 'Le CPA dépasse la cible.' },
      client: { id: clientId },
    })
    mocks.databases.push(database.db)
    await createTenantWorkspaceTask({
      workspaceId,
      actorUserId,
      timezone: 'Europe/Paris',
      sourceType: 'alert',
      sourceEntityId: sourceId,
      title: 'Valeur non fiable',
      priority: 'urgent',
      dueDate: '2026-08-20',
      assignSelf: false,
      now,
    })
    expect(database.capture.values[0]).toMatchObject({
      clientId,
      title: 'CPA élevé',
      description: 'Le CPA dépasse la cible.',
      assignedTo: null,
    })
  })

  it('derives approval task content from the scoped approval', async () => {
    const database = createDatabase({
      statementResults: [[{ id: taskId }]],
      approval: { id: sourceId, clientId, title: 'Ajuster le budget' },
      client: { id: clientId },
    })
    mocks.databases.push(database.db)
    await createTenantWorkspaceTask({
      workspaceId,
      actorUserId,
      timezone: 'Europe/Paris',
      sourceType: 'approval',
      sourceEntityId: sourceId,
      priority: 'normal',
      assignSelf: false,
      now,
    })
    expect(database.capture.values[0]).toMatchObject({
      clientId,
      title: 'Ajuster le budget',
      description: `Suivre la demande d’approbation ${sourceId}.`,
    })
  })

  it.each([
    [{ sourceType: 'alert' as const }, 'Alerte source manquante'],
    [{ sourceType: 'alert' as const, sourceEntityId: sourceId }, 'Alerte source introuvable'],
    [{ sourceType: 'approval' as const }, 'Approbation source manquante'],
    [{ sourceType: 'approval' as const, sourceEntityId: sourceId }, 'Approbation source introuvable'],
    [{ sourceType: 'manual' as const }, 'titre de la tâche'],
  ])('fails closed for an invalid source %#', async (partial, error) => {
    mocks.databases.push(createDatabase().db)
    await expect(createTenantWorkspaceTask({
      workspaceId,
      actorUserId,
      timezone: 'Europe/Paris',
      priority: 'normal',
      assignSelf: false,
      now,
      ...partial,
    })).rejects.toThrow(error)
  })

  it('rejects an unscoped client and a duplicate source task', async () => {
    mocks.databases.push(
      createDatabase({ client: null }).db,
      createDatabase({ statementResults: [[]] }).db,
    )
    const base = {
      workspaceId,
      actorUserId,
      timezone: 'Europe/Paris',
      sourceType: 'manual' as const,
      title: 'Tâche',
      priority: 'normal' as const,
      assignSelf: false,
      now,
    }
    await expect(createTenantWorkspaceTask({ ...base, clientId })).rejects.toThrow('Compte client')
    await expect(createTenantWorkspaceTask(base)).rejects.toThrow('Une tâche existe déjà')
  })

  it.each<{ operation: WorkspaceTaskOperation; expected: Record<string, unknown>; dueDate?: string }>([
    { operation: 'start', expected: { status: 'in_progress', startedAt: now } },
    { operation: 'block', expected: { status: 'blocked' } },
    { operation: 'complete', expected: { status: 'done', completedAt: now } },
    { operation: 'cancel', expected: { status: 'cancelled', cancelledAt: now } },
    { operation: 'assign_self', expected: { assignedTo: actorUserId } },
    { operation: 'unassign', expected: { assignedTo: null } },
    { operation: 'clear_due', expected: { dueAt: null, slaMinutes: null } },
    { operation: 'update_due', dueDate: '2026-08-20', expected: { slaMinutes: null } },
  ])('applies and audits $operation', async ({ operation, expected, dueDate }) => {
    const status = operation === 'cancel' ? 'todo' : operation === 'complete' ? 'in_progress' : 'todo'
    const database = createDatabase({ task: { id: taskId, status } })
    mocks.databases.push(database.db)
    await updateTenantWorkspaceTask({ workspaceId, actorUserId, taskId, operation, timezone: 'Europe/Paris', dueDate, now })
    expect(database.capture.sets[0]).toMatchObject({ ...expected, updatedAt: now })
    expect(database.capture.values[0]).toMatchObject({ action: `task.${operation}`, metadata: { previousStatus: status } })
  })

  it('rejects absent tasks and a due-date update without a date', async () => {
    mocks.databases.push(
      createDatabase().db,
      createDatabase({ task: { id: taskId, status: 'todo' } }).db,
    )
    await expect(updateTenantWorkspaceTask({
      workspaceId, actorUserId, taskId, operation: 'start', timezone: 'Europe/Paris', now,
    })).rejects.toThrow('Tâche introuvable')
    await expect(updateTenantWorkspaceTask({
      workspaceId, actorUserId, taskId, operation: 'update_due', timezone: 'Europe/Paris', now,
    })).rejects.toThrow('date d’échéance')
  })

  it('extracts mentions, excludes the author and enqueues deduplicated notification jobs', async () => {
    const database = createDatabase({
      statementResults: [[{ id: 'comment-1' }]],
      task: { id: taskId },
      preferences: [
        { id: 'preference-owner', authUserId: actorUserId },
        { id: 'preference-2', authUserId: 'user-2' },
      ],
    })
    mocks.databases.push(database.db)
    const result = await addTenantWorkspaceTaskComment({
      workspaceId,
      actorUserId,
      taskId,
      body: 'Merci @Owner et @Member @member',
      notificationsEnabled: true,
    })
    expect(result).toMatchObject({ mentions: ['@Owner', '@Member', '@member'], notificationCount: 1 })
    expect(database.capture.values[2]).toEqual([expect.objectContaining({
      type: 'task.mention_deliver',
      deduplicationKey: 'task.mention_deliver:comment-1:preference-2',
    })])
  })

  it('does not enqueue jobs without mentions or while notifications are disabled', async () => {
    const noMention = createDatabase({ statementResults: [[{ id: 'comment-1' }]], task: { id: taskId } })
    const disabled = createDatabase({
      statementResults: [[{ id: 'comment-2' }]],
      task: { id: taskId },
      preferences: [{ id: 'preference-2', authUserId: 'user-2' }],
    })
    mocks.databases.push(noMention.db, disabled.db)
    await addTenantWorkspaceTaskComment({ workspaceId, actorUserId, taskId, body: 'Sans mention', notificationsEnabled: true })
    const result = await addTenantWorkspaceTaskComment({
      workspaceId, actorUserId, taskId, body: 'Bonjour @member', notificationsEnabled: false,
    })
    expect(noMention.capture.values).toHaveLength(2)
    expect(disabled.capture.values).toHaveLength(2)
    expect(result.notificationCount).toBe(0)
  })

  it('fails closed for an absent task or a comment insert without a returned row', async () => {
    mocks.databases.push(
      createDatabase().db,
      createDatabase({ statementResults: [[]], task: { id: taskId } }).db,
    )
    await expect(addTenantWorkspaceTaskComment({
      workspaceId, actorUserId, taskId, body: 'Texte', notificationsEnabled: true,
    })).rejects.toThrow('Tâche introuvable')
    await expect(addTenantWorkspaceTaskComment({
      workspaceId, actorUserId, taskId, body: 'Texte', notificationsEnabled: true,
    })).rejects.toThrow('création du commentaire')
  })
})
