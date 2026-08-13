import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { oauthCallbackUrl, openOAuthState, sealOAuthState } from './oauth-state'

const workspaceId = '00000000-0000-4000-8000-000000000001'

describe('OAuth state envelope', () => {
  const previousKey = process.env.OAUTH_STATE_KEY
  const previousAppKey = process.env.APP_ENCRYPTION_KEY
  const previousAppUrl = process.env.NEXT_PUBLIC_APP_URL
  const previousGoogleRedirect = process.env.GOOGLE_OAUTH_REDIRECT_URI

  beforeEach(() => {
    process.env.OAUTH_STATE_KEY = 'oauth-state-test-key-with-at-least-thirty-two-characters'
  })

  afterEach(() => {
    if (previousKey === undefined) delete process.env.OAUTH_STATE_KEY
    else process.env.OAUTH_STATE_KEY = previousKey
    if (previousAppKey === undefined) delete process.env.APP_ENCRYPTION_KEY
    else process.env.APP_ENCRYPTION_KEY = previousAppKey
    if (previousAppUrl === undefined) delete process.env.NEXT_PUBLIC_APP_URL
    else process.env.NEXT_PUBLIC_APP_URL = previousAppUrl
    if (previousGoogleRedirect === undefined) delete process.env.GOOGLE_OAUTH_REDIRECT_URI
    else process.env.GOOGLE_OAUTH_REDIRECT_URI = previousGoogleRedirect
    vi.unstubAllEnvs()
  })

  it('authenticates provider, tenant, actor, expiry and provider payload', () => {
    const sealed = sealOAuthState({
      provider: 'google_ads',
      state: 'state-with-more-than-thirty-two-characters-123',
      workspaceId,
      userId: 'user-1',
      expiresAt: 2_000,
      payload: { managerCustomerId: '1234567890' },
    })
    expect(openOAuthState(sealed, 'google_ads', 1_000)).toEqual({
      provider: 'google_ads',
      state: 'state-with-more-than-thirty-two-characters-123',
      workspaceId,
      userId: 'user-1',
      expiresAt: 2_000,
      payload: { managerCustomerId: '1234567890' },
    })
  })

  it('rejects tampering, cross-provider replay and expired state', () => {
    const sealed = sealOAuthState({
      provider: 'slack',
      state: 'state-with-more-than-thirty-two-characters-123',
      workspaceId,
      userId: 'user-1',
      expiresAt: 2_000,
    })
    const [encoded, signature] = sealed.split('.')
    expect(() => openOAuthState(`${encoded}x.${signature}`, 'slack', 1_000)).toThrow('invalide')
    expect(() => openOAuthState(sealed, 'teams', 1_000)).toThrow('fournisseur')
    expect(() => openOAuthState(sealed, 'slack', 2_000)).toThrow('expiré')
  })

  it('rejects malformed envelopes and missing key configuration', () => {
    expect(() => openOAuthState('malformed', 'slack')).toThrow('invalide')
    delete process.env.OAUTH_STATE_KEY
    delete process.env.APP_ENCRYPTION_KEY
    expect(() => sealOAuthState({
      provider: 'slack', state: 'state-with-more-than-thirty-two-characters-123', workspaceId, userId: 'user-1',
    })).toThrow('OAUTH_STATE_KEY')
  })

  it('pins callback URLs to the configured application origin and provider path', () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://ads.example.test/base'
    expect(oauthCallbackUrl('slack', new URL('https://ads.example.test/api/connectors/slack/connect')))
      .toBe('https://ads.example.test/api/connectors/slack/callback')
    expect(() => oauthCallbackUrl('teams', new URL('https://tenant.example.test/api/connectors/teams/connect')))
      .toThrow('domaine principal')
    process.env.GOOGLE_OAUTH_REDIRECT_URI = 'https://ads.example.test/api/google-ads/callback'
    expect(oauthCallbackUrl('google_ads', new URL('https://ads.example.test/api/google-ads/connect')))
      .toBe('https://ads.example.test/api/google-ads/callback')
  })

  it('requires an explicit HTTPS callback in production and rejects malformed configured URLs', () => {
    vi.stubEnv('NODE_ENV', 'production')
    delete process.env.NEXT_PUBLIC_APP_URL
    expect(() => oauthCallbackUrl('slack', new URL('https://ads.example.test/connect'))).toThrow('pas configurée')
    process.env.NEXT_PUBLIC_APP_URL = 'http://ads.example.test'
    expect(() => oauthCallbackUrl('slack', new URL('http://ads.example.test/connect'))).toThrow('HTTPS')
    process.env.NEXT_PUBLIC_APP_URL = 'https://user:password@ads.example.test?unsafe=1'
    expect(() => oauthCallbackUrl('slack', new URL('https://ads.example.test/connect'))).toThrow('invalide')
  })
})
