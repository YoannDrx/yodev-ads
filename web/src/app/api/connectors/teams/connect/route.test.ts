import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ context: vi.fn(), begin: vi.fn(), seal: vi.fn(), set: vi.fn() }))
vi.mock('next/headers', () => ({ cookies: async () => ({ set: mocks.set }) }))
vi.mock('@/lib/workspace', () => ({ requireWorkspacePermission: mocks.context }))
vi.mock('@/lib/feature-flags', () => ({ requireFeature: vi.fn() }))
vi.mock('@/lib/rate-limit', () => ({ consumeRateLimit: async () => ({ allowed: true }) }))
vi.mock('@/lib/oauth-state', () => ({ sealOAuthState: mocks.seal, oauthCallbackUrl: () => 'https://ads.example.test/api/connectors/teams/callback' }))
vi.mock('@/lib/notification-oauth-management', () => ({ beginTeamsOAuthSession: mocks.begin }))
vi.mock('@/lib/teams-oauth', () => ({ hasTeamsOAuthConfiguration: () => true, createTeamsPkce: () => ({ verifier: 'fixture-verifier', challenge: 'fixture-challenge' }), teamsAuthorizationUrl: () => 'https://login.microsoftonline.com/fixture-authorize' }))
import { GET } from './route'
import { entitlementContext } from '@/lib/entitlements'
describe('Teams authorization start', () => {
  beforeEach(() => {
    vi.resetAllMocks(); mocks.context.mockResolvedValue({ workspace: { id: 'workspace' }, session: { userId: 'actor' }, entitlements: entitlementContext('active', 'agency') })
    mocks.begin.mockResolvedValue({ id: 'pending-fixture', expiresAt: new Date('2030-01-01') }); mocks.seal.mockReturnValue('signed-state')
  })
  it('signs the durable authorization and sets a cookie unique to its nonce', async () => {
    const response = await GET(new Request('https://ads.example.test/api/connectors/teams/connect'))
    expect(response.headers.get('location')).toBe('https://login.microsoftonline.com/fixture-authorize')
    expect(mocks.begin).toHaveBeenCalledWith({ workspaceId: 'workspace', actorUserId: 'actor' })
    expect(mocks.seal).toHaveBeenCalledWith(expect.objectContaining({ payload: { codeVerifier: 'fixture-verifier', authorizationId: 'pending-fixture' }, expiresAt: new Date('2030-01-01').getTime() }))
    expect(mocks.set.mock.calls[0][0]).toBe(`yodev_ads_teams_oauth_${mocks.seal.mock.calls[0][0].state}`)
  })
  it('does not issue an authorization cookie after a revoked admission', async () => {
    mocks.begin.mockRejectedValue(new Error('Action non autorisée'))
    expect((await GET(new Request('https://ads.example.test/api/connectors/teams/connect'))).headers.get('location')).toContain('/settings?error=')
    expect(mocks.set).not.toHaveBeenCalled()
  })
})
