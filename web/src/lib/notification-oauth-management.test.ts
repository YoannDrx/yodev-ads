import { beforeEach, describe, expect, it, vi } from 'vitest'
import { databaseDouble } from '../../test/fluent-db'

const mocks = vi.hoisted(() => ({
  databases: [] as unknown[],
  refresh: vi.fn(),
  transaction: vi.fn(async (_context: unknown, callback: (db: unknown) => unknown) => callback(mocks.databases.shift())),
}))
vi.mock('@/db/transactions', () => ({ withTenantTransaction: mocks.transaction }))
vi.mock('@/lib/crypto', () => ({
  encryptSecret: (value: string) => `encrypted:${value}`,
  decryptSecret: (value: string) => value.replace(/^encrypted:/, ''),
}))
vi.mock('@/lib/teams-oauth', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/teams-oauth')>(), refreshTeamsAccessToken: mocks.refresh,
}))
import { entitlementContext } from '@/lib/entitlements'
import { accessTeamsOAuthSession, completeTeamsOAuthSession, createTeamsOAuthSession, beginTeamsOAuthSession } from './notification-oauth-management'

const workspaceId = '00000000-0000-4000-8000-000000000001'
const sessionId = '00000000-0000-4000-8000-000000000002'
const channelId = '00000000-0000-4000-8000-000000000003'
const actorUserId = 'user-1', context = { workspaceId, actorUserId }
const expiry = new Date('2030-08-12T08:15:00.000Z'), clock = { rows: [{ valid: true }] }, expired = { rows: [{ valid: false }] }
const oldToken = 'refresh-token-with-sufficient-length-old', newToken = 'refresh-token-with-sufficient-length-new'
const creation = { ...context, authorizationId: sessionId, refreshToken: oldToken, scopes: ['offline_access'], authorizationExpiresAt: expiry }
const completion = { ...context, sessionId, teamId: 'team-1', teamName: 'Yodev', channelId: 'channel-1', channelName: 'Ads alerts', entitlements: entitlementContext('active', 'agency') }
function session(token = oldToken) {
  return { id: sessionId, workspaceId, userId: actorUserId, provider: 'teams', encryptedRefreshToken: `encrypted:${token}`, scopes: ['offline_access'], expiresAt: expiry }
}
function database(results: unknown[] = [], overrides: Record<string, unknown> = {}) {
  return databaseDouble({ statementResults: [{ rows: [{ state: 'active', plan: 'studio', member_role: 'admin', is_owner: false, trial_expired: false, ...overrides }] }, ...results] })
}

