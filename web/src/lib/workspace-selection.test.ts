import { beforeEach, expect, it, vi } from 'vitest'
import { databaseDouble } from '../../test/fluent-db'

const mocks = vi.hoisted(() => ({ database: undefined as unknown }))
vi.mock('@/db/transactions', () => ({ withSystemTransaction: (operation: (db: unknown) => unknown) => operation(mocks.database) }))
import { resolveWorkspaceSelection } from './workspace-selection'

beforeEach(() => { mocks.database = undefined })
const input = { sessionId: 'session', userId: 'user' }

it('does not recover a revoked or expired session', async () => {
  const fixture = databaseDouble({ statementResults: [[]] })
  mocks.database = fixture.db
  expect(await resolveWorkspaceSelection(input)).toBeNull()
  expect(fixture.capture.sets).toHaveLength(0)
})

it('keeps a valid current selection without rewriting it', async () => {
  const fixture = databaseDouble({ statementResults: [[{ activeOrganizationId: 'valid' }], [{ organizationId: 'valid' }]] })
  mocks.database = fixture.db
  expect(await resolveWorkspaceSelection(input)).toBe('valid')
  expect(fixture.capture.sets).toHaveLength(0)
})

it('repairs a missing selection or clears an inaccessible organization without granting membership', async () => {
  for (const [current, next] of [[null, 'other'], ['removed', 'other'], ['removed', null], [null, null]]) {
    const fixture = databaseDouble({ statementResults: [[{ activeOrganizationId: current }], next ? [{ organizationId: next }] : []] })
    mocks.database = fixture.db
    expect(await resolveWorkspaceSelection(input)).toBe(next)
    expect(fixture.capture.sets).toEqual(current === next ? [] : [{ activeOrganizationId: next, updatedAt: expect.any(Date) }])
    expect(fixture.capture.values).toHaveLength(0)
  }
})
