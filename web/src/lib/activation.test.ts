import { beforeEach, describe, expect, it, vi } from 'vitest'
import { databaseDouble } from '../../test/fluent-db'

const mocks = vi.hoisted(() => ({
  database: undefined as unknown,
  transaction: vi.fn(async (_context: unknown, callback: (db: unknown) => unknown) => callback(mocks.database)),
}))

vi.mock('@/db/transactions', () => ({ withTenantTransaction: mocks.transaction }))

import { insertActivationMilestone, recordActivationMilestone } from './activation'

describe('activation milestone persistence', () => {
  beforeEach(() => vi.clearAllMocks())

  it('writes an idempotent milestone with explicit defaults', async () => {
    const database = databaseDouble({ statementResults: [[]] })
    await insertActivationMilestone(database.db as never, {
      workspaceId: 'workspace-1', milestone: 'first_report', actorUserId: 'user-1',
    })
    expect(database.capture.values).toContainEqual(expect.objectContaining({
      workspaceId: 'workspace-1', milestone: 'first_report', actorUserId: 'user-1',
      sourceEntityId: null, metadata: {},
    }))
  })

  it('opens the tenant transaction with the actor and preserves evidence metadata', async () => {
    const database = databaseDouble({ statementResults: [[]] })
    mocks.database = database.db
    await recordActivationMilestone({
      workspaceId: 'workspace-1', milestone: 'paid_conversion', actorUserId: 'owner-1',
      sourceEntityId: 'subscription-1', metadata: { plan: 'solo' },
    })
    expect(mocks.transaction).toHaveBeenCalledWith(
      { workspaceId: 'workspace-1', userId: 'owner-1' }, expect.any(Function),
    )
    expect(database.capture.values).toContainEqual(expect.objectContaining({
      sourceEntityId: 'subscription-1', metadata: { plan: 'solo' },
    }))
  })
})
