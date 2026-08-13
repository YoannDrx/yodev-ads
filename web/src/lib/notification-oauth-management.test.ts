import { beforeEach, describe, expect, it, vi } from 'vitest'
import { databaseDouble } from '../../test/fluent-db'

const mocks = vi.hoisted(() => ({
  databases: [] as unknown[],
  contexts: [] as unknown[],
  refresh: vi.fn(),
  transaction: vi.fn(async (context: unknown, callback: (db: unknown) => unknown) => {
    mocks.contexts.push(context)
    return callback(mocks.databases.shift())
  }),
}))

vi.mock('@/db/transactions', () => ({ withTenantTransaction: mocks.transaction }))
vi.mock('@/lib/crypto', () => ({
  encryptSecret: (value: string) => `encrypted:${value}`,
  decryptSecret: (value: string) => value.replace(/^encrypted:/, ''),
}))
vi.mock('@/lib/teams-oauth', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/teams-oauth')>(),
  refreshTeamsAccessToken: mocks.refresh,
}))

import { entitlementContext } from '@/lib/entitlements'
import {
  accessTeamsOAuthSession,
  completeTeamsOAuthSession,
  createTeamsOAuthSession,
} from './notification-oauth-management'

const workspaceId = '00000000-0000-4000-8000-000000000001'
const sessionId = '00000000-0000-4000-8000-000000000002'
const channelId = '00000000-0000-4000-8000-000000000003'
const actorUserId = 'user-1'
const now = new Date('2026-08-12T08:00:00.000Z')

function oauthDatabase(input: { statementResults?: unknown[]; session?: unknown; workspace?: unknown } = {}) {
  return databaseDouble({
    statementResults: input.statementResults,
    query: {
      notificationOAuthSessions: { findFirst: vi.fn(async () => input.session) },
      workspaces: { findFirst: vi.fn(async () => input.workspace ?? { accessState: 'active', plan: 'studio' }) },
    },
  })
}

function session(overrides: Record<string, unknown> = {}) {
  return {
    id: sessionId,
    workspaceId,
    userId: actorUserId,
    provider: 'teams',
    encryptedRefreshToken: 'encrypted:refresh-token-with-sufficient-length-old',
    scopes: ['offline_access'],
    expiresAt: new Date('2026-08-12T08:15:00.000Z'),
    ...overrides,
  }
}

