import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { databaseDouble } from '../../test/fluent-db'

const mocks = vi.hoisted(() => ({
  database: undefined as unknown,
  purge: vi.fn(async (callback: (db: unknown) => unknown) => callback(mocks.database)),
  system: vi.fn(async (callback: (db: unknown) => unknown) => callback(mocks.database)),
  deleteBlob: vi.fn(),
  removeDomain: vi.fn(),
  decrypt: vi.fn((value: string) => `decrypted:${value}`),
  revokeGoogle: vi.fn(),
}))

vi.mock('@/db/transactions', () => ({ withPurgeTransaction: mocks.purge, withSystemTransaction: mocks.system }))
vi.mock('@vercel/blob', () => ({ del: mocks.deleteBlob }))
vi.mock('@/lib/vercel-domains', () => ({ removeVercelProjectDomain: mocks.removeDomain }))
vi.mock('@/lib/crypto', () => ({ decryptSecret: mocks.decrypt }))
vi.mock('@/lib/google-ads', () => ({ revokeGoogleOAuthToken: mocks.revokeGoogle }))

import {
  expectedWorkspaceDeletionConfirmation,
  purgeWorkspace,
  recordWorkspaceDeletionStripeCancellation,
  revokeWorkspaceGoogleConnection,
  runWorkspaceExternalCleanup,
  workspaceDeletionConfirmationMatches,
} from './workspace-deletion'

const workspaceId = '00000000-0000-4000-8000-000000000001'
const dueRequest = {
  id: '00000000-0000-4000-8000-000000000002',
  requestedAt: new Date('2026-07-12T10:00:00Z'),
  stripeSubscriptionId: null,
  stripeCancellationState: 'not_required',
  googleRevocationState: 'confirmed',
}
const now = new Date('2026-08-12T10:00:00Z')

