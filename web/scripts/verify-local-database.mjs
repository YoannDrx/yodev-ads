import { spawnSync } from 'node:child_process'
import pg from 'pg'

// This runner intentionally accepts only a disposable database on loopback.
const url = new URL(process.env.YODEV_TEST_DATABASE_URL ?? 'postgresql://postgres@127.0.0.1:55438/yodev_test')
if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || !url.pathname.startsWith('/yodev_test')) {
  throw new Error('Only a local disposable yodev_test database may be verified by this runner')
}
// In particular, Docker may still expose the port while its engine is stalled.
// Fail before starting migrations instead of leaving drizzle-kit waiting forever.
const preflight = new pg.Client({ connectionString: url.href, connectionTimeoutMillis: 10_000, query_timeout: 10_000 })
try {
  await preflight.connect()
  await preflight.query('select 1')
} catch {
  console.error('The disposable PostgreSQL instance is unavailable; start it or supply a reachable local YODEV_TEST_DATABASE_URL')
  process.exitCode = 1
} finally {
  await preflight.end().catch(() => {})
}
if (process.exitCode) process.exit(process.exitCode)
const env = {
  ...process.env, DATABASE_DRIVER: 'node-postgres', NODE_OPTIONS: '--conditions=react-server',
  DOTENV_CONFIG_PATH: '/dev/null',
  GOOGLE_READS_ENABLED: '0', GOOGLE_MUTATIONS_ENABLED: '0', NOTIFICATIONS_ENABLED: '0',
  APP_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64url'),
}
for (const key of ['DATABASE_URL', 'DATABASE_URL_UNPOOLED', 'DATABASE_AUTHENTICATED_URL', 'DATABASE_SYSTEM_URL', 'DATABASE_PURGE_URL', 'DATABASE_AUTH_URL']) env[key] = url.href
const commands = [
  ['drizzle-kit', 'migrate'],
  ...['seed-rls-verification', 'verify-rls', 'validate-tenant-constraints', 'verify-tenant-invariants', 'verify-database-concurrency', 'verify-prod-ready-concurrency', 'verify-monitoring-checkpoints', 'verify-metric-history', 'verify-analytical-collections', 'verify-analytical-pages', 'verify-account-selection', 'verify-report-editions', 'verify-workspace-collections', 'verify-public-status', 'verify-portfolio', 'verify-portfolio-views', 'verify-activation-evidence', 'verify-membership-boundary', 'verify-membership-admission', 'verify-alert-quality', 'verify-operating-costs', 'verify-monitoring-actors', 'verify-task-actors', 'verify-settings-actors', 'verify-security-actors', 'verify-member-mutations'].map((script) => ['tsx', `scripts/${script}.ts`]),
]
for (const args of commands) {
  console.log(`Running ${args.join(' ')}`)
  const result = spawnSync('npx', ['--no-install', ...args], { env, stdio: 'inherit' })
  if (result.status !== 0) process.exit(result.status ?? 1)
}
