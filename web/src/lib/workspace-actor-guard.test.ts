import { expect, it } from 'vitest'
import { databaseDouble } from '../../test/fluent-db'
import { lockWorkspaceActor } from './workspace-actor-guard'

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
