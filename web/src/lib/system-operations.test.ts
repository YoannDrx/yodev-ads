import { beforeEach, describe, expect, it, vi } from 'vitest'
import { databaseDouble } from '../../test/fluent-db'

const mocks = vi.hoisted(() => ({
  database: undefined as unknown,
  transaction: vi.fn(async (callback: (db: unknown) => unknown) => callback(mocks.database)),
}))

vi.mock('@/db/transactions', () => ({ withSystemTransaction: mocks.transaction }))

import {
  cancelOperationalDeadLetter,
  getSystemOperationsSnapshot,
  retryGlobalDeadLetter,
  reviewOperationalEmailDelivery,
  scheduleStripeReconciliation,
} from './system-operations'

function queryMap(input: Record<string, unknown[]> = {}) {
  return new Proxy({}, {
    get(_target, table) {
      return { findMany: vi.fn(async () => input[String(table)] ?? []) }
    },
  }) as Record<string, Record<string, (...args: unknown[]) => unknown>>
}

describe('system operations snapshot', () => {
  beforeEach(() => vi.clearAllMocks())

  it('groups cross-tenant operational evidence without leaking internal message relationships', async () => {
    const ticket = { id: 'ticket-1' }
    const incident = { id: 'incident-1' }
    const database = databaseDouble({
      statementResults: [
        [{ state: 'active', total: 3 }, { state: 'trial', total: 2 }],
        [{ id: 'workspace-1', createdAt: new Date('2026-08-01') }],
        [{ milestone: 'first_report', total: 2 }],
        [{ workspaceId: 'workspace-1', milestone: 'first_report', occurredAt: new Date('2026-08-02') }],
        [{ status: 'open', total: 1 }],
        [{ ticket, workspace: { id: 'workspace-1', name: 'ACME', accessState: 'active', plan: 'solo' } }],
        [{ total: 4 }],
        [{ job: { id: 'job-1' }, workspace: { id: 'workspace-1', name: 'ACME' } }],
        [{ total: 2 }],
        [{ total: 1 }],
        [{ total: 3 }],
        [{ total: 1 }],
        [{ execution: { id: 'execution-1' }, workspace: { id: 'workspace-1', name: 'ACME' } }],
      ],
      query: queryMap({
        supportMessages: [{ id: 'message-1', ticketId: ticket.id }, { id: 'message-2', ticketId: ticket.id }],
        platformIncidents: [incident],
        platformIncidentUpdates: [{ id: 'update-1', incidentId: incident.id }],
        stripeWebhookEvents: [{ id: 'event-1', status: 'failed' }],
        workspaces: [{ id: 'workspace-1', name: 'ACME', billingReconciliationReason: 'unknown_price' }],
        transactionalEmailDeliveries: [{ id: 'delivery-1', status: 'ambiguous' }],
      }),
    })
    mocks.database = database.db
    await expect(getSystemOperationsSnapshot()).resolves.toMatchObject({
      workspaceStates: { active: 3, trial: 2 },
      activationFunnel: { first_report: 2 },
      supportStatusCounts: { open: 1 },
      tickets: [{ ticket, messages: [{ id: 'message-1', ticketId: ticket.id }, { id: 'message-2', ticketId: ticket.id }] }],
      incidents: [{ incident, updates: [{ id: 'update-1', incidentId: incident.id }] }],
      deadLetterCount: 4,
      failedStripeCount: 2,
      billingReconciliationCount: 1,
      failedEmailCount: 3,
      ambiguousMutationCount: 1,
    })
  })

  it('returns explicit zero counts and empty groupings on a healthy empty system', async () => {
    mocks.database = databaseDouble({ statementResults: Array.from({ length: 13 }, () => []), query: queryMap() }).db
    await expect(getSystemOperationsSnapshot()).resolves.toMatchObject({
      workspaceStates: {}, activationFunnel: {}, supportStatusCounts: {}, tickets: [], incidents: [],
      deadLetterCount: 0, failedStripeCount: 0, billingReconciliationCount: 0, failedEmailCount: 0, ambiguousMutationCount: 0,
    })
  })

  it('queues and audits a controlled manual Stripe reconciliation', async () => {
    const database = databaseDouble({
      statementResults: [[{ id: 'job-1' }]],
      query: { workspaces: { findFirst: vi.fn(async () => ({ id: '00000000-0000-4000-8000-000000000001', stripeSubscriptionId: 'sub_1' })) } },
    })
    mocks.database = database.db
    await expect(scheduleStripeReconciliation({
      workspaceId: '00000000-0000-4000-8000-000000000001',
      actorUserId: 'operator-1',
      generation: 'generation-1',
      now: new Date('2026-08-16T12:00:00.000Z'),
    })).resolves.toEqual({ id: 'job-1' })
    expect(database.capture.values[0]).toMatchObject({
      type: 'stripe.reconcile',
      deduplicationKey: 'stripe.reconcile:00000000-0000-4000-8000-000000000001:manual:generation-1',
    })
    expect(database.capture.values[1]).toMatchObject({
      action: 'billing.reconciliation_requested',
      actorUserId: 'operator-1',
    })
  })

  it('requeues only global dead-letters and records an operator audit event', async () => {
    const now = new Date('2026-08-17T12:00:00.000Z')
    const database = databaseDouble({ statementResults: [[{
      id: '00000000-0000-4000-8000-000000000010',
      type: 'workspace.external_cleanup',
      payload: { manualRetryGeneration: 2 },
    }]] })
    mocks.database = database.db
    await expect(retryGlobalDeadLetter({
      operatorWorkspaceId: '00000000-0000-4000-8000-000000000001',
      actorUserId: 'operator-1',
      jobId: '00000000-0000-4000-8000-000000000010',
      now,
    })).resolves.toMatchObject({ type: 'workspace.external_cleanup' })
    expect(database.capture.sets[0]).toMatchObject({
      status: 'queued', availableAt: now, deadLetteredAt: null, lastError: null,
    })
    expect(database.capture.values[0]).toMatchObject({
      workspaceId: '00000000-0000-4000-8000-000000000001',
      actorUserId: 'operator-1',
      action: 'system_job.manual_retry_requested',
    })
  })

  it('cancels an obsolete dead-letter without deleting its evidence', async () => {
    const now = new Date('2026-08-18T16:30:00.000Z')
    const database = databaseDouble({ statementResults: [[{
      id: '00000000-0000-4000-8000-000000000010',
      workspaceId: '00000000-0000-4000-8000-000000000002',
      type: 'auth.invitation_deliver',
    }]] })
    mocks.database = database.db
    await expect(cancelOperationalDeadLetter({
      operatorWorkspaceId: '00000000-0000-4000-8000-000000000001',
      actorUserId: 'operator-1',
      jobId: '00000000-0000-4000-8000-000000000010',
      reason: 'Invitation accepted through the replacement delivery.',
      now,
    })).resolves.toMatchObject({ type: 'auth.invitation_deliver' })
    expect(database.capture.sets[0]).toMatchObject({ status: 'cancelled', completedAt: now })
    expect(database.capture.values[0]).toMatchObject({
      action: 'job.dead_letter_cancelled',
      metadata: expect.objectContaining({ reason: 'Invitation accepted through the replacement delivery.' }),
    })
  })

  it('classifies a reviewed failed email while preserving provider evidence', async () => {
    const now = new Date('2026-08-18T16:31:00.000Z')
    const database = databaseDouble({ statementResults: [[{
      id: '00000000-0000-4000-8000-000000000020',
      workspaceId: '00000000-0000-4000-8000-000000000002',
      category: 'auth_organization_invitation',
      providerMessageId: null,
    }]] })
    mocks.database = database.db
    await expect(reviewOperationalEmailDelivery({
      operatorWorkspaceId: '00000000-0000-4000-8000-000000000001',
      actorUserId: 'operator-1',
      deliveryId: '00000000-0000-4000-8000-000000000020',
      reason: 'Replacement invitations were delivered after profile approval.',
      now,
    })).resolves.toMatchObject({ category: 'auth_organization_invitation' })
    expect(database.capture.sets[0]).toMatchObject({ status: 'reviewed', terminalAt: now })
    expect(database.capture.values[0]).toMatchObject({
      action: 'email.delivery_reviewed',
      metadata: expect.objectContaining({ reason: 'Replacement invitations were delivered after profile approval.' }),
    })
  })
})
