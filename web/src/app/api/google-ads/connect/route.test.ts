import { beforeEach, describe, expect, it, vi } from 'vitest'
import { entitlementContext } from '@/lib/entitlements'
const mocks = vi.hoisted(() => ({ context: vi.fn(), connection: vi.fn(), cookie: vi.fn(), seal: vi.fn(), limit: vi.fn(), authorize: vi.fn() }))
vi.mock('next/headers', () => ({ cookies: async () => ({ set: mocks.cookie }) }))
vi.mock('@/lib/workspace', () => ({ requireWorkspacePermission: mocks.context }))
vi.mock('@/lib/env', () => ({ hasGoogleConfiguration: () => true }))
vi.mock('@/lib/data', () => ({ getWorkspaceConnection: mocks.connection, googleConnectionVersion: (connection: unknown) => connection ? 'current-version' : 'none' }))
vi.mock('@/lib/google-ads', () => ({ googleAuthorizationUrl: mocks.authorize }))
vi.mock('@/lib/oauth-state', () => ({ oauthCallbackUrl: () => 'https://ads.example.test/api/google-ads/callback', sealOAuthState: mocks.seal }))
vi.mock('@/lib/rate-limit', () => ({ consumeRateLimit: mocks.limit }))
import { GET } from './route'
const request = () => new Request('https://ads.example.test/api/google-ads/connect?managerCustomerId=123-456-7890')
describe('Google authorization initiation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.context.mockResolvedValue({ workspace: { id: 'workspace' }, session: { userId: 'user' }, entitlements: entitlementContext('active', 'agency') })
    mocks.connection.mockResolvedValue({ id: 'existing' }); mocks.limit.mockResolvedValue({ allowed: true }); mocks.seal.mockReturnValue('signed-state')
    mocks.authorize.mockReturnValue('https://accounts.google.com/authorization-fixture')
  })
  it.each([true, false])('seals the connection version observed before redirecting (existing=%s)', async (existing) => {
    mocks.connection.mockResolvedValue(existing ? { id: 'existing' } : undefined)
    expect((await GET(request())).headers.get('location')).toBe('https://accounts.google.com/authorization-fixture')
    expect(mocks.context).toHaveBeenCalledWith('google:connect')
    expect(mocks.seal).toHaveBeenCalledWith(expect.objectContaining({ payload: { managerCustomerId: '1234567890', connectionVersion: existing ? 'current-version' : 'none' } }))
    expect(mocks.cookie).toHaveBeenCalledWith('yodev_ads_google_oauth', 'signed-state', expect.objectContaining({ httpOnly: true, sameSite: 'lax' }))
  })
  it('denies an inactive entitlement before rate-limit writes or provider authorization', async () => {
    mocks.context.mockResolvedValue({ workspace: { id: 'workspace' }, session: { userId: 'user' }, entitlements: entitlementContext('grace', 'agency') })
    expect((await GET(request())).headers.get('location')).toContain('error=')
    expect(mocks.limit).not.toHaveBeenCalled(); expect(mocks.cookie).not.toHaveBeenCalled(); expect(mocks.authorize).not.toHaveBeenCalled()
  })
})
