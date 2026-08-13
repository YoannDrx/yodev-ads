import { beforeEach, describe, expect, it, vi } from 'vitest'
import { databaseDouble } from '../../test/fluent-db'

const mocks = vi.hoisted(() => ({
  database: undefined as unknown,
  transaction: vi.fn(async (callback: (db: unknown) => unknown) => callback(mocks.database)),
}))

vi.mock('@/db/transactions', () => ({ withSystemTransaction: mocks.transaction }))

import { getSystemOperationsSnapshot } from './system-operations'

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
        [{ execution: { id: 'execution-1' }, workspace: { id: 'workspace-1', name: 'ACME' } }],
      ],
      query: queryMap({
        supportMessages: [{ id: 'message-1', ticketId: ticket.id }, { id: 'message-2', ticketId: ticket.id }],
        platformIncidents: [incident],
        platformIncidentUpdates: [{ id: 'update-1', incidentId: incident.id }],
        stripeWebhookEvents: [{ id: 'event-1', status: 'failed' }],
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
      ambiguousMutationCount: 1,
    })
  })

  it('returns explicit zero counts and empty groupings on a healthy empty system', async () => {
    mocks.database = databaseDouble({ statementResults: Array.from({ length: 11 }, () => []), query: queryMap() }).db
    await expect(getSystemOperationsSnapshot()).resolves.toMatchObject({
      workspaceStates: {}, activationFunnel: {}, supportStatusCounts: {}, tickets: [], incidents: [],
      deadLetterCount: 0, failedStripeCount: 0, ambiguousMutationCount: 0,
    })
  })
})
