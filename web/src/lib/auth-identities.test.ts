import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  user: undefined as unknown,
  transaction: vi.fn(async (callback: (db: unknown) => unknown) => callback({
    query: { authUsers: { findFirst: vi.fn(async () => mocks.user) } },
  })),
}))

vi.mock('@/db/transactions', () => ({ withSystemTransaction: mocks.transaction }))

import { authUser, verifiedAuthUserEmail } from './auth-identities'

describe('Better Auth identity repository', () => {
  beforeEach(() => vi.clearAllMocks())

  it('reads an identity by id and normalizes a verified email', async () => {
    mocks.user = { id: 'user-1', email: 'Owner@Example.TEST', emailVerified: true }
    await expect(authUser('user-1')).resolves.toMatchObject({ id: 'user-1' })
    await expect(verifiedAuthUserEmail('user-1')).resolves.toBe('owner@example.test')
  })

  it('does not disclose an unverified or missing identity address', async () => {
    mocks.user = { id: 'user-1', email: 'owner@example.test', emailVerified: false }
    await expect(verifiedAuthUserEmail('user-1')).resolves.toBeNull()
    mocks.user = undefined
    await expect(verifiedAuthUserEmail('missing')).resolves.toBeNull()
  })
})
