import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { analyticalCollections, clients, workspaces } from '../src/db/schema'
import { withSystemTransaction } from '../src/db/transactions'
import { getAnalyticalCollections } from '../src/lib/analytical-collections'
import { getAnalyticalPage, getAnalyticalExport } from '../src/lib/analytical-pages'
import { reportCalendarWindow } from '../src/lib/calendar-window'

const url = new URL(process.env.DATABASE_SYSTEM_URL ?? '')
assert(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && url.pathname.startsWith('/yodev_test'), 'Disposable local database required')
const workspaceId = '79000000-0000-4000-8000-000000000001', foreignId = '79000000-0000-4000-8000-000000000002'
globalThis.fetch = async () => { throw new Error('Provider calls forbidden') }
async function main() {
  for (const id of [workspaceId, foreignId]) await withSystemTransaction((db) => db.delete(workspaces).where(eq(workspaces.id, id)))
  try {
    await withSystemTransaction((db) => db.insert(workspaces).values([workspaceId, foreignId].map((id) => ({ id, ownerUserId: 'analytics-page-fixture', name: 'Analytical pages', slug: `analytical-pages-${id}`, plan: 'internal', accessState: 'internal' }))))
    const [client] = await withSystemTransaction((db) => db.insert(clients).values({ workspaceId, googleCustomerId: '7900000001', name: 'Paged client', timezone: 'Europe/Paris', currencyCode: 'EUR' }).returning())
    const [foreign] = await withSystemTransaction((db) => db.insert(clients).values({ workspaceId: foreignId, googleCustomerId: '7900000002', name: 'Foreign client' }).returning())
    const window = reportCalendarWindow({ period: '30', timezone: client.timezone, now: new Date() })
    const records = Array.from({ length: 701 }, (_, index) => ({ label: index === 650 ? 'literal %_ needle' : `Row ${index}`, costMicros: String(index), marker: 'same value allowed' }))
    const sourceVersion = randomUUID()
    const common = { workspaceId, clientId: client.id, contractVersion: 1, periodFrom: window.from, periodThrough: window.through, timezone: client.timezone, currencyCode: client.currencyCode, sourceVersion, observedAt: new Date() }
    await withSystemTransaction((db) => db.insert(analyticalCollections).values([{ ...common, family: 'devices', payload: records }, { ...common, family: 'tracking', payload: { status: 'MANAGED_BY_THIS_CUSTOMER' } }]))
    const preview = await getAnalyticalCollections(workspaceId, client.id, ['devices'], 200)
    assert.equal((preview.snapshots.find((row) => row.family === 'devices')?.payload as unknown[]).length, 200)
    assert.equal(preview.snapshots.find((row) => row.family === 'devices')?.storedRowCount, 701)
    assert.equal(preview.snapshots.find((row) => row.family === 'tracking')?.payload, null)
    let cursor: string | undefined
    const positions = new Set<number>()
    do {
      const page = await getAnalyticalPage(workspaceId, client.id, 'devices', { cursor })
      assert(page); assert(!page.invalidCursor && !page.changed); assert(page.items.length <= 25)
      assert.equal(page.total, 701); assert.equal(page.storedCount, 701)
      for (const item of page.items) { assert(!positions.has(item.position)); positions.add(item.position); assert.deepEqual(item.value, records[item.position - 1]) }
      cursor = page.nextCursor ?? undefined
    } while (cursor)
    assert.equal(positions.size, 701)
    const first = await getAnalyticalPage(workspaceId, client.id, 'devices')
    assert(first?.nextCursor)
    assert((await getAnalyticalPage(workspaceId, client.id, 'devices', { cursor: first.nextCursor, q: 'needle' }))?.invalidCursor)
    assert((await getAnalyticalPage(foreignId, foreign.id, 'devices', { cursor: first.nextCursor }))?.invalidCursor)
    assert((await getAnalyticalPage(workspaceId, client.id, 'tracking', { cursor: first.nextCursor }))?.invalidCursor)
    assert((await getAnalyticalPage(workspaceId, client.id, 'devices', { cursor: 'forged' }))?.invalidCursor)
    assert.equal(await getAnalyticalPage(foreignId, client.id, 'devices'), null)
    const found = await getAnalyticalPage(workspaceId, client.id, 'devices', { q: '%_' })
    assert.equal(found?.total, 1); assert.equal(found?.items[0].position, 651)
    const exported = await getAnalyticalExport(workspaceId, client.id, 'devices', sourceVersion)
    assert(exported && !exported.changed); assert.deepEqual(exported.document.records, records)
    assert.equal(await getAnalyticalExport(foreignId, client.id, 'devices', sourceVersion), null)
    assert.equal((await getAnalyticalPage(workspaceId, client.id, 'tracking'))?.items.length, 1)
    assert.equal((await getAnalyticalPage(workspaceId, client.id, 'ads'))?.snapshot, null)
    await withSystemTransaction((db) => db.update(analyticalCollections).set({ sourceVersion: randomUUID() }).where(eq(analyticalCollections.clientId, client.id)))
    const changed = await getAnalyticalPage(workspaceId, client.id, 'devices', { cursor: first.nextCursor })
    assert(changed?.changed); assert.equal(changed.items.length, 0)
    assert.deepEqual(await getAnalyticalExport(workspaceId, client.id, 'devices', sourceVersion), { changed: true })
    await withSystemTransaction((db) => db.update(workspaces).set({ accessState: 'grace' }).where(eq(workspaces.id, workspaceId)))
    assert.equal((await getAnalyticalPage(workspaceId, client.id, 'devices'))?.total, 701)
    await withSystemTransaction((db) => db.update(workspaces).set({ accessState: 'suspended' }).where(eq(workspaces.id, workspaceId)))
    assert.equal(await getAnalyticalPage(workspaceId, client.id, 'devices'), null)
    assert.equal(await getAnalyticalExport(workspaceId, client.id, 'devices', sourceVersion), null)
    await withSystemTransaction((db) => db.update(workspaces).set({ accessState: 'internal' }).where(eq(workspaces.id, workspaceId)))
    await withSystemTransaction((db) => db.update(clients).set({ active: false }).where(eq(clients.id, client.id)))
    assert.equal(await getAnalyticalPage(workspaceId, client.id, 'devices'), null)
    console.log(JSON.stringify({ ok: true, rows: 701, verified: ['complete_ordinal_traversal', 'literal_search_beyond_preview', 'snapshot_counts', 'scoped_authenticated_cursor', 'refresh_invalidates_old_cursor_and_export', 'complete_stored_export', 'singleton_tracking', 'grace_read', 'suspension_and_inactive_account_denied'], providerCalls: 0 }))
  } finally { for (const id of [workspaceId, foreignId]) await withSystemTransaction((db) => db.delete(workspaces).where(eq(workspaces.id, id))) }
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
