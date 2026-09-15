import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { collectionScope, readCollectionCursor, writeCollectionCursor, finishCollectionPage, searchPattern, cleanCollectionQuery, COLLECTION_PAGE_SIZE } from './collection-pagination'
import { decryptSecret, encryptSecret } from './crypto'
const id = '78000000-0000-4000-8000-000000000001', at = '2026-09-06T12:00:00.123456Z', snapshot = '2026-09-07T12:00:00.123456Z'
const scope = collectionScope(id, 'tasks', { q: 'test', status: 'open' })
beforeEach(() => { vi.stubEnv('APP_ENCRYPTION_KEY', Buffer.alloc(32, 7).toString('base64url')); vi.stubEnv('APP_ENCRYPTION_KEYS', ''); vi.stubEnv('APP_ENCRYPTION_CURRENT_KID', '') })
afterEach(() => vi.unstubAllEnvs())
describe('tenant collection cursors', () => {
  it('binds filter order independently and changes scope for tenant, collection or filter changes', () => {
    expect(collectionScope(id, 'tasks', { status: 'open', q: 'test' })).toBe(scope)
    expect(collectionScope('foreign', 'tasks', { status: 'open', q: 'test' })).not.toBe(scope)
    expect(collectionScope(id, 'support', { status: 'open', q: 'test' })).not.toBe(scope)
    expect(collectionScope(id, 'tasks', { status: 'closed', q: 'test' })).not.toBe(scope)
  })
  it('retains all six timestamp digits and rejects replay under another filter or after expiry', () => {
    const token = writeCollectionCursor({ scope, id, at, snapshot, expires: 1000 })
    expect(readCollectionCursor(token, scope, 999)).toMatchObject({ at, id, snapshot })
    expect(readCollectionCursor(token, scope, 1000)).toBe('invalid')
    expect(readCollectionCursor(token, 'foreign', 999)).toBe('invalid')
    expect(readCollectionCursor(token.slice(0, -12) + 'tampered', scope, 999)).toBe('invalid')
  })
  it.each(['invalid', 'x'.repeat(2049)])('rejects malformed or oversized tokens', (token) => expect(readCollectionCursor(token, scope)).toBe('invalid'))
  it.each([{ version: 2 }, { at: '2026-09-06T12:00:00.123Z' }, { at: '2026-09-08T12:00:00.123456Z' }, { extra: 'injected' }, { id: '../foreign' }])('rejects authenticated but invalid cursor payload %j', (change) => {
    const token = encryptSecret(JSON.stringify({ version: 1, scope, id, at, snapshot, expires: 1000, ...change }))
    expect(readCollectionCursor(token, scope, 999)).toBe('invalid')
  })
  it('does not copy a row payload or private fields into a cursor', () => {
    const rows = Array.from({ length: COLLECTION_PAGE_SIZE + 1 }, (_, index) => ({ id, at, body: `private-${index}` }))
    const page = finishCollectionPage(rows, 500, { scope, snapshot, expires: 1000, boundary: undefined as never, after: undefined }, (row) => row, false)
    expect(page.items).toHaveLength(COLLECTION_PAGE_SIZE)
    expect(JSON.parse(decryptSecret(page.nextCursor!))).toEqual({ version: 1, scope, snapshot, expires: 1000, id, at })
    expect(readCollectionCursor(page.nextCursor!, scope, 999)).not.toBe('invalid')
    expect(finishCollectionPage(rows.slice(0, 1), 1, { scope, snapshot, expires: 1000, boundary: undefined as never, after: undefined }, (row) => row, true).nextCursor).toBeNull()
  })
  it('handles the initial page, literal wildcard searches and empty form values', () => {
    expect(readCollectionCursor(undefined, scope)).toBeNull()
    expect(searchPattern('  %_\\test ')).toBe('%\\%\\_\\\\test%')
    expect(searchPattern()).toBe('%%')
    expect(cleanCollectionQuery({ q: '', status: ' ', cursor: 'token', client: ' x ' })).toEqual({ cursor: 'token', client: 'x' })
  })
})
