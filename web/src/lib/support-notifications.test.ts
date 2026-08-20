import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { databaseDouble } from '../../test/fluent-db'

const mocks = vi.hoisted(() => ({
  databases: [] as unknown[],
  transaction: vi.fn(async (callback: (db: unknown) => unknown) => callback(mocks.databases.shift())),
  emailSend: vi.fn(),
  verifiedAuthUserEmail: vi.fn(),
}))

vi.mock('@/db/transactions', () => ({ withSystemTransaction: mocks.transaction }))
vi.mock('@/lib/transactional-email', () => ({ sendTransactionalEmail: mocks.emailSend }))
vi.mock('@/lib/auth-identities', () => ({ verifiedAuthUserEmail: mocks.verifiedAuthUserEmail }))

import { deliverSupportEmail } from './support-notifications'

const ticketId = '00000000-0000-4000-8000-000000000001'
const workspaceId = '00000000-0000-4000-8000-000000000002'

function queryMap(input: Record<string, { first?: unknown }> = {}) {
  return new Proxy({}, {
    get(_target, table) {
      return { findFirst: vi.fn(async () => input[String(table)]?.first) }
    },
  }) as Record<string, Record<string, (...args: unknown[]) => unknown>>
}

const ticket = { id: ticketId, workspaceId, subject: 'Besoin d’aide', status: 'open' }
const workspace = { id: workspaceId, ownerUserId: 'owner-1', billingEmail: 'client@example.test', name: 'ACME', locale: 'fr', accessState: 'active' }

function contextDatabase(input: { ticket?: unknown; workspace?: unknown; message?: unknown } = {}) {
  return databaseDouble({ query: queryMap({
    supportTickets: { first: input.ticket === undefined ? ticket : input.ticket },
    workspaces: { first: input.workspace === undefined ? workspace : input.workspace },
    supportMessages: { first: input.message },
  }) })
}

describe('support email delivery', () => {
  beforeEach(() => {
    mocks.databases = []
    vi.clearAllMocks()
    process.env.SUPPORT_EMAIL = 'support@example.test'
    mocks.emailSend.mockResolvedValue({ provider: 'yodev_mail', providerMessageId: 'email-1' })
    mocks.verifiedAuthUserEmail.mockResolvedValue(null)
  })

  afterEach(() => {
    delete process.env.SUPPORT_EMAIL
  })

  it('sends customer-originated tickets to support with message context and audit', async () => {
    const message = { id: 'message-1', ticketId, body: '<script>question</script>' }
    mocks.databases.push(contextDatabase({ message }).db, databaseDouble().db)
    await expect(deliverSupportEmail({ ticketId, kind: 'customer_reply', referenceKey: 'reply-1', messageId: message.id })).resolves.toEqual({ delivered: true, providerMessageId: 'email-1' })
    expect(mocks.emailSend).toHaveBeenCalledWith(expect.objectContaining({
      to: 'support@example.test', html: expect.not.stringContaining('<script>'),
      idempotencyKey: `support:${ticketId}:customer_reply:reply-1`, category: 'support_customer_reply', workspaceId,
    }))
  })

  it('sends support replies to the billing contact or a verified Better Auth owner fallback', async () => {
    mocks.databases.push(contextDatabase().db, databaseDouble().db)
    await deliverSupportEmail({ ticketId, kind: 'support_reply', referenceKey: 'support-1' })
    expect(mocks.emailSend).toHaveBeenLastCalledWith(expect.objectContaining({ to: 'client@example.test' }))

    mocks.verifiedAuthUserEmail.mockResolvedValue('owner@example.test')
    mocks.databases.push(contextDatabase({ workspace: { ...workspace, billingEmail: null } }).db, databaseDouble().db)
    await deliverSupportEmail({ ticketId, kind: 'status_changed', referenceKey: 'status-1' })
    expect(mocks.emailSend).toHaveBeenLastCalledWith(expect.objectContaining({ to: 'owner@example.test' }))
  })

  it('rejects missing ticket/workspace/recipient and transport configuration', async () => {
    mocks.databases.push(contextDatabase({ ticket: null }).db)
    await expect(deliverSupportEmail({ ticketId, kind: 'new_ticket', referenceKey: 'x' })).rejects.toThrow('Ticket support introuvable')
    mocks.databases.push(contextDatabase({ workspace: { ...workspace, accessState: 'deleted' } }).db)
    await expect(deliverSupportEmail({ ticketId, kind: 'new_ticket', referenceKey: 'x' })).rejects.toThrow('Workspace support introuvable')
    delete process.env.SUPPORT_EMAIL
    mocks.databases.push(contextDatabase().db)
    await expect(deliverSupportEmail({ ticketId, kind: 'new_ticket', referenceKey: 'x' })).rejects.toThrow('SUPPORT_EMAIL absent')
    process.env.SUPPORT_EMAIL = 'support@example.test'
    mocks.databases.push(contextDatabase().db)
    mocks.emailSend.mockRejectedValueOnce(new Error('YODEV_MAIL_API_KEY absent'))
    await expect(deliverSupportEmail({ ticketId, kind: 'new_ticket', referenceKey: 'x' })).rejects.toThrow('YODEV_MAIL_API_KEY absent')
  })

  it('surfaces retryable provider errors without writing success audit', async () => {
    mocks.emailSend.mockRejectedValue(new Error('provider down'))
    mocks.databases.push(contextDatabase().db)
    await expect(deliverSupportEmail({ ticketId, kind: 'new_ticket', referenceKey: 'x' })).rejects.toThrow('provider down')
  })
})
