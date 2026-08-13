import 'server-only'

import { Pool as NeonPool, neonConfig } from '@neondatabase/serverless'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/neon-serverless'
import type { NeonDatabase, NeonTransaction } from 'drizzle-orm/neon-serverless'
import { drizzle as drizzleNodePostgres } from 'drizzle-orm/node-postgres'
import type { NodePgDatabase, NodePgTransaction } from 'drizzle-orm/node-postgres'
import type { ExtractTablesWithRelations } from 'drizzle-orm/relations'
import { Pool as NodePostgresPool } from 'pg'
import ws from 'ws'
import * as schema from './schema'

neonConfig.webSocketConstructor = ws

function databaseForUrl(connectionString: string): {
  pool: NeonPool
  db: NeonDatabase<typeof schema>
} {
  const pool = new NeonPool({ connectionString, max: databasePoolMaximum() })
  return { pool, db: drizzle(pool, { schema }) }
}

function nodeDatabaseForUrl(connectionString: string): {
  pool: NodePostgresPool
  db: NodePgDatabase<typeof schema>
} {
  const pool = new NodePostgresPool({
    connectionString,
    max: databasePoolMaximum(),
    allowExitOnIdle: true,
  })
  return { pool, db: drizzleNodePostgres(pool, { schema }) }
}

function databasePoolMaximum() {
  const configured = Number(process.env.DATABASE_POOL_MAX ?? '10')
  if (!Number.isInteger(configured) || configured < 1 || configured > 50) {
    throw new Error('DATABASE_POOL_MAX must be an integer between 1 and 50')
  }
  return configured
}

type CachedNeonDatabase = ReturnType<typeof databaseForUrl>
type CachedNodeDatabase = ReturnType<typeof nodeDatabaseForUrl>
const runtime = globalThis as typeof globalThis & {
  __yodevNeonDatabases?: Map<string, CachedNeonDatabase>
  __yodevNodeDatabases?: Map<string, CachedNodeDatabase>
}
const neonDatabases = runtime.__yodevNeonDatabases ??= new Map()
const nodeDatabases = runtime.__yodevNodeDatabases ??= new Map()

function cachedNeonDatabase(connectionString: string) {
  const key = `${connectionString}:${databasePoolMaximum()}`
  const existing = neonDatabases.get(key)
  if (existing) return existing
  const created = databaseForUrl(connectionString)
  neonDatabases.set(key, created)
  return created
}

function cachedNodeDatabase(connectionString: string) {
  const key = `${connectionString}:${databasePoolMaximum()}`
  const existing = nodeDatabases.get(key)
  if (existing) return existing
  const created = nodeDatabaseForUrl(connectionString)
  nodeDatabases.set(key, created)
  return created
}

export type DatabaseTransaction = NeonTransaction<
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>

async function withDatabaseTransaction<T>(
  environmentVariable: 'DATABASE_AUTHENTICATED_URL' | 'DATABASE_SYSTEM_URL' | 'DATABASE_PURGE_URL',
  databaseRole: 'yodev_app' | 'yodev_system' | 'yodev_purge',
  operation: (transaction: DatabaseTransaction) => Promise<T>,
): Promise<T> {
  const connectionString = process.env[environmentVariable] ??
    (process.env.NODE_ENV === 'production' ? undefined : process.env.DATABASE_URL)
  if (!connectionString) throw new Error(`${environmentVariable} is not configured`)

  if (process.env.DATABASE_DRIVER === 'node-postgres') {
    const { db } = cachedNodeDatabase(connectionString)
    return db.transaction(async (
      transaction: NodePgTransaction<typeof schema, ExtractTablesWithRelations<typeof schema>>,
    ): Promise<T> => {
      await transaction.execute(sql.raw(`set local role ${databaseRole}`))
      return operation(transaction as unknown as DatabaseTransaction)
    })
  }

  if (process.env.DATABASE_DRIVER && process.env.DATABASE_DRIVER !== 'neon') {
    throw new Error('DATABASE_DRIVER must be neon or node-postgres')
  }
  const { db } = cachedNeonDatabase(connectionString)
  return db.transaction(async (transaction: DatabaseTransaction): Promise<T> => {
    // Fixed allow-listed identifiers only. SET LOCAL removes owner/BYPASSRLS
    // privileges even if the connection credential has broader membership.
    await transaction.execute(sql.raw(`set local role ${databaseRole}`))
    return operation(transaction)
  })
}

export type TenantDatabaseContext = {
  workspaceId: string
  userId: string
}

export function withTenantTransaction<T>(context: TenantDatabaseContext, operation: (transaction: DatabaseTransaction) => Promise<T>): Promise<T> {
  return withDatabaseTransaction('DATABASE_AUTHENTICATED_URL', 'yodev_app', async (transaction) => {
    await transaction.execute(sql`select set_config('app.workspace_id', ${context.workspaceId}, true)`)
    await transaction.execute(sql`select set_config('app.user_id', ${context.userId}, true)`)
    return operation(transaction)
  })
}

export function withSystemTransaction<T>(operation: (transaction: DatabaseTransaction) => Promise<T>): Promise<T> {
  return withDatabaseTransaction('DATABASE_SYSTEM_URL', 'yodev_system', operation)
}

export function withPurgeTransaction<T>(operation: (transaction: DatabaseTransaction) => Promise<T>): Promise<T> {
  return withDatabaseTransaction('DATABASE_PURGE_URL', 'yodev_purge', operation)
}
