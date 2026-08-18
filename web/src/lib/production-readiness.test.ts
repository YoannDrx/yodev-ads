import { describe, expect, it } from 'vitest'
import { auditProductionConfiguration } from './production-readiness'

function validEnvironment(target: 'staging' | 'private_beta' | 'public'): NodeJS.ProcessEnv {
  const publicLaunch = target === 'public'
  return {
    NODE_ENV: 'production',
    NEXT_PUBLIC_APP_URL: 'https://ads.example.test',
    NEXT_PUBLIC_RELEASE_TARGET: target,
    DATABASE_AUTHENTICATED_URL: 'postgresql://app@db.example.test/ads',
    DATABASE_SYSTEM_URL: 'postgresql://system@db.example.test/ads',
    DATABASE_PURGE_URL: 'postgresql://purge@db.example.test/ads',
    DATABASE_AUTH_URL: 'postgresql://auth@db.example.test/ads',
    PRODUCTION_DATA_REGION: 'eu',
    BETTER_AUTH_SECRET: 'a'.repeat(32), BETTER_AUTH_GOOGLE_CLIENT_ID: 'auth-google-id', BETTER_AUTH_GOOGLE_CLIENT_SECRET: 'auth-google-secret',
    APP_ENCRYPTION_KEY: 'b'.repeat(43), OAUTH_STATE_KEY: 'c'.repeat(32), CRON_SECRET: 'd'.repeat(32), RELEASE_VERIFICATION_TOKEN: 'r'.repeat(32),
    YODEV_MAIL_API_URL: 'https://mail.example.test', YODEV_MAIL_API_KEY: 'ym_secret', YODEV_MAIL_WEBHOOK_SECRET: 'e'.repeat(32), YODEV_MAIL_RECIPIENT_HASH_SECRET: 'f'.repeat(32),
    SENTRY_DSN: 'https://public@sentry.example.test/1', NEXT_PUBLIC_SENTRY_DSN: 'https://public@sentry.example.test/2', SENTRY_AUTH_TOKEN: 'sentry-ci-token', SENTRY_EVENT_READ_AUTH_TOKEN: 'sentry-event-read-token', SENTRY_ORG: 'yodev', SENTRY_PROJECT: 'ads',
    GOOGLE_ADS_DEVELOPER_TOKEN: 'developer', GOOGLE_OAUTH_CLIENT_ID: 'client-id', GOOGLE_OAUTH_CLIENT_SECRET: 'client-secret',
    STRIPE_SECRET_KEY: target === 'staging' ? 'sk_test_secret' : 'sk_live_secret', STRIPE_WEBHOOK_SECRET: 'whsec_secret',
    STRIPE_PRICE_SOLO: 'price_solo', STRIPE_PRICE_STUDIO: 'price_studio', STRIPE_PRICE_AGENCY: 'price_agency', STRIPE_PORTAL_CONFIGURATION_ID: 'bpc_portal', STRIPE_TAX_MODE: 'exempt_293b',
    PUBLIC_API_ENABLED: '0', CUSTOM_DOMAINS_ENABLED: '0', BLOB_UPLOADS_ENABLED: '0', SLACK_CONNECTOR_ENABLED: '0', TEAMS_CONNECTOR_ENABLED: '0',
    GOOGLE_READS_ENABLED: '1', SCHEDULER_ENABLED: '1', NOTIFICATIONS_ENABLED: '1',
    MAINTENANCE_MODE: '0',
    PUBLIC_BETA_ENABLED: publicLaunch ? '1' : '0', STRIPE_CHECKOUT_ENABLED: target === 'staging' ? '0' : '1', LEGAL_DOCUMENTS_APPROVED: target === 'staging' ? '0' : '1',
    GOOGLE_MUTATIONS_ENABLED: '0', FORCE_READ_ONLY: '1',
  }
}

