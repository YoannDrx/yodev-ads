import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ state: vi.fn(), context: vi.fn(), exchange: vi.fn(), create: vi.fn(), set: vi.fn(), seal: vi.fn() }))
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => ({ value: 'signed-state' }), set: mocks.set }) }))
vi.mock('@/lib/workspace', () => ({ requireWorkspacePermission: mocks.context }))
vi.mock('@/lib/feature-flags', () => ({ requireFeature: vi.fn() }))
vi.mock('@/lib/oauth-state', () => ({ openOAuthState: mocks.state, sealOAuthState: mocks.seal, oauthCallbackUrl: () => 'https://ads.example.test/api/connectors/teams/callback' }))
vi.mock('@/lib/teams-oauth', () => ({ exchangeTeamsAuthorizationCode: mocks.exchange }))
vi.mock('@/lib/notification-oauth-management', () => ({ createTeamsOAuthSession: mocks.create }))
import { GET } from './route'
import { entitlementContext } from '@/lib/entitlements'
const workspaceId = '00000000-0000-4000-8000-000000000001'
const sessionId = '00000000-0000-4000-8000-000000000002'
const state = { state: 's'.repeat(32), workspaceId, userId: 'actor-1', expiresAt: Date.now() + 600_000, payload: { codeVerifier: 'pkce-fixture', authorizationId: sessionId } }
const request = () => GET(new Request('https://ads.example.test/api/connectors/teams/callback?code=fixture-code&state=ssssssssssssssssssssssssssssssss'))
describe('Teams callback persistence deadline', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.state.mockReturnValue(state)
    mocks.context.mockResolvedValue({ workspace: { id: workspaceId }, session: { userId: 'actor-1' }, entitlements: entitlementContext('active', 'agency') })
    mocks.exchange.mockResolvedValue({ refreshToken: 'fixture-token', scopes: ['ChannelMessage.Send'] })
    mocks.create.mockResolvedValue({ id: sessionId, expiresAt: new Date(state.expiresAt) })
    mocks.seal.mockReturnValue('signed-selection-session')
  })
  it('passes the signed authorization deadline to persistence after exchange', async () => {
    expect((await request()).headers.get('location')).toBe(`https://ads.example.test/settings/teams?sessionId=${sessionId}&workspaceId=${workspaceId}`)
    expect(mocks.create).toHaveBeenCalledWith({ workspaceId, actorUserId: 'actor-1', authorizationId: sessionId, refreshToken: 'fixture-token', scopes: ['ChannelMessage.Send'], authorizationExpiresAt: new Date(state.expiresAt) })
    expect(mocks.set).toHaveBeenCalledTimes(1)
    expect(mocks.set.mock.calls[0][0]).toBe(`yodev_ads_teams_session_${sessionId}`)
    expect(mocks.seal).toHaveBeenCalledWith(expect.objectContaining({ payload: { sessionId } }))
  })
  it('does not issue a selection session cookie when persistence refuses stale authorization', async () => {
    mocks.create.mockRejectedValue(new Error('La session OAuth Teams a expiré.'))
    expect((await request()).headers.get('location')).toContain('/settings?error=')
    expect(mocks.set.mock.calls.some(([name]) => String(name).startsWith('yodev_ads_teams_session_'))).toBe(false)
  })
  it.each([{ ...state, workspaceId: 'foreign' }, { ...state, userId: 'foreign' }, { ...state, payload: {} }])('rejects mismatched context before provider exchange', async (invalid) => {
    mocks.state.mockReturnValue(invalid)
    expect((await request()).headers.get('location')).toContain('error=')
    expect(mocks.exchange).not.toHaveBeenCalled(); expect(mocks.create).not.toHaveBeenCalled()
  })
})