describe('notification OAuth management', () => {
  beforeEach(() => {
    mocks.databases = []; vi.clearAllMocks()
    mocks.refresh.mockResolvedValue({ accessToken: 'access-token', refreshToken: newToken, scopes: ['offline_access'], expiresIn: 3600 })
  })
  it('stores encrypted refresh credentials and audits the authorized session', async () => {
    const db = database([clock, [session('yodev:teams:authorization-pending')], clock, [{ id: sessionId, expiresAt: expiry }], [], clock, clock]); mocks.databases.push(db.db)
    await expect(createTeamsOAuthSession(creation)).resolves.toEqual({ id: sessionId, expiresAt: expiry })
    expect(db.capture.sets[0]).toMatchObject({ encryptedRefreshToken: `encrypted:${oldToken}` })
    expect(JSON.stringify(db.capture.values)).not.toContain('"refreshToken"')
    expect(db.capture.values[0]).toMatchObject({ action: 'notification_channel.teams_oauth_authorized' })
  })
  it.each(['create', 'access', 'complete', 'begin'])('rejects a revoked actor before %s or provider calls', async (kind) => {
    const db = database([], { member_role: 'client' }); mocks.databases.push(db.db)
    const work = kind === 'begin' ? beginTeamsOAuthSession(context) : kind === 'create' ? createTeamsOAuthSession(creation) : kind === 'access' ? accessTeamsOAuthSession({ ...context, sessionId }) : completeTeamsOAuthSession(completion)
    await expect(work).rejects.toThrow('non autorisée'); expect(db.capture.values).toEqual([]); expect(mocks.refresh).not.toHaveBeenCalled()
  })
  it.each([{ state: 'deletion_pending' }, { plan: 'solo' }])('rejects current lifecycle or plan without connector access: %j', async (overrides) => {
    mocks.databases.push(database([], overrides).db)
    await expect(createTeamsOAuthSession(creation)).rejects.toThrow('non autorisée')
  })
  it('refuses an expired callback before replacing any session', async () => {
    const db = database([expired]); mocks.databases.push(db.db)
    await expect(createTeamsOAuthSession(creation)).rejects.toThrow('expiré'); expect(db.capture.values).toEqual([])
  })
  it('starts one encrypted pending authorization', async () => {
    const db = database([[], [{ id: sessionId, expiresAt: expiry }], clock]); mocks.databases.push(db.db)
    await expect(beginTeamsOAuthSession(context)).resolves.toMatchObject({ id: sessionId })
    expect(db.capture.values[0]).toMatchObject({ encryptedRefreshToken: 'encrypted:yodev:teams:authorization-pending' })
  })
  it('refuses a callback already consumed without replacing credentials', async () => {
    const db = database([clock, [session()], clock]); mocks.databases.push(db.db)
    await expect(createTeamsOAuthSession(creation)).rejects.toThrow('changé'); expect(db.capture.sets).toEqual([])
  })
  it('never refreshes or completes an authorization still pending', async () => {
    mocks.databases.push(database([[session('yodev:teams:authorization-pending')], clock]).db, database([[], [session('yodev:teams:authorization-pending')], clock]).db)
    await expect(accessTeamsOAuthSession({ ...context, sessionId })).rejects.toThrow('changé')
    await expect(completeTeamsOAuthSession(completion)).rejects.toThrow('changé')
    expect(mocks.refresh).not.toHaveBeenCalled()
  })
  it('refreshes access and stores a rotated provider refresh token', async () => {
    const rotated = database([[session()], clock, [], clock]); mocks.databases.push(database([[session()], clock]).db, rotated.db)
    await expect(accessTeamsOAuthSession({ ...context, sessionId })).resolves.toEqual({ accessToken: 'access-token', expiresAt: expiry })
    expect(rotated.capture.sets[0]).toMatchObject({ encryptedRefreshToken: `encrypted:${newToken}` })
  })
  it('reauthorizes even when Microsoft keeps the refresh token unchanged', async () => {
    mocks.refresh.mockResolvedValue({ accessToken: 'access-token', refreshToken: oldToken, scopes: [] })
    mocks.databases.push(database([[session()], clock]).db, database([], { member_role: 'client' }).db)
    await expect(accessTeamsOAuthSession({ ...context, sessionId })).rejects.toThrow('non autorisée')
    expect(mocks.transaction).toHaveBeenCalledTimes(2)
  })
  it('checks the unchanged token session again without writing', async () => {
    mocks.refresh.mockResolvedValue({ accessToken: 'access-token', refreshToken: oldToken, scopes: [] })
    const recheck = database([[session()], clock, clock]); mocks.databases.push(database([[session()], clock]).db, recheck.db)
    await expect(accessTeamsOAuthSession({ ...context, sessionId })).resolves.toMatchObject({ accessToken: 'access-token' })
    expect(recheck.capture.sets).toEqual([])
  })
  it('rejects concurrent rotation without overwriting its token', async () => {
    const recheck = database([[session('another-refresh-token')], clock]); mocks.databases.push(database([[session()], clock]).db, recheck.db)
    await expect(accessTeamsOAuthSession({ ...context, sessionId })).rejects.toThrow('simultanément'); expect(recheck.capture.sets).toEqual([])
  })
  it.each([false, true])('rejects absent or expired stored sessions before refresh: present=%s', async (present) => {
    mocks.databases.push(database([present ? [session()] : [], expired]).db)
    await expect(accessTeamsOAuthSession({ ...context, sessionId })).rejects.toThrow('expiré'); expect(mocks.refresh).not.toHaveBeenCalled()
  })
  it('uses the current quota instead of the caller’s higher previous allowance', async () => {
    const db = database([[], [session()], clock, [{ count: 10 }]]); mocks.databases.push(db.db)
    await expect(completeTeamsOAuthSession(completion)).rejects.toThrow('Quota exceeded'); expect(db.capture.values).toEqual([])
  })
  it('consumes the session and creates one encrypted channel and audit', async () => {
    const db = database([[], [session(newToken)], clock, [{ count: 0 }], [{ id: channelId }], [], [], clock]); mocks.databases.push(db.db)
    await expect(completeTeamsOAuthSession(completion)).resolves.toEqual({ id: channelId })
    expect(db.capture.values[0]).toMatchObject({ workspaceId, kind: 'teams', destinationHint: 'Yodev/Ads alerts', encryptedDestination: expect.stringContaining(`"refreshToken":"${newToken}"`) })
    expect(db.capture.values[1]).toMatchObject({ action: 'notification_channel.created' })
  })
  it('rejects failed channel insertion', async () => {
    mocks.databases.push(database([[], [session()], clock, [{ count: 0 }], []]).db)
    await expect(completeTeamsOAuthSession(completion)).rejects.toThrow('création du canal')
  })
})
