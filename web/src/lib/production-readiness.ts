export type ReleaseTarget = 'staging' | 'private_beta' | 'public'

export type ReadinessIssue = {
  code: string
  message: string
}

function configured(env: NodeJS.ProcessEnv, name: string, minimumLength = 1) {
  return Boolean(env[name]?.trim() && env[name]!.trim().length >= minimumLength)
}

function addMissing(issues: ReadinessIssue[], env: NodeJS.ProcessEnv, names: string[]) {
  for (const name of names) {
    if (!configured(env, name)) issues.push({ code: `missing.${name}`, message: `${name} is required` })
  }
}

function databaseUser(value: string | undefined) {
  try {
    return value ? new URL(value).username : ''
  } catch {
    return ''
  }
}

export function auditProductionConfiguration(
  env: NodeJS.ProcessEnv,
  target: ReleaseTarget,
): { ready: boolean; issues: ReadinessIssue[] } {
  const issues: ReadinessIssue[] = []
  addMissing(issues, env, [
    'NEXT_PUBLIC_APP_URL',
    'DATABASE_AUTHENTICATED_URL',
    'DATABASE_SYSTEM_URL',
    'DATABASE_PURGE_URL',
    'DATABASE_AUTH_URL',
    'BETTER_AUTH_SECRET',
    'BETTER_AUTH_GOOGLE_CLIENT_ID',
    'BETTER_AUTH_GOOGLE_CLIENT_SECRET',
    'APP_ENCRYPTION_KEY',
    'OAUTH_STATE_KEY',
    'CRON_SECRET',
    'YODEV_MAIL_API_URL',
    'YODEV_MAIL_API_KEY',
    'YODEV_MAIL_WEBHOOK_SECRET',
    'YODEV_MAIL_RECIPIENT_HASH_SECRET',
    'SENTRY_DSN',
    'NEXT_PUBLIC_SENTRY_DSN',
    'GOOGLE_ADS_DEVELOPER_TOKEN',
    'GOOGLE_OAUTH_CLIENT_ID',
    'GOOGLE_OAUTH_CLIENT_SECRET',
    'STRIPE_SECRET_KEY',
    'STRIPE_WEBHOOK_SECRET',
    'STRIPE_PRICE_SOLO',
    'STRIPE_PRICE_STUDIO',
    'STRIPE_PRICE_AGENCY',
    'STRIPE_PORTAL_CONFIGURATION_ID',
  ])

  for (const [name, minimum] of [['BETTER_AUTH_SECRET', 32], ['OAUTH_STATE_KEY', 32], ['CRON_SECRET', 32], ['YODEV_MAIL_WEBHOOK_SECRET', 32], ['YODEV_MAIL_RECIPIENT_HASH_SECRET', 32]] as const) {
    if (configured(env, name) && !configured(env, name, minimum)) {
      issues.push({ code: `weak.${name}`, message: `${name} must contain at least ${minimum} characters` })
    }
  }

  for (const name of ['NEXT_PUBLIC_APP_URL', 'YODEV_MAIL_API_URL'] as const) {
    try {
      const url = new URL(env[name] ?? '')
      if (url.protocol !== 'https:' || ['localhost', '127.0.0.1'].includes(url.hostname)) {
        issues.push({ code: `unsafe_url.${name}`, message: `${name} must be a non-local HTTPS URL` })
      }
    } catch {
      if (configured(env, name)) issues.push({ code: `invalid_url.${name}`, message: `${name} must be a valid URL` })
    }
  }

  const databaseUsers = [
    env.DATABASE_AUTHENTICATED_URL,
    env.DATABASE_SYSTEM_URL,
    env.DATABASE_PURGE_URL,
    env.DATABASE_AUTH_URL,
  ].map(databaseUser).filter(Boolean)
  if (databaseUsers.length > 0 && new Set(databaseUsers).size !== databaseUsers.length) {
    issues.push({ code: 'database.roles_not_separated', message: 'Database runtime URLs must use distinct role names' })
  }
  if (env.PRODUCTION_DATA_REGION !== 'eu') {
    issues.push({ code: 'database.region_unconfirmed', message: 'PRODUCTION_DATA_REGION must explicitly be eu' })
  }

  const stripeKey = env.STRIPE_SECRET_KEY ?? ''
  const expectedStripePrefix = target === 'staging' ? 'sk_test_' : 'sk_live_'
  if (configured(env, 'STRIPE_SECRET_KEY') && !stripeKey.startsWith(expectedStripePrefix)) {
    issues.push({ code: 'stripe.wrong_mode', message: `Stripe secret key does not match the ${target} release target` })
  }
  const prices = [env.STRIPE_PRICE_SOLO, env.STRIPE_PRICE_STUDIO, env.STRIPE_PRICE_AGENCY].filter(Boolean)
  if (prices.length === 3 && new Set(prices).size !== 3) {
    issues.push({ code: 'stripe.duplicate_prices', message: 'The three plans must use distinct Stripe Price IDs' })
  }
  if (configured(env, 'STRIPE_PORTAL_CONFIGURATION_ID') && !env.STRIPE_PORTAL_CONFIGURATION_ID!.startsWith('bpc_')) {
    issues.push({ code: 'stripe.invalid_portal_configuration', message: 'Stripe portal configuration must start with bpc_' })
  }

  if (env.PUBLIC_API_ENABLED !== '0') {
    issues.push({ code: 'flags.public_api', message: 'PUBLIC_API_ENABLED must remain 0 for the initial commercial release' })
  }
  if (env.SCHEDULER_ENABLED !== '1') issues.push({ code: 'flags.scheduler', message: 'SCHEDULER_ENABLED must be 1' })
  if (env.NOTIFICATIONS_ENABLED !== '1') issues.push({ code: 'flags.notifications', message: 'NOTIFICATIONS_ENABLED must be 1' })
  if (target !== 'public' && env.PUBLIC_BETA_ENABLED !== '0') {
    issues.push({ code: 'flags.public_beta', message: 'PUBLIC_BETA_ENABLED must remain 0 before public launch' })
  }
  if (env.MAINTENANCE_MODE !== '0') {
    issues.push({ code: 'flags.maintenance', message: 'MAINTENANCE_MODE must be 0 before release promotion' })
  }
  if (target === 'public') {
    if (env.PUBLIC_BETA_ENABLED !== '1') issues.push({ code: 'flags.public_beta_closed', message: 'PUBLIC_BETA_ENABLED must be 1 for public launch' })
    if (env.STRIPE_CHECKOUT_ENABLED !== '1') issues.push({ code: 'flags.checkout_closed', message: 'STRIPE_CHECKOUT_ENABLED must be 1 for public launch' })
    if (env.LEGAL_DOCUMENTS_APPROVED !== '1') issues.push({ code: 'legal.not_approved', message: 'LEGAL_DOCUMENTS_APPROVED must be 1' })
  }

  if (env.GOOGLE_MUTATIONS_ENABLED === '1' && env.FORCE_READ_ONLY !== '0') {
    issues.push({ code: 'flags.mutations_read_only', message: 'Enabled Google mutations require FORCE_READ_ONLY=0' })
  }
  if (env.GOOGLE_MUTATIONS_ENABLED !== '1' && env.FORCE_READ_ONLY !== '1') {
    issues.push({ code: 'flags.read_only_not_explicit', message: 'FORCE_READ_ONLY must be 1 while Google mutations are globally disabled' })
  }

  for (const deprecated of ['POSTMARK_SERVER_TOKEN', 'POSTMARK_MESSAGE_STREAM', 'RESEND_API_KEY', 'OPERATIONS_EMAIL_PROVIDER']) {
    if (configured(env, deprecated)) issues.push({ code: `deprecated.${deprecated}`, message: `${deprecated} must not be configured in YoDevAds` })
  }

  if (env.LEGACY_AUTH_ROLLBACK_ENABLED !== '1') {
    for (const deprecated of [
      'CLERK_SECRET_KEY',
      'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY',
      'NEXT_PUBLIC_CLERK_SIGN_IN_URL',
      'NEXT_PUBLIC_CLERK_SIGN_UP_URL',
      'NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL',
      'NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL',
    ]) {
      if (configured(env, deprecated)) {
        issues.push({ code: `deprecated.${deprecated}`, message: `${deprecated} must be removed after the Better Auth rollback window` })
      }
    }
  }

  return { ready: issues.length === 0, issues }
}
