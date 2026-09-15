import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { databaseDouble } from '../../test/fluent-db'
import type { DatabaseTransaction } from '@/db/transactions'
import { taskNotificationRecipient } from './task-notification-recipient'

describe('current task notification recipient', () => {
  beforeEach(() => vi.stubEnv('NOTIFICATIONS_ENABLED', '1'))
  afterEach(() => vi.unstubAllEnvs())
  const context = { preference: { authUserId: 'member', encryptedEmail: 'obsolete@example.test' }, workspace: { id: 'workspace', ownerUserId: 'owner', accessState: 'active', plan: 'agency' }, user: { id: 'member', email: ' Current@Example.test ', emailVerified: true, name: 'Current name' }, memberRole: 'analyst' }
  it.each(['owner', 'admin', 'strategist', 'analyst'])('accepts current %s access and resolves the current verified mailbox', async (role) => {
    const row = { ...context, memberRole: role, workspace: { ...context.workspace, ownerUserId: role === 'owner' ? 'member' : 'owner' } }
    const { db } = databaseDouble({ statementResults: [[row], [{ expired: false, user: row.user }]] })
    expect((await taskNotificationRecipient(db as unknown as DatabaseTransaction, 'preference'))?.email).toBe('current@example.test')
  })
  it.each(['removed', 'client', 'unverified', 'grace', 'expired', 'disabled'])('refuses a %s recipient before preparing an email', async (kind) => {
    if (kind === 'disabled') vi.stubEnv('NOTIFICATIONS_ENABLED', '0')
    const row = { ...context, memberRole: kind === 'client' ? 'client' : 'analyst', user: { ...context.user, emailVerified: kind !== 'unverified' }, workspace: { ...context.workspace, accessState: kind === 'grace' ? 'grace' : kind === 'expired' ? 'trial' : 'active' } }
    const { db } = databaseDouble({ statementResults: [kind === 'removed' ? [] : [row], [{ expired: kind === 'expired', user: row.user }]] })
    expect(await taskNotificationRecipient(db as unknown as DatabaseTransaction, 'preference')).toBeNull()
  })
})
