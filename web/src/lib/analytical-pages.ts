import 'server-only'

import { and, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { analyticalCollections, clients, workspaces } from '@/db/schema'
import { withTenantTransaction, type DatabaseTransaction } from '@/db/transactions'
import { analyticalFamilies, analyticalSnapshotState, type AnalyticalFamily, type AnalyticalSnapshot } from '@/lib/analytical-model'
import { decryptSecret, encryptSecret } from '@/lib/crypto'
import { collectionScope, searchPattern } from '@/lib/collection-pagination'
import { workspaceLifecycleAllowsPermission } from '@/lib/workspace-access'

export const ANALYTICAL_PAGE_SIZE = 25
export type AnalyticalPageQuery = { q?: string; cursor?: string }
const cursorSchema = z.object({
  version: z.literal(1), kind: z.literal('analytical'), scope: z.string().length(64),
  sourceVersion: z.string().uuid(), position: z.number().int().min(1).max(2_097_152), expires: z.number().int(),
}).strict()
type Cursor = z.infer<typeof cursorSchema>
export type AnalyticalPageItem = { position: number; value: unknown }
type SnapshotMetadata = Omit<AnalyticalSnapshot, 'payload'>
type RawPage = SnapshotMetadata & { payloadType: string; storedCount: number; total: number; items: AnalyticalPageItem[] }
export type AnalyticalPage = {
  client: { id: string; name: string; timezone: string; currencyCode: string }; snapshot: SnapshotMetadata | null;
  items: AnalyticalPageItem[]; total: number; storedCount: number; query: string; nextCursor: string | null;
  invalidCursor: boolean; changed: boolean; started: boolean;
}

function readCursor(value: string | undefined, scope: string): Cursor | null | 'invalid' {
  if (value === undefined) return null
  try {
    if (typeof value !== 'string' || !value || value.length > 2048) return 'invalid'
    const parsed = cursorSchema.parse(JSON.parse(decryptSecret(value)))
    return parsed.scope === scope && parsed.expires > Date.now() ? parsed : 'invalid'
  } catch { return 'invalid' }
}

async function context(db: DatabaseTransaction, workspaceId: string, clientId: string) {
  const workspace = await db.query.workspaces.findFirst({ where: eq(workspaces.id, workspaceId), columns: { accessState: true } })
  if (!workspace || !workspaceLifecycleAllowsPermission(workspace.accessState, 'portfolio:read')) return null
  return await db.query.clients.findFirst({ where: and(eq(clients.workspaceId, workspaceId), eq(clients.id, clientId), eq(clients.active, true), eq(clients.isManager, false)), columns: { id: true, name: true, timezone: true, currencyCode: true } }) ?? null
}

function metadata(row: SnapshotMetadata): SnapshotMetadata {
  return { family: row.family, contractVersion: row.contractVersion, sourceVersion: row.sourceVersion, periodFrom: row.periodFrom, periodThrough: row.periodThrough,
    timezone: row.timezone, currencyCode: row.currencyCode, observedAt: new Date(row.observedAt), collectedAt: new Date(row.collectedAt), coverage: row.coverage }
}

/** A JSON array's ordinal is stable within one source version. A refresh invalidates its cursors. */
export function getAnalyticalPage(workspaceId: string, clientId: string, family: AnalyticalFamily, query: AnalyticalPageQuery = {}): Promise<AnalyticalPage | null> {
  if (!z.string().uuid().safeParse(clientId).success || !analyticalFamilies.includes(family)) return Promise.resolve(null)
  const q = typeof query.q === 'string' ? query.q.trim().slice(0, 120) : ''
  const scope = collectionScope(workspaceId, 'analytical', { clientId, family, q })
  const cursor = readCursor(query.cursor, scope)
  return withTenantTransaction({ workspaceId, userId: 'repository:analytical-page' }, async (db) => {
    const client = await context(db, workspaceId, clientId)
    if (!client) return null
    const empty: AnalyticalPage = { client, snapshot: null, query: q, items: [], total: 0, storedCount: 0, nextCursor: null, invalidCursor: cursor === 'invalid', changed: false, started: Boolean(query.cursor) }
    if (cursor === 'invalid') return empty
    // Metadata, counts and the bounded page are read from the same SQL snapshot.
    const result = await db.execute<RawPage>(sql`
      with source as (
        select c.*, jsonb_typeof(c.payload) as payload_type,
          case when jsonb_typeof(c.payload)='array' then c.payload else jsonb_build_array(c.payload) end as entries
        from ${analyticalCollections} c where c.workspace_id=${workspaceId} and c.client_id=${clientId} and c.family=${family}
      )
      select c.family, c.contract_version as "contractVersion", c.source_version as "sourceVersion",
        c.period_from as "periodFrom", c.period_through as "periodThrough", c.timezone, c.currency_code as "currencyCode",
        c.observed_at as "observedAt", c.collected_at as "collectedAt", c.coverage, c.payload_type as "payloadType",
        jsonb_array_length(c.entries) as "storedCount",
        (select count(*)::int from jsonb_array_elements(c.entries) e(value) where e.value::text ilike ${searchPattern(q)}) as total,
        (select coalesce(jsonb_agg(jsonb_build_object('position', p.position, 'value', p.value) order by p.position), '[]'::jsonb)
          from (select e.value, e.position from jsonb_array_elements(c.entries) with ordinality e(value, position)
            where e.value::text ilike ${searchPattern(q)} and e.position > ${cursor?.position ?? 0}
            order by e.position limit ${ANALYTICAL_PAGE_SIZE + 1}) p) as items
      from source c
    `)
    const row = result.rows[0]
    if (!row) return { ...empty, changed: Boolean(cursor) }
    const snapshot = metadata(row)
    if (analyticalSnapshotState({ ...snapshot, payload: null }, client) === 'unavailable' || (family === 'tracking' ? row.payloadType !== 'object' : row.payloadType !== 'array')) return { ...empty, changed: Boolean(cursor) }
    if (cursor && cursor.sourceVersion !== row.sourceVersion) return { ...empty, snapshot, changed: true }
    const items = row.items.slice(0, ANALYTICAL_PAGE_SIZE), last = items.at(-1)
    const nextCursor = row.items.length > ANALYTICAL_PAGE_SIZE && last ? encryptSecret(JSON.stringify({ version: 1, kind: 'analytical', scope, sourceVersion: row.sourceVersion, position: last.position, expires: cursor?.expires ?? Date.now() + 86_400_000 } satisfies Cursor)) : null
    return { ...empty, snapshot, items, total: row.total, storedCount: row.storedCount, nextCursor }
  })
}

/** Exports exactly the requested stored version; never silently substitutes a refresh. */
export function getAnalyticalExport(workspaceId: string, clientId: string, family: AnalyticalFamily, sourceVersion: string) {
  if (!z.string().uuid().safeParse(clientId).success || !z.string().uuid().safeParse(sourceVersion).success || !analyticalFamilies.includes(family)) return Promise.resolve(null)
  return withTenantTransaction({ workspaceId, userId: 'repository:analytical-export' }, async (db) => {
    const client = await context(db, workspaceId, clientId)
    if (!client) return null
    const row = await db.query.analyticalCollections.findFirst({ where: and(eq(analyticalCollections.workspaceId, workspaceId), eq(analyticalCollections.clientId, clientId), eq(analyticalCollections.family, family)) })
    if (!row || analyticalSnapshotState(row, client) === 'unavailable') return null
    if (row.sourceVersion !== sourceVersion) return { changed: true as const }
    if (family === 'tracking' ? !row.payload || typeof row.payload !== 'object' || Array.isArray(row.payload) : !Array.isArray(row.payload)) return null
    return { changed: false as const, document: { version: 1, client, ...metadata(row), records: row.payload } }
  })
}
