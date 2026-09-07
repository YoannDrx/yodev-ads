import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { mkdtemp, chmod, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { request } from '@playwright/test'
import { pipeRedactedBrowserLog } from './lib/browser-log-redaction.mjs'

const database = new URL(process.env.YODEV_TEST_DATABASE_URL ?? 'postgresql://postgres@127.0.0.1:55438/yodev_test')
assert(['localhost', '127.0.0.1', '[::1]'].includes(database.hostname) && database.pathname.startsWith('/yodev_test'), 'Disposable local database required')
const baseURL = 'http://localhost:3017'
const env = { ...process.env, NODE_OPTIONS: '', NODE_ENV: 'development', DATABASE_DRIVER: 'node-postgres', DOTENV_CONFIG_PATH: '/dev/null',
  NEXT_PUBLIC_APP_URL: baseURL, NEXT_PUBLIC_RELEASE_TARGET: 'staging', RELEASE_TARGET: 'staging',
  BETTER_AUTH_SECRET: 'local-browser-fixture-secret-at-least-32-characters', BETTER_AUTH_EMAIL_PASSWORD_ENABLED: '1',
  BETTER_AUTH_ALLOWED_EMAILS: 'auth-flow-fr@local-browser.example.test,auth-flow-en@local-browser.example.test', AUTH_BOOTSTRAP_EMAIL: '',
  BETTER_AUTH_GOOGLE_CLIENT_ID: '', BETTER_AUTH_GOOGLE_CLIENT_SECRET: '', BETTER_AUTH_TRUSTED_ORIGINS: baseURL,
  APP_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64url'), RATE_LIMIT_HASH_KEY: 'local-browser-fixture-rate-limit-only',
  APP_ENCRYPTION_KEYS: '', APP_ENCRYPTION_CURRENT_KID: '',
  SENTRY_DSN: '', NEXT_PUBLIC_SENTRY_DSN: '', SENTRY_AUTH_TOKEN: '',
  STRIPE_SECRET_KEY: '', YODEV_MAIL_API_KEY: '', GOOGLE_ADS_DEVELOPER_TOKEN: '',
  GOOGLE_OAUTH_CLIENT_ID: '', GOOGLE_OAUTH_CLIENT_SECRET: '',
  MAINTENANCE_MODE: '0', FORCE_READ_ONLY: '1',
}
for (const name of ['GOOGLE_READS', 'GOOGLE_MUTATIONS', 'SCHEDULER', 'NOTIFICATIONS', 'PUBLIC_API', 'PUBLIC_BETA', 'STRIPE_CHECKOUT', 'CUSTOM_DOMAINS', 'BLOB_UPLOADS', 'SLACK_CONNECTOR', 'TEAMS_CONNECTOR']) env[`${name}_ENABLED`] = '0'
// Exercise enqueue controls only. Credentials remain blank; no worker is run.
if (process.env.YODEV_TEST_ANALYTICS_CONTROLS === '1') {
  env.GOOGLE_READS_ENABLED = '1'
  env.SCHEDULER_ENABLED = '1'
  env.PLAYWRIGHT_ANALYTICS_CONTROLS = '1'
}
// Enables local persistence/revelation controls only; provider credentials stay blank and workers stay off.
if (process.env.YODEV_TEST_SECURITY_CONTROLS === '1') {
  env.PUBLIC_API_ENABLED = '1'
  env.NOTIFICATIONS_ENABLED = '1'
  env.PRIVATE_API_WORKSPACE_IDS = '80000000-0000-4000-8000-000000000001'
  env.PLAYWRIGHT_SECURITY_CONTROLS = '1'
}
for (const name of ['DATABASE_URL', 'DATABASE_URL_UNPOOLED', 'DATABASE_AUTHENTICATED_URL', 'DATABASE_SYSTEM_URL', 'DATABASE_PURGE_URL', 'DATABASE_AUTH_URL']) env[name] = database.href
const seed = spawnSync('npx', ['--no-install', 'tsx', 'scripts/seed-local-browser-fixtures.ts'], { env: { ...env, NODE_OPTIONS: '--conditions=react-server' }, stdio: 'inherit' })
if (seed.status !== 0) process.exit(seed.status ?? 1)
const server = spawn('npm', ['run', 'dev', '--', '--hostname', '127.0.0.1', '--port', '3017'], { env, stdio: ['ignore', 'pipe', 'pipe'], detached: true })
pipeRedactedBrowserLog(server.stdout, process.stdout)
pipeRedactedBrowserLog(server.stderr, process.stderr)
const stateDirectory = await mkdtemp(path.join(tmpdir(), 'yodev-ads-browser-'))
await chmod(stateDirectory, 0o700)
try {
  const start = Date.now()
  while (true) {
    try { if ((await fetch(`${baseURL}/sign-in`, { signal: AbortSignal.timeout(5_000) })).ok) break } catch {}
    if (Date.now() - start > 180_000) throw new Error('Local browser server did not become ready')
    await new Promise((resolve) => setTimeout(resolve, 1_000))
  }
  for (const role of ['owner', 'admin', 'strategist', 'analyst', 'client']) {
    const context = await request.newContext({ baseURL, timeout: 120_000, extraHTTPHeaders: { Origin: baseURL } })
    try {
      const response = await context.post('/api/auth/sign-in/email', { data: { email: `${role}@local-browser.example.test`, password: 'Local-browser-fixture-only-2026!' } })
      assert.equal(response.status(), 200, `Fixture login failed for ${role}`)
      const filename = path.join(stateDirectory, `${role}.json`)
      await writeFile(filename, JSON.stringify(await context.storageState()), { mode: 0o600 })
      env[`PLAYWRIGHT_${role.toUpperCase()}_STORAGE_STATE`] = filename
    } finally { await context.dispose() }
  }
  // Compile authenticated routes before timed browser assertions. This keeps
  // cold development compilation separate from product navigation checks.
  const warmup = await request.newContext({ baseURL, storageState: env.PLAYWRIGHT_OWNER_STORAGE_STATE })
  try {
    for (const route of ['/dashboard', '/settings', '/billing', '/support', '/accounts', '/history', '/alerts', '/tasks', '/approvals', '/reports', '/audit', '/agents', '/', '/privacy', '/terms', '/subprocessors', '/status', '/sign-in', '/sign-up']) {
      const response = await warmup.get(route, { timeout: 180_000 })
      assert.equal(response.status(), 200, `Fixture route warmup failed: ${route}`)
    }
  } finally { await warmup.dispose() }
  env.PLAYWRIGHT_BASE_URL = baseURL
  env.PLAYWRIGHT_REQUIRE_AUTH_MATRIX = '1'
  env.PLAYWRIGHT_LOCAL_FIXTURE = '1'
  env.PLAYWRIGHT_FOREIGN_EXPORT_ID = '80000000-0000-4000-8000-000000000003'
  await writeFile(path.join(stateDirectory, 'environment.json'), JSON.stringify(Object.fromEntries(Object.entries(env).filter(([key]) => key.startsWith('PLAYWRIGHT_')))), { mode: 0o600 })
  console.log(`Local browser states ready in ${stateDirectory}`)
  const result = await new Promise((resolve) => {
    const tests = spawn('npx', ['--no-install', 'playwright', 'test', ...process.argv.slice(2), '--workers=1', '--reporter=list'], { env, stdio: ['ignore', 'pipe', 'pipe'] })
    pipeRedactedBrowserLog(tests.stdout, process.stdout)
    pipeRedactedBrowserLog(tests.stderr, process.stderr)
    tests.on('close', (code) => resolve(code ?? 1))
  })
  process.exitCode = result
} finally {
  if (server.pid) { try { process.kill(-server.pid, 'SIGTERM') } catch {} }
  await rm(stateDirectory, { recursive: true, force: true })
  const cleanup = spawnSync('npx', ['--no-install', 'tsx', 'scripts/seed-local-browser-fixtures.ts', '--cleanup'], { env: { ...env, NODE_OPTIONS: '--conditions=react-server' }, stdio: 'inherit' })
  if (cleanup.status !== 0) process.exitCode = cleanup.status ?? 1
}