describe('workspace purge', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.DELETION_TOMBSTONE_KEY = 'tombstone-secret'
    mocks.deleteBlob.mockResolvedValue(undefined)
    mocks.removeDomain.mockResolvedValue({})
    mocks.revokeGoogle.mockResolvedValue({ ok: true, status: 200 })
  })

  afterEach(() => {
    delete process.env.DELETION_TOMBSTONE_KEY
    delete process.env.APP_ENCRYPTION_KEY
  })

  it('requires the exact locale-specific confirmation and never accepts both words', () => {
    expect(expectedWorkspaceDeletionConfirmation('fr')).toBe('SUPPRIMER')
    expect(expectedWorkspaceDeletionConfirmation('en')).toBe('DELETE')
    expect(workspaceDeletionConfirmationMatches('fr', 'SUPPRIMER')).toBe(true)
    expect(workspaceDeletionConfirmationMatches('fr', 'DELETE')).toBe(false)
    expect(workspaceDeletionConfirmationMatches('en', 'DELETE')).toBe(true)
    expect(workspaceDeletionConfirmationMatches('en', 'SUPPRIMER')).toBe(false)
    expect(workspaceDeletionConfirmationMatches('en', 'delete')).toBe(false)
  })

  it('does nothing until a pending deletion is due', async () => {
    mocks.database = databaseDouble({
      query: { deletionRequests: { findFirst: vi.fn(async () => undefined) } },
    }).db
    await expect(purgeWorkspace(workspaceId, new Date('2026-08-12T10:00:00Z'))).resolves.toBe('not_due')
  })

  it('commits the purge and queues external cleanup without a network call in the purge transaction', async () => {
    const database = databaseDouble({
      statementResults: [[dueRequest], [], [], [], []],
      query: {
        deletionRequests: { findFirst: vi.fn(async () => dueRequest) },
        workspaces: { findFirst: vi.fn(async () => ({
          id: workspaceId,
          authOrganizationId: 'org-1',
          logoUrl: 'https://store.public.blob.vercel-storage.com/workspace-branding/ws/logo.png',
        })) },
        workspaceDomains: { findMany: vi.fn(async () => [{ hostname: 'reports.example.test' }]) },
      },
    })
    mocks.database = database.db
    const now = new Date('2026-08-12T10:00:00Z')
    await expect(purgeWorkspace(workspaceId, now)).resolves.toBe('purged')
    expect(database.capture.values[0]).toMatchObject({
      workspaceHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      deletionRequestedAt: dueRequest.requestedAt,
      retainUntil: new Date(now.getTime() + 10 * 365 * 24 * 60 * 60_000),
      externalCleanupStatus: 'pending',
    })
    expect(database.capture.values[1]).toMatchObject({
      type: 'workspace.external_cleanup',
      workspaceId: null,
      payload: expect.objectContaining({
        logoUrl: 'https://store.public.blob.vercel-storage.com/workspace-branding/ws/logo.png',
        hostnames: ['reports.example.test'],
      }),
    })
    expect(mocks.deleteBlob).not.toHaveBeenCalled()
    expect(mocks.removeDomain).not.toHaveBeenCalled()
  })

  it('executes queued external cleanup idempotently after database purge', async () => {
    const database = databaseDouble()
    mocks.database = database.db
    const result = await runWorkspaceExternalCleanup({
      workspaceHash: 'a'.repeat(64),
      logoUrl: 'https://store.public.blob.vercel-storage.com/workspace-branding/ws/logo.png',
      hostnames: ['reports.example.test'],
    })
    expect(result).toMatchObject({ deletedLogo: true, removedDomains: 1 })
    expect(mocks.deleteBlob).toHaveBeenCalledOnce()
    expect(mocks.removeDomain).toHaveBeenCalledWith('reports.example.test')
    expect(database.capture.sets.at(-1)).toMatchObject({ externalCleanupStatus: 'completed' })
  })

  it('fails closed when no independent tombstone key is configured', async () => {
    delete process.env.DELETION_TOMBSTONE_KEY
    mocks.database = databaseDouble({
      query: { deletionRequests: { findFirst: vi.fn(async () => dueRequest) } },
    }).db
    await expect(purgeWorkspace(workspaceId)).rejects.toThrow('not configured')
  })

  it('blocks purge while Stripe remains renewable', async () => {
    const request = { ...dueRequest, stripeSubscriptionId: 'sub_1', stripeCancellationState: 'pending' }
    mocks.database = databaseDouble({
      query: { deletionRequests: { findFirst: vi.fn(async () => request) } },
    }).db
    const stripe = {
      subscriptions: { retrieve: vi.fn(async () => ({ status: 'active', cancel_at_period_end: false })) },
    } as never
    await expect(purgeWorkspace(workspaceId, new Date('2026-08-12T10:00:00Z'), stripe))
      .rejects.toThrow('still renewable')
  })

  it('blocks purge while Google revocation is unresolved', async () => {
    const request = { ...dueRequest, googleRevocationState: 'failed' }
    mocks.database = databaseDouble({
      query: { deletionRequests: { findFirst: vi.fn(async () => request) } },
    }).db
    await expect(purgeWorkspace(workspaceId)).rejects.toThrow('Google OAuth revocation')
  })

  it('fails closed if workspace state changes after the atomic purge claim', async () => {
    const database = databaseDouble({
      statementResults: [[dueRequest]],
      query: {
        deletionRequests: { findFirst: vi.fn(async () => dueRequest) },
        workspaces: { findFirst: vi.fn(async () => undefined) },
      },
    })
    mocks.database = database.db
    await expect(purgeWorkspace(workspaceId)).rejects.toThrow('state changed during purge claim')
  })

  it.each([
    ['confirmed', undefined, null],
    ['failed', new Error('Stripe unavailable'), 'Stripe unavailable'],
    ['failed', 'provider unavailable', 'provider unavailable'],
  ] as const)('records Stripe cancellation state %s', async (state, error, expectedError) => {
    const database = databaseDouble()
    mocks.database = database.db
    await recordWorkspaceDeletionStripeCancellation({
      workspaceId,
      subscriptionId: 'sub_1',
      state,
      error,
      now,
    })
    expect(database.capture.sets[0]).toMatchObject({
      stripeCancellationState: state,
      stripeCancellationConfirmedAt: state === 'confirmed' ? now : null,
      stripeCancellationError: expectedError,
    })
  })

  it('skips Google revocation after cancellation and confirms an already missing connection', async () => {
    const absentRequest = databaseDouble({
      query: {
        deletionRequests: { findFirst: vi.fn(async () => undefined) },
        googleAdsConnections: { findFirst: vi.fn(async () => undefined) },
      },
    })
    mocks.database = absentRequest.db
    await expect(revokeWorkspaceGoogleConnection(workspaceId, now)).resolves.toEqual({ skipped: 'deletion_not_pending' })

    const missingConnection = databaseDouble({
      query: {
        deletionRequests: { findFirst: vi.fn(async () => dueRequest) },
        googleAdsConnections: { findFirst: vi.fn(async () => undefined) },
      },
    })
    mocks.database = missingConnection.db
    await expect(revokeWorkspaceGoogleConnection(workspaceId, now)).resolves.toEqual({ revoked: true, connectionMissing: true })
    expect(missingConnection.capture.sets[0]).toMatchObject({ googleRevocationState: 'confirmed', googleRevocationConfirmedAt: now })
  })

  it('revokes Google OAuth before deleting the local connection', async () => {
    const connection = { id: 'connection-1', encryptedRefreshToken: 'encrypted-token' }
    const database = databaseDouble({
      statementResults: [[{ id: dueRequest.id }], []],
      query: {
        deletionRequests: { findFirst: vi.fn(async () => dueRequest) },
        googleAdsConnections: { findFirst: vi.fn(async () => connection) },
      },
    })
    mocks.database = database.db
    await expect(revokeWorkspaceGoogleConnection(workspaceId, now)).resolves.toEqual({ revoked: true, connectionMissing: false })
    expect(mocks.decrypt).toHaveBeenCalledWith('encrypted-token')
    expect(mocks.revokeGoogle).toHaveBeenCalledWith('decrypted:encrypted-token')
    expect(database.capture.sets[0]).toMatchObject({ googleRevocationState: 'confirmed' })
  })

  it.each([500, 503])('records Google revocation HTTP %s failures for retry', async (status) => {
    const database = databaseDouble({
      query: {
        deletionRequests: { findFirst: vi.fn(async () => dueRequest) },
        googleAdsConnections: { findFirst: vi.fn(async () => ({ id: 'connection-1', encryptedRefreshToken: 'token' })) },
      },
    })
    mocks.database = database.db
    mocks.revokeGoogle.mockResolvedValueOnce({ ok: false, status })
    await expect(revokeWorkspaceGoogleConnection(workspaceId, now)).rejects.toThrow(`HTTP ${status}`)
    expect(database.capture.sets[0]).toMatchObject({ googleRevocationState: 'failed' })
  })

  it('treats Google HTTP 400 as an already invalid token', async () => {
    const database = databaseDouble({
      statementResults: [[{ id: dueRequest.id }], []],
      query: {
        deletionRequests: { findFirst: vi.fn(async () => dueRequest) },
        googleAdsConnections: { findFirst: vi.fn(async () => ({ id: 'connection-1', encryptedRefreshToken: 'token' })) },
      },
    })
    mocks.database = database.db
    mocks.revokeGoogle.mockResolvedValueOnce({ ok: false, status: 400 })
    await expect(revokeWorkspaceGoogleConnection(workspaceId, now)).resolves.toMatchObject({ revoked: true })
  })

  it('completes a purge without queuing cleanup when there are no controlled external assets', async () => {
    delete process.env.DELETION_TOMBSTONE_KEY
    process.env.APP_ENCRYPTION_KEY = 'fallback-tombstone-key'
    const database = databaseDouble({
      statementResults: [[dueRequest], [], []],
      query: {
        deletionRequests: { findFirst: vi.fn(async () => dueRequest) },
        workspaces: { findFirst: vi.fn(async () => ({ id: workspaceId, authOrganizationId: null, logoUrl: 'https://example.test/logo.png' })) },
        workspaceDomains: { findMany: vi.fn(async () => []) },
      },
    })
    mocks.database = database.db
    await expect(purgeWorkspace(workspaceId, now)).resolves.toBe('purged')
    expect(database.capture.values).toHaveLength(1)
    expect(database.capture.values[0]).toMatchObject({ externalCleanupStatus: 'completed', externalCleanupCompletedAt: now })
  })

  it('requires confirmed Stripe state even when no subscription identifier remains', async () => {
    const request = { ...dueRequest, stripeCancellationState: 'failed' }
    mocks.database = databaseDouble({
      query: { deletionRequests: { findFirst: vi.fn(async () => request) } },
    }).db
    await expect(purgeWorkspace(workspaceId, now)).rejects.toThrow('Stripe cancellation')
  })

  it('accepts a subscription already cancelled at period end', async () => {
    const request = { ...dueRequest, stripeSubscriptionId: 'sub_1', stripeCancellationState: 'pending' }
    const database = databaseDouble({
      statementResults: [[], [request]],
      query: {
        deletionRequests: { findFirst: vi.fn(async () => request) },
        workspaces: { findFirst: vi.fn(async () => ({ id: workspaceId, authOrganizationId: null, logoUrl: null })) },
        workspaceDomains: { findMany: vi.fn(async () => []) },
      },
    })
    mocks.database = database.db
    const stripe = { subscriptions: { retrieve: vi.fn(async () => ({ status: 'active', cancel_at_period_end: true })) } } as never
    await expect(purgeWorkspace(workspaceId, now, stripe)).resolves.toBe('purged')
  })

  it('ignores missing external resources and records other cleanup failures', async () => {
    const ignored = databaseDouble()
    mocks.database = ignored.db
    mocks.deleteBlob.mockRejectedValueOnce(new Error('404 not found'))
    mocks.removeDomain.mockRejectedValueOnce(new Error('domain does not exist'))
    await expect(runWorkspaceExternalCleanup({
      workspaceHash: 'a'.repeat(64), logoUrl: 'https://blob.test/logo.png', hostnames: ['reports.example.test'],
    })).resolves.toMatchObject({ deletedLogo: true, removedDomains: 1 })

    const failed = databaseDouble()
    mocks.database = failed.db
    mocks.deleteBlob.mockRejectedValueOnce(new Error('provider unavailable'))
    await expect(runWorkspaceExternalCleanup({
      workspaceHash: 'b'.repeat(64), logoUrl: 'https://blob.test/logo.png', hostnames: [],
    })).rejects.toThrow('provider unavailable')
    expect(failed.capture.sets.at(-1)).toMatchObject({ externalCleanupStatus: 'failed', externalCleanupError: 'provider unavailable' })
  })
})
