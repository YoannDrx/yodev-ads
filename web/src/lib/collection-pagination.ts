import 'server-only'

import { createHash } from 'node:crypto'
import { z } from 'zod'
import { and, sql, type SQL } from 'drizzle-orm'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'
import type { DatabaseTransaction } from '@/db/transactions'
import { decryptSecret, encryptSecret } from '@/lib/crypto'

export const COLLECTION_PAGE_SIZE = 25
export type CollectionQuery = { id?: string; cursor?: string; q?: string; status?: string; client?: string; assignee?: string; severity?: string }
export type CollectionPage<T> = { items: T[]; total: number; nextCursor: string | null; invalidCursor: boolean; started: boolean }
const timestamp = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/)
const cursorSchema = z.object({ version: z.literal(1), scope: z.string().length(64), snapshot: timestamp, at: timestamp, id: z.string().uuid(), expires: z.number().int() }).strict()
type Cursor = z.infer<typeof cursorSchema>
export function collectionScope(workspaceId: string, collection: string, filters: Record<string, unknown>) {
  return createHash('sha256').update(JSON.stringify([workspaceId, collection, Object.entries(filters).sort(([a], [b]) => a.localeCompare(b))])).digest('hex')
}
export function readCollectionCursor(value: string | undefined, scope: string, now = Date.now()) {
  if (!value) return null
  try {
    if (typeof value !== 'string' || value.length > 2048) throw new Error('Invalid cursor')
    const cursor = cursorSchema.parse(JSON.parse(decryptSecret(value)))
    if (cursor.scope !== scope || cursor.expires <= now || cursor.at > cursor.snapshot) throw new Error('Invalid cursor')
    return cursor
  } catch { return 'invalid' as const }
}
export function writeCollectionCursor(value: Omit<Cursor, 'version'>) { return encryptSecret(JSON.stringify({ version: 1, ...value })) }
export function exactTimestamp(column: AnyPgColumn | SQL) { return sql<string>`to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')` }
export function searchPattern(value?: string) { return `%${(typeof value === 'string' ? value : '').trim().slice(0, 120).replace(/[\\%_]/g, '\\$&')}%` }
export function cleanCollectionQuery(query: CollectionQuery = {}): CollectionQuery {
  return Object.fromEntries(Object.entries(query).filter(([key, value]) => ['id', 'cursor', 'q', 'status', 'client', 'assignee', 'severity'].includes(key) && typeof value === 'string' && (key === 'cursor' || value.trim().length > 0)).map(([key, value]) => [key, key === 'cursor' ? value : value!.trim().slice(0, 120)]))
}
export async function collectionWindow(db: DatabaseTransaction, scope: string, query: CollectionQuery, columns: { id: AnyPgColumn; createdAt: AnyPgColumn }) {
  const cursor = readCollectionCursor(query.cursor, scope)
  if (cursor === 'invalid') return null
  const snapshot = cursor?.snapshot ?? (await db.execute<{ at: string }>(sql`select ${exactTimestamp(sql`transaction_timestamp()`)} as at`)).rows[0].at
  const expires = cursor?.expires ?? Date.now() + 24 * 60 * 60_000
  return {
    scope, snapshot, expires,
    boundary: sql`${columns.createdAt} <= ${snapshot}::timestamptz`,
    after: cursor ? sql`(${columns.createdAt}, ${columns.id}) < (${cursor.at}::timestamptz, ${cursor.id}::uuid)` : undefined,
  }
}
export function finishCollectionPage<T>(rows: T[], total: number, window: NonNullable<Awaited<ReturnType<typeof collectionWindow>>>, cursorOf: (row: T) => { id: string; at: string }, started: boolean): CollectionPage<T> {
  const items = rows.slice(0, COLLECTION_PAGE_SIZE), last = items.at(-1)
  const position = last ? cursorOf(last) : null
  return { items, total, started, invalidCursor: false, nextCursor: rows.length > COLLECTION_PAGE_SIZE && last ? writeCollectionCursor({ scope: window.scope, snapshot: window.snapshot, expires: window.expires, id: position!.id, at: position!.at }) : null }
}
export function invalidCollectionPage<T>(): CollectionPage<T> { return { items: [], total: 0, nextCursor: null, invalidCursor: true, started: true } }
export function collectionWhere(base: SQL | undefined, window: NonNullable<Awaited<ReturnType<typeof collectionWindow>>>, after = true) { return and(base, window.boundary, after ? window.after : undefined) }
