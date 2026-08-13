import { afterEach, describe, expect, it } from 'vitest'
import { getServerEnv, hasGoogleConfiguration } from './env'

const keys = ['APP_ENCRYPTION_KEY', 'GOOGLE_ADS_DEVELOPER_TOKEN', 'GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET', 'GOOGLE_ADS_API_VERSION'] as const

describe('Google server environment', () => {
  afterEach(() => { for (const key of keys) delete process.env[key] })

  it('defaults to v25 only when all required secrets are valid', () => {
    Object.assign(process.env, {
      APP_ENCRYPTION_KEY: 'x'.repeat(43),
      GOOGLE_ADS_DEVELOPER_TOKEN: 'developer-token',
      GOOGLE_OAUTH_CLIENT_ID: 'client-id-valid',
      GOOGLE_OAUTH_CLIENT_SECRET: 'client-secret-valid',
    })
    expect(hasGoogleConfiguration()).toBe(true)
    expect(getServerEnv().GOOGLE_ADS_API_VERSION).toBe('v25')
  })

  it('fails closed on incomplete or invalid configuration', () => {
    expect(hasGoogleConfiguration()).toBe(false)
    expect(() => getServerEnv()).toThrow()
  })
})
