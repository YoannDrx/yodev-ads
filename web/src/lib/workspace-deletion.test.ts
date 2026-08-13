import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { databaseDouble } from '../../test/fluent-db'

const mocks = vi.hoisted(() => ({
  database: undefined as unknown,
  purge: vi.fn(async (callback: (db: unknown) => unknown) => callback(mocks.database)),
  deleteBlob: vi.fn(),
  removeDomain: vi.fn(),
}))

vi.mock('@/db/transactions', () => ({ withPurgeTransaction: mocks.purge }))
vi.mock('@vercel/blob', () => ({ del: mocks.deleteBlob }))
vi.mock('@/lib/vercel-domains', () => ({ removeVercelProjectDomain: mocks.removeDomain }))

import { purgeWorkspace } from './workspace-deletion'

const workspaceId = '00000000-0000-4000-8000-000000000001'

describe('workspace purge', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.DELETION_TOMBSTONE_KEY = 'tombstone-secret'
    mocks.deleteBlob.mockResolvedValue(undefined)
    mocks.removeDomain.mockResolvedValue({})
  })

  afterEach(() => {
    delete process.env.DELETION_TOMBSTONE_KEY
    delete process.env.APP_ENCRYPTION_KEY
  })

  it('does nothing until a pending deletion is due', async () => {
    mocks.database = databaseDouble({ statementResults: [[]] }).db
    await expect(purgeWorkspace(workspaceId, new Date('2026-08-12T10:00:00Z'))).resolves.toBe('not_due')
  })

  it('writes a pseudonymous tombstone before cascade-deleting the workspace', async () => {
    const requestedAt = new Date('2026-07-12T10:00:00Z')
    const database = databaseDouble({
      statementResults: [[{ id: 'request-1', requestedAt }], [], []],
      query: {
        workspaces: { findFirst: vi.fn(async () => ({ id: workspaceId, authOrganizationId: 'org-1', logoUrl: 'https://store.public.blob.vercel-storage.com/workspace-branding/ws/logo.png' })) },
        workspaceDomains: { findMany: vi.fn(async () => [{ hostname: 'reports.example.test' }]) },
      },
    })
    mocks.database = database.db
    const now = new Date('2026-08-12T10:00:00Z')
    await expect(purgeWorkspace(workspaceId, now)).resolves.toBe('purged')
    expect(database.capture.values[0]).toMatchObject({
      workspaceHash: expect.stringMatching(/^[a-f0-9]{64}$/), deletionRequestedAt: requestedAt,
      retainUntil: new Date(now.getTime() + 10 * 365 * 24 * 60 * 60_000),
    })
    expect(mocks.deleteBlob).toHaveBeenCalledOnce()
    expect(mocks.removeDomain).toHaveBeenCalledWith('reports.example.test')
  })

  it('fails closed when no independent tombstone key is configured', async () => {
    delete process.env.DELETION_TOMBSTONE_KEY
    const database = databaseDouble({
      statementResults: [[{ id: 'request-1', requestedAt: new Date() }]],
      query: {
        workspaces: { findFirst: vi.fn(async () => ({ id: workspaceId, authOrganizationId: 'org-1', logoUrl: null })) },
        workspaceDomains: { findMany: vi.fn(async () => []) },
      },
    })
    mocks.database = database.db
    await expect(purgeWorkspace(workspaceId)).rejects.toThrow('not configured')
  })

  it('fails closed if workspace state changes after the atomic purge claim', async () => {
    const database = databaseDouble({
      statementResults: [[{ id: 'request-1', requestedAt: new Date() }]],
      query: { workspaces: { findFirst: vi.fn(async () => undefined) } },
    })
    mocks.database = database.db
    await expect(purgeWorkspace(workspaceId)).rejects.toThrow('state changed during purge claim')
  })
})
