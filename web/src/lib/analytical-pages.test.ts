import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { databaseDouble } from '../../test/fluent-db'
const mocks = vi.hoisted(() => ({ dbs: [] as unknown[] }))
vi.mock('@/db/transactions', () => ({ withTenantTransaction: async (_context: unknown, callback: (db: unknown) => unknown) => callback(mocks.dbs.shift()) }))
import { getAnalyticalPage, getAnalyticalExport } from './analytical-pages'
import { decryptSecret, encryptSecret } from './crypto'

const workspaceId = '79000000-0000-4000-8000-000000000001', clientId = '79000000-0000-4000-8000-000000000002', sourceVersion = '79000000-0000-4000-8000-000000000003'
const now = new Date('2026-09-07T09:00:00Z')
const client = { id: clientId, name: 'Client', timezone: 'Europe/Paris', currencyCode: 'EUR' }
const row = { family: 'devices', contractVersion: 1, sourceVersion, periodFrom: '2026-08-08', periodThrough: '2026-09-06', timezone: client.timezone, currencyCode: 'EUR', observedAt: now, collectedAt: now, coverage: null, payloadType: 'array', storedCount: 701, total: 701, items: Array.from({ length: 26 }, (_, index) => ({ position: index + 1, value: { label: `Row ${index}` } })) }
function db(snapshot: unknown = row, state = 'internal', account: unknown = client) {
  mocks.dbs.push(databaseDouble({ statementResults: [{ rows: snapshot ? [snapshot] : [] }], query: {
    workspaces: { findFirst: async () => ({ accessState: state }) }, clients: { findFirst: async () => account }, analyticalCollections: { findFirst: async () => snapshot },
  } }).db)
}
beforeEach(() => { mocks.dbs.length = 0; vi.useFakeTimers(); vi.setSystemTime(now); vi.stubEnv('APP_ENCRYPTION_KEY', Buffer.alloc(32, 7).toString('base64url')); vi.stubEnv('APP_ENCRYPTION_KEYS', ''); vi.stubEnv('APP_ENCRYPTION_CURRENT_KID', '') })
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs() })

describe('stored analytical pages', () => {
  it('returns a bounded page and ties its cursor to the stored version and last ordinal', async () => {
    db()
    const first = await getAnalyticalPage(workspaceId, clientId, 'devices', { q: '  Row  ' })
    expect(first).toMatchObject({ query: 'Row', total: 701, storedCount: 701, invalidCursor: false })
    expect(first?.items).toHaveLength(25)
    expect(JSON.parse(decryptSecret(first!.nextCursor!))).toMatchObject({ kind: 'analytical', sourceVersion, position: 25, expires: now.getTime() + 86_400_000 })
    db({ ...row, items: [{ position: 26, value: { label: 'next' } }] })
    expect(await getAnalyticalPage(workspaceId, clientId, 'devices', { q: 'Row', cursor: first!.nextCursor! })).toMatchObject({ items: [{ position: 26 }], nextCursor: null, started: true })
  })
  it('rejects expired, cross-filter, forged and malformed cursors', async () => {
    db(); const first = await getAnalyticalPage(workspaceId, clientId, 'devices')
    const parsed = JSON.parse(decryptSecret(first!.nextCursor!))
    for (const cursor of ['forged', '', 'x'.repeat(2049), encryptSecret(JSON.stringify({ ...parsed, expires: now.getTime() })), encryptSecret(JSON.stringify({ ...parsed, position: -1 })), encryptSecret(JSON.stringify({ ...parsed, kind: 'other' }))]) {
      db(); expect(await getAnalyticalPage(workspaceId, clientId, 'devices', { cursor })).toMatchObject({ invalidCursor: true, items: [] })
    }
    db(); expect(await getAnalyticalPage(workspaceId, clientId, 'devices', { cursor: first!.nextCursor!, q: 'different' })).toMatchObject({ invalidCursor: true })
  })
  it('does not mix refreshed records with an existing traversal', async () => {
    db(); const first = await getAnalyticalPage(workspaceId, clientId, 'devices')
    db({ ...row, sourceVersion: clientId })
    expect(await getAnalyticalPage(workspaceId, clientId, 'devices', { cursor: first!.nextCursor! })).toMatchObject({ changed: true, items: [], nextCursor: null })
    db(null)
    expect(await getAnalyticalPage(workspaceId, clientId, 'devices', { cursor: first!.nextCursor! })).toMatchObject({ changed: true, snapshot: null })
  })
  it('distinguishes missing, incompatible and successfully empty data', async () => {
    for (const snapshot of [null, { ...row, currencyCode: 'USD' }, { ...row, contractVersion: 2 }, { ...row, payloadType: 'object' }]) {
      db(snapshot); expect(await getAnalyticalPage(workspaceId, clientId, 'devices')).toMatchObject({ snapshot: null, items: [] })
    }
    db({ ...row, items: [], total: 0, storedCount: 0 })
    expect(await getAnalyticalPage(workspaceId, clientId, 'devices')).toMatchObject({ snapshot: { sourceVersion }, items: [], total: 0 })
    db({ ...row, family: 'tracking', payloadType: 'object' })
    expect((await getAnalyticalPage(workspaceId, clientId, 'tracking'))?.snapshot).not.toBeNull()
  })
  it('keeps authorization and parameter validation ahead of data reads', async () => {
    expect(await getAnalyticalPage(workspaceId, 'invalid', 'devices')).toBeNull()
    expect(await getAnalyticalPage(workspaceId, clientId, 'invalid' as never)).toBeNull()
    db(row, 'suspended'); expect(await getAnalyticalPage(workspaceId, clientId, 'devices')).toBeNull()
    db(row, 'internal', null); expect(await getAnalyticalPage(workspaceId, clientId, 'devices')).toBeNull()
    db(row, 'grace'); expect((await getAnalyticalPage(workspaceId, clientId, 'devices'))?.items).toHaveLength(25)
  })
  it('exports the complete stored version with metadata and rejects replacement, missing or malformed data', async () => {
    const payload = Array.from({ length: 701 }, (_, index) => ({ label: `Row ${index}` }))
    db({ ...row, payload })
    expect(await getAnalyticalExport(workspaceId, clientId, 'devices', sourceVersion)).toMatchObject({ changed: false, document: { client, sourceVersion, records: payload, coverage: null } })
    db({ ...row, payload }); expect(await getAnalyticalExport(workspaceId, clientId, 'devices', clientId)).toEqual({ changed: true })
    for (const snapshot of [null, { ...row, payload: {} }, { ...row, currencyCode: 'USD', payload }]) {
      db(snapshot); expect(await getAnalyticalExport(workspaceId, clientId, 'devices', sourceVersion)).toBeNull()
    }
    expect(await getAnalyticalExport(workspaceId, clientId, 'devices', 'invalid')).toBeNull()
    db(row, 'suspended'); expect(await getAnalyticalExport(workspaceId, clientId, 'devices', sourceVersion)).toBeNull()
  })
})
