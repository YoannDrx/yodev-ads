import { spawnSync } from 'node:child_process'

// This runner intentionally accepts only a disposable database on loopback.
const url = new URL(process.env.YODEV_TEST_DATABASE_URL ?? 'postgresql://postgres@127.0.0.1:55438/yodev_test')
if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || !url.pathname.startsWith('/yodev_test')) {
  throw new Error('Only a local disposable yodev_test database may be verified by this runner')
}
const env = {
  ...process.env, DATABASE_DRIVER: 'node-postgres', NODE_OPTIONS: '--conditions=react-server',
  DOTENV_CONFIG_PATH: '/dev/null',
  GOOGLE_READS_ENABLED: '0', GOOGLE_MUTATIONS_ENABLED: '0', NOTIFICATIONS_ENABLED: '0',
  APP_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64url'),
}
for (const key of ['DATABASE_URL', 'DATABASE_URL_UNPOOLED', 'DATABASE_AUTHENTICATED_URL', 'DATABASE_SYSTEM_URL', 'DATABASE_PURGE_URL', 'DATABASE_AUTH_URL']) env[key] = url.href
const commands = [
  ['drizzle-kit', 'migrate'],
  ...['seed-rls-verification', 'verify-rls', 'validate-tenant-constraints', 'verify-tenant-invariants', 'verify-database-concurrency', 'verify-prod-ready-concurrency'].map((script) => ['tsx', `scripts/${script}.ts`]),
]
for (const args of commands) {
  console.log(`Running ${args.join(' ')}`)
  const result = spawnSync('npx', ['--no-install', ...args], { env, stdio: 'inherit' })
  if (result.status !== 0) process.exit(result.status ?? 1)
}
