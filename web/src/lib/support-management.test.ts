import { beforeEach, describe, expect, it, vi } from 'vitest'
import { databaseDouble } from '../../test/fluent-db'

const mocks = vi.hoisted(() => ({
  tenantDatabases: [] as unknown[],
  systemDatabases: [] as unknown[],
  tenantTransaction: vi.fn(async (_context: unknown, callback: (db: unknown) => unknown) => callback(mocks.tenantDatabases.shift())),
  systemTransaction: vi.fn(async (callback: (db: unknown) => unknown) => callback(mocks.systemDatabases.shift())),
}))

vi.mock('@/db/transactions', () => ({
  withTenantTransaction: mocks.tenantTransaction,
  withSystemTransaction: mocks.systemTransaction,
}))

import {
  addSystemSupportReply,
  addTenantSupportMessage,
  createTenantSupportTicket,
  updateSystemSupportTicket,
} from './support-management'

const workspaceId = '00000000-0000-4000-8000-000000000001'
const internalWorkspaceId = '00000000-0000-4000-8000-000000000002'
const ticketId = '00000000-0000-4000-8000-000000000003'
const messageId = '00000000-0000-4000-8000-000000000004'
const actorUserId = 'user-1'
const now = new Date('2026-08-12T08:00:00.000Z')

function supportDatabase(input: { statementResults?: unknown[]; ticket?: unknown } = {}) {
  return databaseDouble({
    statementResults: input.statementResults,
    query: { supportTickets: { findFirst: vi.fn(async () => input.ticket) } },
  })
}

const ticket = {
  id: ticketId,
  workspaceId,
  status: 'awaiting_support',
  priority: 'urgent',
  lastMessageAt: new Date('2026-08-11T08:00:00.000Z'),
}

describe('support management', () => {
  beforeEach(() => {
    mocks.tenantDatabases = []
    mocks.systemDatabases = []
    vi.clearAllMocks()
  })

  it('creates the ticket, first message, audit and durable email job atomically', async () => {
    const database = supportDatabase({ statementResults: [[{ id: ticketId }], [{ id: messageId }]] })
    mocks.tenantDatabases.push(database.db)
    await createTenantSupportTicket({
      workspaceId, actorUserId, subject: 'OAuth cassé', category: 'google_ads', priority: 'urgent', body: 'Détails suffisants', now,
    })
    expect(database.capture.values).toEqual(expect.arrayContaining([
      expect.objectContaining({ workspaceId, status: 'awaiting_support', lastMessageAt: now }),
      expect.objectContaining({ ticketId, authorKind: 'customer', body: 'Détails suffisants' }),
      expect.objectContaining({ action: 'support.ticket_created', entityId: ticketId }),
      expect.objectContaining({ type: 'support.email', priority: 10, deduplicationKey: `support.email:${ticketId}:new_ticket:${messageId}` }),
    ]))
  })

  it('rolls back when ticket or initial message creation does not return an id', async () => {
    mocks.tenantDatabases.push(
      supportDatabase({ statementResults: [[]] }).db,
      supportDatabase({ statementResults: [[{ id: ticketId }], []] }).db,
    )
    const input = { workspaceId, actorUserId, subject: 'Question', category: 'technical' as const, priority: 'normal' as const, body: 'Détails suffisants' }
    await expect(createTenantSupportTicket(input)).rejects.toThrow('création de la demande')
    await expect(createTenantSupportTicket(input)).rejects.toThrow('création du message')
  })

  it('adds a customer reply, reopens its workflow and queues a notification', async () => {
    const database = supportDatabase({ statementResults: [[{ id: messageId }]], ticket: { ...ticket, status: 'resolved' } })
    mocks.tenantDatabases.push(database.db)
    await addTenantSupportMessage({ workspaceId, actorUserId, ticketId, body: 'Toujours cassé', now })
    expect(database.capture.sets[0]).toMatchObject({ status: 'awaiting_support', resolvedAt: null, lastMessageAt: now })
    expect(database.capture.values).toContainEqual(expect.objectContaining({
      type: 'support.email', deduplicationKey: `support.email:${ticketId}:customer_reply:${messageId}`,
    }))
  })

  it('rejects missing and closed tenant tickets', async () => {
    mocks.tenantDatabases.push(
      supportDatabase().db,
      supportDatabase({ ticket: { ...ticket, status: 'closed' } }).db,
    )
    const input = { workspaceId, actorUserId, ticketId, body: 'Réponse' }
    await expect(addTenantSupportMessage(input)).rejects.toThrow('introuvable')
    await expect(addTenantSupportMessage(input)).rejects.toThrow('doit être rouvert')
  })

  it('keeps internal notes private and does not enqueue customer email', async () => {
    const database = supportDatabase({ statementResults: [[{ id: messageId }]], ticket })
    mocks.systemDatabases.push(database.db)
    await addSystemSupportReply({ internalWorkspaceId, actorUserId, ticketId, body: 'Note interne', internal: true, now })
    expect(database.capture.sets[0]).toMatchObject({ status: ticket.status, lastMessageAt: ticket.lastMessageAt })
    expect(database.capture.values).toHaveLength(2)
    expect(database.capture.values[1]).toMatchObject({ action: 'support.internal_note_added' })
  })

  it('sends public support replies through the durable queue', async () => {
    const database = supportDatabase({ statementResults: [[{ id: messageId }]], ticket })
    mocks.systemDatabases.push(database.db)
    await addSystemSupportReply({ internalWorkspaceId, actorUserId, ticketId, body: 'Solution', internal: false, now })
    expect(database.capture.sets[0]).toMatchObject({ status: 'awaiting_customer', lastMessageAt: now })
    expect(database.capture.values).toContainEqual(expect.objectContaining({
      type: 'support.email', deduplicationKey: `support.email:${ticketId}:support_reply:${messageId}`,
    }))
  })

  it('applies valid internal status transitions and queues an idempotent notification', async () => {
    const database = supportDatabase({ ticket })
    mocks.systemDatabases.push(database.db)
    await updateSystemSupportTicket({ internalWorkspaceId, actorUserId, ticketId, status: 'resolved', now })
    expect(database.capture.sets[0]).toMatchObject({ status: 'resolved', resolvedAt: now, assignedTo: actorUserId })
    expect(database.capture.values).toContainEqual(expect.objectContaining({
      type: 'support.email',
      deduplicationKey: `support.email:${ticketId}:status_changed:${ticketId}:resolved:${now.toISOString()}`,
    }))
  })
})
