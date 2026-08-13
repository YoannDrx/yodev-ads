import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  cookieDelete: vi.fn(),
  exchange: vi.fn(),
  revoke: vi.fn(),
  save: vi.fn(),
}))

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: () => ({ value: 'sealed-oauth-state' }),
    delete: mocks.cookieDelete,
  }),
}))
vi.mock('@/lib/crypto', () => ({ encryptSecret: (value: string) => `encrypted:${value}` }))
vi.mock('@/lib/google-ads', () => ({
  exchangeAuthorizationCode: mocks.exchange,
  revokeGoogleOAuthToken: mocks.revoke,
}))
vi.mock('@/lib/oauth-state', () => ({
  oauthCallbackUrl: () => 'https://ads.example.test/api/google-ads/callback',
  openOAuthState: () => ({
    state: 'returned-state',
    workspaceId: '00000000-0000-4000-8000-000000000001',
    userId: 'user-1',
    payload: { managerCustomerId: '1234567890' },
  }),
}))
vi.mock('@/lib/workspace', () => ({
  requireAdminWorkspace: async () => ({
    workspace: { id: '00000000-0000-4000-8000-000000000001' },
    session: { userId: 'user-1' },
  }),
}))
vi.mock('@/lib/data', () => ({ saveWorkspaceGoogleConnection: mocks.save }))

import { GET } from './route'

describe('Google Ads OAuth callback compensation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.exchange.mockResolvedValue({
      refreshToken: 'new-google-refresh-token',
      scopes: ['https://www.googleapis.com/auth/adwords'],
      email: 'owner@example.test',
    })
    mocks.revoke.mockResolvedValue(new Response(null, { status: 200 }))
  })

  it('revokes a grant when a lifecycle race rejects tenant persistence', async () => {
    mocks.save.mockRejectedValue(new Error('Workspace access is suspended'))
    const response = await GET(new Request('https://ads.example.test/api/google-ads/callback?code=code-1&state=returned-state'))
    expect(mocks.revoke).toHaveBeenCalledOnce()
    expect(mocks.revoke).toHaveBeenCalledWith('new-google-refresh-token')
    expect(response.headers.get('location')).toContain('Workspace+access+is+suspended')
  })

  it('keeps the persisted grant and does not revoke it after success', async () => {
    mocks.save.mockResolvedValue({ id: 'connection-1' })
    const response = await GET(new Request('https://ads.example.test/api/google-ads/callback?code=code-1&state=returned-state'))
    expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({
      encryptedRefreshToken: 'encrypted:new-google-refresh-token',
      managerCustomerId: '1234567890',
    }))
    expect(mocks.revoke).not.toHaveBeenCalled()
    expect(response.headers.get('location')).toContain('notice=')
  })
})