describe('notification OAuth management', () => {
  beforeEach(() => {
    mocks.databases = []
    mocks.contexts = []
    vi.clearAllMocks()
  })

  it('replaces stale actor sessions and stores only an encrypted Teams refresh token', async () => {
    const database = oauthDatabase({ statementResults: [[], [], [], [{ id: sessionId, expiresAt: new Date('2026-08-12T08:15:00.000Z') }]] })
    mocks.databases.push(database.db)
    await createTeamsOAuthSession({
      workspaceId, actorUserId, refreshToken: 'refresh-token-with-sufficient-length-old', scopes: ['offline_access'], now,
    })
    expect(database.capture.values[0]).toMatchObject({
      workspaceId, userId: actorUserId, provider: 'teams',
      encryptedRefreshToken: 'encrypted:refresh-token-with-sufficient-length-old',
    })
    expect(JSON.stringify(database.capture.values)).not.toContain('"refreshToken"')
    expect(database.capture.values[1]).toMatchObject({ action: 'notification_channel.teams_oauth_authorized' })
  })

  it('rejects OAuth persistence when lifecycle or plan loses connector access under the workspace lock', async () => {
    mocks.databases.push(
      oauthDatabase({ statementResults: [[]], workspace: { accessState: 'deletion_pending', plan: 'studio' } }).db,
      oauthDatabase({ statementResults: [[]], workspace: { accessState: 'active', plan: 'solo' } }).db,
    )
    const input = {
      workspaceId, actorUserId, refreshToken: 'refresh-token-with-sufficient-length-old', scopes: ['offline_access'], now,
    }
    await expect(createTeamsOAuthSession(input)).rejects.toThrow('Capability required: notifications.webhook')
    await expect(createTeamsOAuthSession(input)).rejects.toThrow('Capability required: notifications.webhook')
  })

  it('refreshes access and optimistically rotates a provider refresh token', async () => {
    const lookup = oauthDatabase({ session: session() })
    const rotation = oauthDatabase({ statementResults: [[{ id: sessionId }]] })
    mocks.databases.push(lookup.db, rotation.db)
    mocks.refresh.mockResolvedValue({
      accessToken: 'access-token', refreshToken: 'refresh-token-with-sufficient-length-new', scopes: ['offline_access'], expiresIn: 3600,
    })
    await expect(accessTeamsOAuthSession({ workspaceId, actorUserId, sessionId, now })).resolves.toMatchObject({ accessToken: 'access-token' })
    expect(rotation.capture.sets[0]).toMatchObject({ encryptedRefreshToken: 'encrypted:refresh-token-with-sufficient-length-new' })
  })

  it('does not write when Microsoft keeps the current refresh token and rejects expired sessions', async () => {
    mocks.databases.push(oauthDatabase({ session: session() }).db, oauthDatabase().db)
    mocks.refresh.mockResolvedValue({
      accessToken: 'access-token', refreshToken: 'refresh-token-with-sufficient-length-old', scopes: [], expiresIn: 3600,
    })
    await expect(accessTeamsOAuthSession({ workspaceId, actorUserId, sessionId, now })).resolves.toMatchObject({ accessToken: 'access-token' })
    await expect(accessTeamsOAuthSession({ workspaceId, actorUserId, sessionId, now })).rejects.toThrow('expiré')
  })

  it('fails closed when concurrent token rotation wins', async () => {
    mocks.databases.push(oauthDatabase({ session: session() }).db, oauthDatabase({ statementResults: [[]] }).db)
    mocks.refresh.mockResolvedValue({
      accessToken: 'access-token', refreshToken: 'refresh-token-with-sufficient-length-new', scopes: [], expiresIn: 3600,
    })
    await expect(accessTeamsOAuthSession({ workspaceId, actorUserId, sessionId, now })).rejects.toThrow('simultanément')
  })

  it('claims the OAuth session, enforces quota and creates an encrypted managed channel atomically', async () => {
    const database = oauthDatabase({
      statementResults: [[], [], [{ count: 0 }], [{ id: channelId }]],
      session: session({ encryptedRefreshToken: 'encrypted:refresh-token-with-sufficient-length-new' }),
    })
    mocks.databases.push(database.db)
    await completeTeamsOAuthSession({
      workspaceId, actorUserId, sessionId, teamId: 'team-1', teamName: 'Yodev', channelId: 'channel-1', channelName: 'Ads alerts',
      entitlements: entitlementContext('active', 'studio'), now,
    })
    expect(database.capture.values[0]).toMatchObject({
      workspaceId, kind: 'teams', label: 'Teams · Yodev · Ads alerts', destinationHint: 'Yodev/Ads alerts',
      encryptedDestination: expect.stringContaining('encrypted:{"v":1,"provider":"teams_graph"'),
    })
    expect(database.capture.values[1]).toMatchObject({
      action: 'notification_channel.created', metadata: expect.objectContaining({ provider: 'microsoft_graph' }),
    })
  })

  it('rejects missing sessions, exhausted quota and failed channel insertion', async () => {
    mocks.databases.push(
      oauthDatabase({ statementResults: [[], []] }).db,
      oauthDatabase({ statementResults: [[], [], [{ count: 1 }]], session: session() }).db,
      oauthDatabase({ statementResults: [[], [], [{ count: 0 }], []], session: session() }).db,
    )
    const base = {
      workspaceId, actorUserId, sessionId, teamId: 'team-1', teamName: 'Yodev', channelId: 'channel-1', channelName: 'Alerts', now,
    }
    await expect(completeTeamsOAuthSession({ ...base, entitlements: entitlementContext('active', 'studio') })).rejects.toThrow('expiré')
    await expect(completeTeamsOAuthSession({ ...base, entitlements: entitlementContext('active', 'solo') })).rejects.toThrow('Quota exceeded')
    await expect(completeTeamsOAuthSession({ ...base, entitlements: entitlementContext('active', 'studio') })).rejects.toThrow('création du canal')
  })
})
