import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  cookieDelete: vi.fn(),
  exchange: vi.fn(),
  revoke: vi.fn(),
  save: vi.fn(), context: vi.fn(), state: vi.fn(),
}))

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: () => ({ value: 'sealed-oauth-state' }),
    delete: mocks.cookieDelete,
  }),
}))
vi.mock('@/lib/crypto', () => ({ encryptSecret: (value: string) => `encrypted:${value}` }))
vi.mock('@/lib/google-ads', () => ({
  GOOGLE_ADS_SCOPE: 'https://www.googleapis.com/auth/adwords',
  exchangeAuthorizationCode: mocks.exchange,
  revokeGoogleOAuthToken: mocks.revoke,
}))
vi.mock('@/lib/oauth-state', () => ({
  oauthCallbackUrl: () => 'https://ads.example.test/api/google-ads/callback',
  openOAuthState: mocks.state,
}))
vi.mock('@/lib/workspace', () => ({ requireWorkspacePermission: mocks.context }))
vi.mock('@/lib/data', () => ({ saveWorkspaceGoogleConnection: mocks.save }))

import { GET } from './route'
import { entitlementContext } from '@/lib/entitlements'
const workspaceId = '00000000-0000-4000-8000-000000000001'
const state = { state: 'returned-state', workspaceId, userId: 'user-1', expiresAt: Date.now() + 600_000, payload: { managerCustomerId: '1234567890', connectionVersion: 'original-version' } }
const callback = () => GET(new Request('https://ads.example.test/api/google-ads/callback?code=code-1&state=returned-state'))
afterEach(() => vi.unstubAllGlobals())

describe('Google Ads OAuth callback admission', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Unexpected provider request') }))
    mocks.state.mockReturnValue(state)
    mocks.context.mockResolvedValue({ workspace: { id: workspaceId, locale: 'en' }, session: { userId: 'user-1' }, entitlements: entitlementContext('active', 'agency') })
    mocks.exchange.mockResolvedValue({
      refreshToken: 'new-google-refresh-token',
      scopes: ['https://www.googleapis.com/auth/adwords'],
      email: 'owner@example.test',
    })
    mocks.revoke.mockResolvedValue(new Response(null, { status: 200 }))
  })

  it('discards an unpersisted token without revoking a combined Google grant', async () => {
    mocks.save.mockRejectedValue(new Error('Workspace access is suspended'))
    const response = await GET(new Request('https://ads.example.test/api/google-ads/callback?code=code-1&state=returned-state'))
    expect(mocks.revoke).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
    expect(mocks.cookieDelete).not.toHaveBeenCalled()
    expect(response.headers.get('location')).toContain('Workspace+access+is+suspended')
  })

  it('keeps the persisted grant and does not revoke it after success', async () => {
    mocks.save.mockResolvedValue({ id: 'connection-1' })
    const response = await GET(new Request('https://ads.example.test/api/google-ads/callback?code=code-1&state=returned-state'))
    expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({
      encryptedRefreshToken: 'encrypted:new-google-refresh-token',
      managerCustomerId: '1234567890', expectedConnectionVersion: state.payload.connectionVersion, authorizationExpiresAt: new Date(state.expiresAt),
    }))
    expect(mocks.revoke).not.toHaveBeenCalled()
    expect(response.headers.get('location')).toContain('Google+Ads+is+connected')
    expect(mocks.cookieDelete).not.toHaveBeenCalled()
  })
  it.each([
    { ...state, workspaceId: 'foreign' }, { ...state, userId: 'other' },
    { ...state, payload: { managerCustomerId: '1234567890' } }, { ...state, payload: { ...state.payload, managerCustomerId: 'abcdefghij' } },
  ])('rejects mismatched or pre-version state before exchanging a code', async (invalid) => {
    mocks.state.mockReturnValue(invalid)
    expect((await callback()).headers.get('location')).toContain('error=')
    expect(mocks.exchange).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled()
  })
  it('checks current capability before any provider exchange', async () => {
    mocks.context.mockResolvedValue({ workspace: { id: workspaceId }, session: { userId: 'user-1' }, entitlements: entitlementContext('grace', 'agency') })
    expect((await callback()).headers.get('location')).toContain('error=')
    expect(mocks.exchange).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled()
  })
  it('does not persist or revoke a partial grant lacking Google Ads access', async () => {
    mocks.exchange.mockResolvedValue({ refreshToken: 'partial-grant', scopes: ['openid'], email: null })
    expect((await callback()).headers.get('location')).toContain('error=')
    expect(mocks.save).not.toHaveBeenCalled(); expect(mocks.revoke).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled()
  })

})
