import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getServerEnv, hasGoogleConfiguration } from './env'

describe('Google Cloud project API configuration', () => {
  beforeEach(() => {
    vi.stubEnv('APP_ENCRYPTION_KEY', 'x'.repeat(43))
    vi.stubEnv('GOOGLE_OAUTH_CLIENT_ID', 'oauth-client-id')
    vi.stubEnv('GOOGLE_OAUTH_CLIENT_SECRET', 'oauth-client-secret')
    vi.stubEnv('GOOGLE_ADS_DEVELOPER_TOKEN', undefined)
    vi.stubEnv('GOOGLE_ADS_API_VERSION', undefined)
  })
  afterEach(() => vi.unstubAllEnvs())

  it('allows OAuth configuration without a developer token', () => {
    expect(hasGoogleConfiguration()).toBe(true)
    expect(getServerEnv().GOOGLE_ADS_API_VERSION).toBe('v25')
    expect(getServerEnv()).not.toHaveProperty('GOOGLE_ADS_DEVELOPER_TOKEN')
  })

  it('ignores obsolete deployment tokens', () => {
    vi.stubEnv('GOOGLE_ADS_DEVELOPER_TOKEN', 'legacy-unused-token')
    expect(hasGoogleConfiguration()).toBe(true)
    expect(getServerEnv().GOOGLE_ADS_API_VERSION).toBe('v25')
    expect(getServerEnv()).not.toHaveProperty('GOOGLE_ADS_DEVELOPER_TOKEN')
  })

  it('rejects an invalid encryption key', () => {
    vi.stubEnv('APP_ENCRYPTION_KEY', 'short')
    expect(hasGoogleConfiguration()).toBe(false)
    expect(() => getServerEnv()).toThrow()
  })

  it('still requires OAuth credentials', () => {
    vi.stubEnv('GOOGLE_OAUTH_CLIENT_SECRET', undefined)
    expect(hasGoogleConfiguration()).toBe(false)
    expect(() => getServerEnv()).toThrow()
  })
})
