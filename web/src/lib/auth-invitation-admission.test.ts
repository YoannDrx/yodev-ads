import { expect, it, vi } from 'vitest'
import { databaseDouble } from '../../test/fluent-db'
const mocks = vi.hoisted(() => ({ database: undefined as unknown }))
vi.mock('@/db/transactions', () => ({ withSystemTransaction: (operation: (db: unknown) => unknown) => operation(mocks.database) }))
import { invitationWorkspaceAdmission } from './auth-invitation-admission'

function fixture(workspace: unknown, count = 0) {
  mocks.database = databaseDouble({ query: { workspaces: { findFirst: async () => workspace } }, statementResults: [[{ count }]] }).db
}

it('explains inactive, expired and unsupported workspace admissions before insertion', async () => {
  for (const state of ['grace', 'suspended', 'deletion_pending', 'deleted', 'unknown']) {
    fixture({ accessState: state, plan: 'agency' })
    expect(await invitationWorkspaceAdmission('org')).toBe('unavailable')
  }
  for (const workspace of [null, { accessState: 'active', plan: 'unknown' }, { accessState: 'active', plan: 'solo' }, { accessState: 'trial', plan: 'internal', trialEndsAt: new Date(0) }]) {
    fixture(workspace)
    expect(await invitationWorkspaceAdmission('org')).toBe('unavailable')
  }
})

it('uses current offer capacity while internal access remains unlimited', async () => {
  for (const [plan, limit] of [['studio', 5], ['agency', 15]] as const) {
    fixture({ accessState: 'active', plan }, limit - 1)
    expect(await invitationWorkspaceAdmission('org')).toBe('available')
    fixture({ accessState: 'active', plan }, limit)
    expect(await invitationWorkspaceAdmission('org')).toBe('full')
  }
  fixture({ accessState: 'internal', plan: 'solo' }, 100_000)
  expect(await invitationWorkspaceAdmission('org')).toBe('available')
})