describe('production configuration audit', () => {
  it.each(['staging', 'private_beta', 'public'] as const)('accepts a complete %s configuration', (target) => {
    expect(auditProductionConfiguration(validEnvironment(target), target)).toEqual({ ready: true, issues: [] })
  })

  it('fails closed on mixed Stripe mode, shared DB roles, deprecated providers and unsafe flags', () => {
    const env = validEnvironment('public')
    env.STRIPE_SECRET_KEY = 'sk_test_wrong'
    env.DATABASE_SYSTEM_URL = env.DATABASE_AUTHENTICATED_URL
    env.POSTMARK_SERVER_TOKEN = 'forbidden'
    env.PUBLIC_API_ENABLED = '1'
    const result = auditProductionConfiguration(env, 'public')
    expect(result.ready).toBe(false)
    expect(result.issues.map(({ code }) => code)).toEqual(expect.arrayContaining([
      'stripe.wrong_mode', 'database.roles_not_separated', 'deprecated.POSTMARK_SERVER_TOKEN', 'flags.public_api',
    ]))
  })

  it.each([
    ['NEXT_PUBLIC_APP_URL'],
    ['NEXT_PUBLIC_RELEASE_TARGET'],
    ['DATABASE_AUTHENTICATED_URL'],
    ['BETTER_AUTH_GOOGLE_CLIENT_ID'],
    ['YODEV_MAIL_RECIPIENT_HASH_SECRET'],
    ['NEXT_PUBLIC_SENTRY_DSN'],
    ['SENTRY_AUTH_TOKEN'],
    ['SENTRY_EVENT_READ_AUTH_TOKEN'],
    ['STRIPE_PORTAL_CONFIGURATION_ID'],
  ])('reports a missing required value for %s', (name) => {
    const env = validEnvironment('staging')
    delete env[name]
    expect(auditProductionConfiguration(env, 'staging').issues).toContainEqual({
      code: `missing.${name}`,
      message: `${name} is required`,
    })
  })

  it.each([
    ['BETTER_AUTH_SECRET', 'weak.BETTER_AUTH_SECRET'],
    ['OAUTH_STATE_KEY', 'weak.OAUTH_STATE_KEY'],
    ['CRON_SECRET', 'weak.CRON_SECRET'],
    ['RELEASE_VERIFICATION_TOKEN', 'weak.RELEASE_VERIFICATION_TOKEN'],
    ['YODEV_MAIL_WEBHOOK_SECRET', 'weak.YODEV_MAIL_WEBHOOK_SECRET'],
    ['YODEV_MAIL_RECIPIENT_HASH_SECRET', 'weak.YODEV_MAIL_RECIPIENT_HASH_SECRET'],
  ])('rejects a weak %s', (name, code) => {
    const env = validEnvironment('staging')
    env[name] = 'short'
    expect(auditProductionConfiguration(env, 'staging').issues.map((issue) => issue.code)).toContain(code)
  })

  it.each([
    ['NEXT_PUBLIC_APP_URL', 'http://localhost:3000', 'unsafe_url.NEXT_PUBLIC_APP_URL'],
    ['YODEV_MAIL_API_URL', 'not a url', 'invalid_url.YODEV_MAIL_API_URL'],
  ])('rejects unsafe or invalid URL %s', (name, value, code) => {
    const env = validEnvironment('staging')
    env[name] = value
    expect(auditProductionConfiguration(env, 'staging').issues.map((issue) => issue.code)).toContain(code)
  })

  it('rejects duplicate Stripe prices, an invalid portal and maintenance mode', () => {
    const env = validEnvironment('staging')
    env.STRIPE_PRICE_STUDIO = env.STRIPE_PRICE_SOLO
    env.STRIPE_PORTAL_CONFIGURATION_ID = 'portal_wrong'
    env.MAINTENANCE_MODE = '1'
    expect(auditProductionConfiguration(env, 'staging').issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      'stripe.duplicate_prices', 'stripe.invalid_portal_configuration', 'flags.maintenance',
    ]))
  })

  it('rejects a public release target that does not match the audited target', () => {
    const env = validEnvironment('staging')
    env.NEXT_PUBLIC_RELEASE_TARGET = 'public'
    expect(auditProductionConfiguration(env, 'staging').issues.map((issue) => issue.code)).toContain('release.target_mismatch')
  })

  it('rejects an invalid or unvalidated Stripe tax configuration', () => {
    const invalid = validEnvironment('staging')
    invalid.STRIPE_TAX_MODE = 'unknown'
    expect(auditProductionConfiguration(invalid, 'staging').issues.map((issue) => issue.code)).toContain('stripe.invalid_tax_mode')

    const unvalidated = validEnvironment('staging')
    unvalidated.STRIPE_TAX_MODE = 'stripe_tax'
    unvalidated.STRIPE_TAX_CONFIGURATION_VALIDATED = '0'
    expect(auditProductionConfiguration(unvalidated, 'staging').issues.map((issue) => issue.code)).toContain('stripe.tax_not_validated')
  })

  it('requires Checkout and approved documents before the private beta', () => {
    const env = validEnvironment('private_beta')
    env.STRIPE_CHECKOUT_ENABLED = '0'
    env.LEGAL_DOCUMENTS_APPROVED = '0'
    expect(auditProductionConfiguration(env, 'private_beta').issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      'flags.checkout_closed', 'legal.not_approved',
    ]))
  })

  it.each([
    ['GOOGLE_READS_ENABLED', '0', 'flags.google_reads'],
    ['SCHEDULER_ENABLED', '0', 'flags.scheduler'],
    ['NOTIFICATIONS_ENABLED', '0', 'flags.notifications'],
    ['PUBLIC_BETA_ENABLED', '1', 'flags.public_beta'],
    ['CUSTOM_DOMAINS_ENABLED', '1', 'flags.custom_domains'],
    ['BLOB_UPLOADS_ENABLED', '1', 'flags.blob_uploads'],
    ['SLACK_CONNECTOR_ENABLED', '1', 'flags.slack_connector'],
    ['TEAMS_CONNECTOR_ENABLED', '1', 'flags.teams_connector'],
  ])('rejects staging flag %s=%s', (name, value, code) => {
    const env = validEnvironment('staging')
    env[name] = value
    expect(auditProductionConfiguration(env, 'staging').issues.map((issue) => issue.code)).toContain(code)
  })

  it('enforces coherent Google mutation switches in both directions', () => {
    const enabledReadOnly = validEnvironment('staging')
    enabledReadOnly.GOOGLE_MUTATIONS_ENABLED = '1'
    expect(auditProductionConfiguration(enabledReadOnly, 'staging').issues.map((issue) => issue.code)).toContain('flags.mutations_read_only')

    const disabledWritable = validEnvironment('staging')
    disabledWritable.FORCE_READ_ONLY = '0'
    expect(auditProductionConfiguration(disabledWritable, 'staging').issues.map((issue) => issue.code)).toContain('flags.read_only_not_explicit')
  })

  it('allows legacy Clerk secrets only during an explicit rollback window', () => {
    const env = validEnvironment('staging')
    env.CLERK_SECRET_KEY = 'legacy-secret'
    expect(auditProductionConfiguration(env, 'staging').issues.map((issue) => issue.code)).toContain('deprecated.CLERK_SECRET_KEY')
    env.LEGACY_AUTH_ROLLBACK_ENABLED = '1'
    expect(auditProductionConfiguration(env, 'staging')).toEqual({ ready: true, issues: [] })
  })
})
