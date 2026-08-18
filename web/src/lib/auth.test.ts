import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ execute: vi.fn() }))

vi.mock('@/db/auth-database', () => ({ getAuthDatabase: () => ({ execute: mocks.execute }) }))
vi.mock('@/lib/auth-emails', () => ({ sendAuthEmail: vi.fn() }))

const managedEnvironment = [
  'BETTER_AUTH_SECRET', 'NEXT_PUBLIC_APP_URL', 'BETTER_AUTH_TRUSTED_ORIGINS',
  'BETTER_AUTH_ALLOWED_EMAILS', 'AUTH_BOOTSTRAP_EMAIL', 'PUBLIC_BETA_ENABLED',
  'BETTER_AUTH_EMAIL_PASSWORD_ENABLED', 'BETTER_AUTH_GOOGLE_CLIENT_ID', 'BETTER_AUTH_GOOGLE_CLIENT_SECRET',
] as const

describe('Better Auth server configuration', () => {
  afterEach(() => {
    for (const key of managedEnvironment) delete process.env[key]
    mocks.execute.mockReset()
    vi.resetModules()
  })

  it('resolves membership limits for invited users before membership creation', async () => {
    mocks.execute.mockResolvedValue({ rows: [{ limit: 10_000 }] })
    const { workspaceMemberLimit } = await import('./auth')
    await expect(workspaceMemberLimit({ id: 'invited-user' }, { id: 'organization-1' })).resolves.toBe(10_000)
    expect(mocks.execute).toHaveBeenCalledOnce()

    mocks.execute.mockResolvedValueOnce({ rows: [] })
    await expect(workspaceMemberLimit({ id: 'unrelated-user' }, { id: 'organization-1' })).resolves.toBe(1)
  })

  it('fails closed when the authentication secret is absent or too short', async () => {
    process.env.BETTER_AUTH_SECRET = 'short'
    const { getAuth } = await import('./auth')
    expect(() => getAuth()).toThrow('at least 32 characters')
  }, 10_000)

  it('builds the local email/password and passkey server with secure defaults', async () => {
    process.env.BETTER_AUTH_SECRET = 'test-secret-at-least-32-characters-long'
    process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000/'
    process.env.BETTER_AUTH_TRUSTED_ORIGINS = ' https://preview.example.test,https://preview.example.test '
    process.env.BETTER_AUTH_ALLOWED_EMAILS = 'owner@example.test'
    process.env.AUTH_BOOTSTRAP_EMAIL = 'bootstrap@example.test'
    const { getAuth } = await import('./auth')
    const auth = getAuth()
    expect(auth).toBe(getAuth())
    expect(auth.api.getSession).toBeTypeOf('function')
    expect(auth.api.signInEmail).toBeTypeOf('function')
  })

  it('accepts an HTTPS Google OAuth configuration with password auth disabled', async () => {
    process.env.BETTER_AUTH_SECRET = 'test-secret-at-least-32-characters-long'
    process.env.NEXT_PUBLIC_APP_URL = 'https://ads.example.test'
    process.env.BETTER_AUTH_EMAIL_PASSWORD_ENABLED = '0'
    process.env.BETTER_AUTH_GOOGLE_CLIENT_ID = 'google-client'
    process.env.BETTER_AUTH_GOOGLE_CLIENT_SECRET = 'google-secret'
    process.env.PUBLIC_BETA_ENABLED = '1'
    const { getAuth } = await import('./auth')
    const auth = getAuth()
    expect(auth.api.signInSocial).toBeTypeOf('function')
    expect(auth.api.acceptInvitation).toBeTypeOf('function')
  })
})
