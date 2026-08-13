import 'server-only'

import { Pool as NeonPool, neonConfig } from '@neondatabase/serverless'
import { drizzle } from 'drizzle-orm/neon-serverless'
import { drizzle as drizzleNodePostgres } from 'drizzle-orm/node-postgres'
import { Pool as NodePostgresPool } from 'pg'
import ws from 'ws'
import * as schema from './schema'

neonConfig.webSocketConstructor = ws

const runtime = globalThis as typeof globalThis & {
  __yodevAuthDatabase?: ReturnType<typeof createAuthDatabase>
}

function poolMaximum() {
  const configured = Number(process.env.DATABASE_AUTH_POOL_MAX ?? '5')
  if (!Number.isInteger(configured) || configured < 1 || configured > 20) {
    throw new Error('DATABASE_AUTH_POOL_MAX must be an integer between 1 and 20')
  }
  return configured
}

function authConnectionString() {
  const value = process.env.DATABASE_AUTH_URL ??
    (process.env.NODE_ENV === 'production' ? undefined : process.env.DATABASE_SYSTEM_URL ?? process.env.DATABASE_URL)
  if (!value) throw new Error('DATABASE_AUTH_URL is not configured')
  return value
}

function createAuthDatabase() {
  const connectionString = authConnectionString()
  if (process.env.DATABASE_DRIVER === 'node-postgres') {
    const pool = new NodePostgresPool({ connectionString, max: poolMaximum(), allowExitOnIdle: true })
    return drizzleNodePostgres(pool, { schema })
  }
  if (process.env.DATABASE_DRIVER && process.env.DATABASE_DRIVER !== 'neon') {
    throw new Error('DATABASE_DRIVER must be neon or node-postgres')
  }
  const pool = new NeonPool({ connectionString, max: poolMaximum() })
  return drizzle(pool, { schema })
}

export function getAuthDatabase() {
  return runtime.__yodevAuthDatabase ??= createAuthDatabase()
}
