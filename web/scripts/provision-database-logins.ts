import { randomBytes } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import { Pool, type PoolClient } from 'pg'

const loginRoles = [
  { login: 'yodev_ads_app_login', group: 'yodev_app', inherit: false, env: 'DATABASE_AUTHENTICATED_URL' },
  { login: 'yodev_ads_system_login', group: 'yodev_system', inherit: false, env: 'DATABASE_SYSTEM_URL' },
  { login: 'yodev_ads_purge_login', group: 'yodev_purge', inherit: false, env: 'DATABASE_PURGE_URL' },
  { login: 'yodev_ads_auth_login', group: 'yodev_auth', inherit: true, env: 'DATABASE_AUTH_URL' },
] as const

async function formattedStatement(client: PoolClient, format: string, values: string[]) {
  const result = await client.query<{ statement: string }>('select format($1, variadic $2::text[]) as statement', [format, values])
  const statement = result.rows[0]?.statement
  if (!statement) throw new Error('Unable to format database role statement')
  return statement
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) throw new Error('DATABASE_URL is not configured')
  const parsed = new URL(databaseUrl)
  if (process.env.YODEV_DB_LOGIN_CONFIRM_HOST !== parsed.hostname) {
    throw new Error('YODEV_DB_LOGIN_CONFIRM_HOST must exactly match the target database host')
  }
  const outputPath = process.env.YODEV_DB_LOGIN_OUTPUT
  if (!outputPath || !isAbsolute(outputPath)) {
    throw new Error('YODEV_DB_LOGIN_OUTPUT must be an absolute protected path')
  }
  const apply = process.env.YODEV_DB_LOGIN_APPLY === '1'
  const rotate = process.env.YODEV_DB_LOGIN_ROTATE === '1'
  if (!apply) {
    process.stdout.write(`Dry run: ${loginRoles.map((role) => `${role.login}->${role.group}`).join(', ')}\n`)
    return
  }

  const pool = new Pool({ connectionString: databaseUrl, max: 1, allowExitOnIdle: true })
  const client = await pool.connect()
  try {
    const env: Record<string, string> = {}
    await client.query('begin')
    for (const role of loginRoles) {
      const exists = await client.query<{ exists: boolean }>('select exists(select 1 from pg_roles where rolname = $1)', [role.login])
      if (exists.rows[0]?.exists && !rotate) {
        throw new Error(`Database login ${role.login} already exists; set YODEV_DB_LOGIN_ROTATE=1 for an intentional rotation`)
      }
      const password = randomBytes(36).toString('base64url')
      if (exists.rows[0]?.exists) {
        await client.query(await formattedStatement(client, 'alter role %I password %L', [role.login, password]))
      } else {
        await client.query(await formattedStatement(
          client,
          `create role %I login password %L ${role.inherit ? 'inherit' : 'noinherit'} nocreatedb nocreaterole noreplication nobypassrls`,
          [role.login, password],
        ))
        await client.query(await formattedStatement(client, 'grant %I to %I', [role.group, role.login]))
      }
      const url = new URL(databaseUrl)
      url.username = role.login
      url.password = password
      url.searchParams.set('sslmode', 'verify-full')
      env[role.env] = url.toString()
    }
    await client.query('commit')
    await writeFile(outputPath, `${JSON.stringify({ env }, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    })
    process.stdout.write(`Provisioned ${loginRoles.length} restricted database logins; credentials were written once to the protected output file.\n`)
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    client.release()
    await pool.end()
  }
}

main().catch((error) => {
  process.stderr.write(`Database login provisioning failed: ${error instanceof Error ? error.message : 'unknown error'}\n`)
  process.exitCode = 1
})
