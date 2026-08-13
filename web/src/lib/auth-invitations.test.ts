import { beforeEach, describe, expect, it, vi } from 'vitest'
import { databaseDouble } from '../../test/fluent-db'

const mocks = vi.hoisted(() => ({
  database: undefined as unknown,
  transaction: vi.fn(async (callback: (db: unknown) => unknown) => callback(mocks.database)),
  sendAuthEmail: vi.fn(),
}))

vi.mock('@/db/transactions', () => ({ withSystemTransaction: mocks.transaction }))
vi.mock('@/lib/auth-emails', () => ({ sendAuthEmail: mocks.sendAuthEmail }))

import { NonRetryableJobError } from './jobs'
import { deliverAuthInvitation } from './auth-invitations'

const workspaceId = '00000000-0000-4000-8000-000000000001'
const invitationId = '00000000-0000-4000-8000-000000000002'

describe('durable Better Auth invitation delivery', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.sendAuthEmail.mockResolvedValue({ providerMessageId: 'email-1' })
  })

  it('loads only a live pending invitation and sends a localized idempotent email', async () => {
    mocks.database = databaseDouble({ statementResults: [[{
      id: invitationId,
      email: 'member@example.test',
      organizationName: 'Studio',
      locale: 'en',
    }]] }).db
    await expect(deliverAuthInvitation({ invitationId, workspaceId })).resolves.toEqual({ providerMessageId: 'email-1' })
    expect(mocks.sendAuthEmail).toHaveBeenCalledWith(expect.objectContaining({
      to: 'member@example.test',
      locale: 'en',
      kind: 'organization_invitation',
      organizationName: 'Studio',
      idempotencyKey: `auth:invitation:${invitationId}`,
    }))
  })

  it('dead-letters a revoked, expired or cross-workspace invitation without sending', async () => {
    mocks.database = databaseDouble({ statementResults: [[]] }).db
    await expect(deliverAuthInvitation({ invitationId, workspaceId })).rejects.toBeInstanceOf(NonRetryableJobError)
    expect(mocks.sendAuthEmail).not.toHaveBeenCalled()
  })
})
