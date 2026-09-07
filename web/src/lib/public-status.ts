import 'server-only'

import { and, count, desc, eq, inArray, ne, or, sql } from 'drizzle-orm'
import { z } from 'zod'
import { platformIncidentUpdates, platformIncidents } from '@/db/schema'
import { withSystemTransaction, type DatabaseTransaction } from '@/db/transactions'
import { platformStatusSummary } from '@/lib/platform-status'
import { collectionScope, collectionWhere, collectionWindow, exactTimestamp, finishCollectionPage, invalidCollectionPage, COLLECTION_PAGE_SIZE } from '@/lib/collection-pagination'

type PublicStatusQuery = { cursor?: string; status?: string }
const incidentFields = { id: platformIncidents.id, titleFr: platformIncidents.titleFr, titleEn: platformIncidents.titleEn, component: platformIncidents.component, impact: platformIncidents.impact, status: platformIncidents.status, startedAt: platformIncidents.startedAt, resolvedAt: platformIncidents.resolvedAt }
const updateFields = { id: platformIncidentUpdates.id, incidentId: platformIncidentUpdates.incidentId, status: platformIncidentUpdates.status, messageFr: platformIncidentUpdates.messageFr, messageEn: platformIncidentUpdates.messageEn, createdAt: platformIncidentUpdates.createdAt }

async function statusSummary(db: DatabaseTransaction) {
  // At most 6 components × 4 impacts, enforced by database constraints. No display limit.
  const active = await db.select({ component: platformIncidents.component, impact: platformIncidents.impact, count: count() })
    .from(platformIncidents).where(and(eq(platformIncidents.public, true), ne(platformIncidents.status, 'resolved')))
    .groupBy(platformIncidents.component, platformIncidents.impact)
  return platformStatusSummary(active.map((row) => ({ ...row, status: 'active' })))
}

/** The app header only needs the aggregate, never public message bodies. */
export function getPublicPlatformSummary() { return withSystemTransaction(statusSummary) }

export async function getPublicPlatformStatus(now = new Date(), raw: PublicStatusQuery = {}) {
  return withSystemTransaction(async (db) => {
    const summary = await statusSummary(db)
    const status = raw.status === 'active' || raw.status === 'resolved' ? raw.status : undefined
    const query = { cursor: raw.cursor, status }
    const window = await collectionWindow(db, collectionScope('public', 'platform-incidents', { status: status ?? null }), query, platformIncidents)
    type Row = { incident: { id: string; titleFr: string; titleEn: string; component: string; impact: string; status: string; startedAt: Date; resolvedAt: Date | null }; at: string }
    type Update = { id: string; incidentId: string; status: string; messageFr: string; messageEn: string; createdAt: Date }
    type Item = Row & { updates: Update[]; hasMoreUpdates: boolean }
    if (!window) return { summary, page: invalidCollectionPage<Item>(), consultedAt: now }
    // The 90-day horizon is fixed for the cursor traversal; unresolved incidents have no age limit.
    const base = and(eq(platformIncidents.public, true),
      or(ne(platformIncidents.status, 'resolved'), sql`${platformIncidents.startedAt} >= ${window.snapshot}::timestamptz - interval '90 days'`),
      status === 'active' ? ne(platformIncidents.status, 'resolved') : status === 'resolved' ? eq(platformIncidents.status, 'resolved') : undefined)
    const [{ total }] = await db.select({ total: count() }).from(platformIncidents).where(collectionWhere(base, window, false))
    const rows = await db.select({ incident: incidentFields, at: exactTimestamp(platformIncidents.createdAt) }).from(platformIncidents)
      .where(collectionWhere(base, window)).orderBy(desc(platformIncidents.createdAt), desc(platformIncidents.id)).limit(COLLECTION_PAGE_SIZE + 1)
    const page = finishCollectionPage(rows, total, window, (row) => ({ id: row.incident.id, at: row.at }), Boolean(query.cursor))
    const ids = page.items.map((row) => row.incident.id)
    const grouped = new Map<string, Update[]>()
    if (ids.length) {
      const recent = db.select(updateFields).from(platformIncidentUpdates).where(eq(platformIncidentUpdates.incidentId, platformIncidents.id))
        .orderBy(desc(platformIncidentUpdates.createdAt), desc(platformIncidentUpdates.id)).limit(4).as('recent')
      const updates = await db.select({ parentId: platformIncidents.id, update: { id: recent.id, incidentId: recent.incidentId, status: recent.status, messageFr: recent.messageFr, messageEn: recent.messageEn, createdAt: recent.createdAt } })
        .from(platformIncidents).leftJoinLateral(recent, sql`true`).where(and(eq(platformIncidents.public, true), inArray(platformIncidents.id, ids)))
        .orderBy(desc(recent.createdAt), desc(recent.id))
      for (const row of updates) if (row.update) grouped.set(row.parentId, [...(grouped.get(row.parentId) ?? []), row.update])
    }
    return { summary, page: { ...page, items: page.items.map((row) => ({ ...row, updates: (grouped.get(row.incident.id) ?? []).slice(0, 3), hasMoreUpdates: (grouped.get(row.incident.id)?.length ?? 0) > 3 })) }, consultedAt: now }
  })
}

export async function getPublicPlatformIncident(id: string, query: { cursor?: string } = {}) {
  if (!z.string().uuid().safeParse(id).success) return null
  return withSystemTransaction(async (db) => {
    const [incident] = await db.select(incidentFields).from(platformIncidents).where(and(eq(platformIncidents.id, id), eq(platformIncidents.public, true))).limit(1)
    if (!incident) return null
    const window = await collectionWindow(db, collectionScope('public', 'platform-incident-updates', { id }), query, platformIncidentUpdates)
    type Update = { id: string; incidentId: string; status: string; messageFr: string; messageEn: string; createdAt: Date; at: string }
    if (!window) return { incident, page: invalidCollectionPage<Update>() }
    const base = eq(platformIncidentUpdates.incidentId, id)
    const [{ total }] = await db.select({ total: count() }).from(platformIncidentUpdates).where(collectionWhere(base, window, false))
    const rows = await db.select({ ...updateFields, at: exactTimestamp(platformIncidentUpdates.createdAt) }).from(platformIncidentUpdates)
      .where(collectionWhere(base, window)).orderBy(desc(platformIncidentUpdates.createdAt), desc(platformIncidentUpdates.id)).limit(COLLECTION_PAGE_SIZE + 1)
    return { incident, page: finishCollectionPage(rows, total, window, (row) => row, Boolean(query.cursor)) }
  })
}
