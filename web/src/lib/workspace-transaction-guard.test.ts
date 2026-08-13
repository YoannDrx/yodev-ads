import { describe, expect, it, vi } from 'vitest'
import { databaseDouble } from '../../test/fluent-db'
import { lockWorkspaceAccessBoundary, lockWorkspaceEntitlements } from './workspace-transaction-guard'

const workspaceId = '00000000-0000-4000-8000-000000000001'

function guardedDatabase(workspace: unknown) {
  return databaseDouble({
    statementResults: [[]],
    query: { workspaces: { findFirst: vi.fn(async () => workspace) } },
  })
}

describe('workspace transaction guard', () => {
  it('serializes access creation and recomputes capabilities from the current database state', async () => {
    const database = guardedDatabase({ accessState: 'active', plan: 'agency' })
    const context = await lockWorkspaceEntitlements(database.db as never, workspaceId, 'custom_domain')
    expect(context.plan).toBe('agency')
    expect(context.capabilities.has('custom_domain')).toBe(true)
  })

  it('fails closed after deletion, downgrade or malformed lifecycle state', async () => {
    await expect(lockWorkspaceEntitlements(
      guardedDatabase({ accessState: 'deletion_pending', plan: 'agency' }).db as never,
      workspaceId,
      'google.read',
    )).rejects.toThrow('Capability required: google.read')
    await expect(lockWorkspaceEntitlements(
      guardedDatabase({ accessState: 'active', plan: 'solo' }).db as never,
      workspaceId,
      'api.read',
    )).rejects.toThrow('Capability required: api.read')
    await expect(lockWorkspaceEntitlements(
      guardedDatabase({ accessState: 'unknown', plan: 'agency' }).db as never,
      workspaceId,
    )).rejects.toThrow('indisponible')
  })

  it('exposes the shared boundary lock for lifecycle transitions', async () => {
    const database = databaseDouble({ statementResults: [[]] })
    await expect(lockWorkspaceAccessBoundary(database.db as never, workspaceId)).resolves.toEqual([])
  })
})
