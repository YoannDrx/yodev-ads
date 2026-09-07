import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import { platformIncidents } from '../src/db/schema'
import { withSystemTransaction } from '../src/db/transactions'
import { getPublicPlatformSummary, getPublicPlatformStatus, getPublicPlatformIncident } from '../src/lib/public-status'

const url = new URL(process.env.DATABASE_SYSTEM_URL ?? '')
assert(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && url.pathname.startsWith('/yodev_test'), 'Disposable local database required')
globalThis.fetch = async () => { throw new Error('Provider calls forbidden') }
const author = 'public-status-fixture', activeId = '81000000-0000-4000-8000-000000000001', privateId = '81000000-0000-4000-8000-000000000002'
const cleanup = () => withSystemTransaction((db) => db.delete(platformIncidents).where(eq(platformIncidents.createdBy, author)))
async function main() {
  await cleanup()
  try {
    assert.equal((await getPublicPlatformSummary()).activeIncidentCount, 0, 'Fixture expects no unrelated active incident in disposable DB')
    assert.equal((await getPublicPlatformSummary()).overall, 'unknown')
    await withSystemTransaction(async (db) => {
      await db.execute(sql`insert into platform_incidents(created_by,title_fr,title_en,component,impact,status,created_at,started_at) select ${author},'Résolu '||n,'Resolved '||n,'email','degraded','resolved',now()-interval '1 day'+(n/3)*interval '1 microsecond',now()-interval '1 day' from generate_series(1,501) n`)
      await db.execute(sql`insert into platform_incidents(id,created_by,title_fr,title_en,component,impact,status,created_at,started_at) values(${activeId},${author},'Ancien incident actif','Old active incident','google_ads','major_outage','investigating',now()-interval '400 days',now()-interval '400 days')`)
      await db.execute(sql`insert into platform_incidents(id,created_by,title_fr,title_en,component,impact,status,public) values(${privateId},${author},'Privé','Private','stripe','major_outage','investigating',false)`)
      await db.execute(sql`insert into platform_incidents(created_by,title_fr,title_en,component,impact,status,started_at) values(${author},'Ancien résolu','Old resolved','email','degraded','resolved',now()-interval '400 days')`)
      await db.execute(sql`insert into platform_incident_updates(incident_id,created_by,status,message_fr,message_en,created_at) select ${activeId},${author},'investigating','MESSAGE_'||n,'MESSAGE_'||n,now()-interval '1 day'+(n/3)*interval '1 microsecond' from generate_series(1,701) n`)
    })
    const summary = await getPublicPlatformSummary()
    assert.equal(summary.overall, 'major_outage'); assert.equal(summary.activeIncidentCount, 1)
    assert.equal(summary.components.stripe, 'unknown', 'Private incident must not affect public summary')
    let cursor: string | undefined
    const incidentIds = new Set<string>()
    do {
      const { page, summary: current } = await getPublicPlatformStatus(new Date(), { cursor })
      assert.equal(current.overall, 'major_outage'); assert.equal(page.total, 502)
      for (const row of page.items) { assert(!incidentIds.has(row.incident.id)); incidentIds.add(row.incident.id); assert(row.updates.length <= 3) }
      if (!cursor) {
        assert(page.items.every((row) => row.incident.status === 'resolved'), 'Old active incident should be beyond the first page')
        assert((await getPublicPlatformStatus(new Date(), { cursor: page.nextCursor!, status: 'active' })).page.invalidCursor)
        await withSystemTransaction((db) => db.execute(sql`insert into platform_incidents(created_by,title_fr,title_en,component,impact,status) values(${author},'Après lecture','After traversal started','email','degraded','resolved')`))
      }
      cursor = page.nextCursor ?? undefined
    } while (cursor)
    assert.equal(incidentIds.size, 502); assert(incidentIds.has(activeId)); assert(!incidentIds.has(privateId))
    const active = await getPublicPlatformStatus(new Date(), { status: 'active' })
    assert.equal(active.page.total, 1); assert(active.page.items[0].hasMoreUpdates)
    assert(active.page.items[0].updates.some((item) => item.messageFr === 'MESSAGE_701'))
    assert.equal(await getPublicPlatformIncident(privateId), null)
    assert.equal(await getPublicPlatformIncident(randomUUID()), null)
    assert.equal(await getPublicPlatformIncident('invalid'), null)
    const updateIds = new Set<string>()
    cursor = undefined
    do {
      const result = await getPublicPlatformIncident(activeId, { cursor })
      assert(result); assert.equal(result.page.total, 701)
      for (const update of result.page.items) { assert(!updateIds.has(update.id)); updateIds.add(update.id) }
      if (!cursor) {
        assert((await getPublicPlatformStatus(new Date(), { cursor: result.page.nextCursor! })).page.invalidCursor)
        await withSystemTransaction((db) => db.execute(sql`insert into platform_incident_updates(incident_id,created_by,status,message_fr,message_en) values(${activeId},${author},'monitoring','Après lecture','After traversal started')`))
      }
      cursor = result.page.nextCursor ?? undefined
    } while (cursor)
    assert.equal(updateIds.size, 701)
    console.log(JSON.stringify({ ok: true, publicIncidentsTraversed: 502, updatesTraversed: 701, previewUpdates: 3, verified: ['unknown_without_observation', 'old_active_incident_beyond_page_limit', 'all_active_aggregate', 'private_incident_hidden', 'microsecond_cursor', 'concurrent_insertion_excluded', 'filter_and_collection_scope', 'full_update_history'], providerCalls: 0 }))
  } finally { await cleanup() }
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
