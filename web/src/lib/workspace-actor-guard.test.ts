import { expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ db: undefined as unknown }))
vi.mock('@/db/transactions', () => ({ withTenantTransaction: async (_context: unknown, operation: (db: unknown) => unknown) => operation(mocks.db) }))
import { databaseDouble } from '../../test/fluent-db'
import { lockWorkspaceActor, withWorkspaceActorTransaction } from './workspace-actor-guard'

const input = { workspaceId: '00000000-0000-4000-8000-000000000001', actorUserId: 'actor', permission: 'alerts:manage' as const }
const current = { state: 'active', plan: 'studio', is_owner: false, member_role: 'strategist', trial_expired: false }
const database = (row: unknown) => databaseDouble({ statementResults: [{ rows: row ? [row] : [] }] }).db as never

it('authorizes the current membership and applies the current owner mapping', async () => {
  expect((await lockWorkspaceActor(database(current), input)).role).toBe('strategist')
  expect((await lockWorkspaceActor(database({ ...current, member_role: 'client', is_owner: true }), input)).role).toBe('owner')
})

it.each([null, { ...current, state: 'unknown' }, { ...current, plan: 'unknown' }, { ...current, member_role: 'analyst' }, { ...current, state: 'grace' }, { ...current, state: 'suspended' }])('fails closed for missing or revoked access: %j', async (row) => {
  await expect(lockWorkspaceActor(database(row), input)).rejects.toThrow('non autorisée')
})

it('enforces trial expiry even before the lifecycle scheduler and checks current plan capabilities', async () => {
  await expect(lockWorkspaceActor(database({ ...current, state: 'trial', plan: 'internal', trial_expired: true }), input)).rejects.toThrow('non autorisée')
  await expect(lockWorkspaceActor(database({ ...current, member_role: 'admin', plan: 'solo' }), { ...input, capability: 'custom_domain' })).rejects.toThrow('non autorisée')
})

it('checks trial time again after the operation and refuses to commit an expired trial', async () => {
  const trial = { ...current, state: 'trial' }
  mocks.db = databaseDouble({ statementResults: [{ rows: [trial] }, { rows: [{ ...trial, trial_expired: true }] }] }).db
  const operation = vi.fn(async () => 'must not commit')
  await expect(withWorkspaceActorTransaction(input, operation)).rejects.toThrow('non autorisée')
  expect(operation).toHaveBeenCalledOnce()
})

it('returns the result for active workspaces and trials still valid after business work', async () => {
  mocks.db = database(current)
  await expect(withWorkspaceActorTransaction(input, async () => 42)).resolves.toBe(42)
  const trial = { ...current, state: 'trial' }
  mocks.db = databaseDouble({ statementResults: [{ rows: [trial] }, { rows: [trial] }] }).db
  await expect(withWorkspaceActorTransaction(input, async () => 43)).resolves.toBe(43)
})
