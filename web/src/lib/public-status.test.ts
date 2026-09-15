import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { databaseDouble } from '../../test/fluent-db'
const mocks = vi.hoisted(() => ({ databases: [] as unknown[] }))
vi.mock('@/db/transactions', () => ({ withSystemTransaction: async (action: (db: unknown) => Promise<unknown>) => action(mocks.databases.shift()) }))
import { getPublicPlatformStatus, getPublicPlatformSummary, getPublicPlatformIncident } from './public-status'
const id = '81000000-0000-4000-8000-000000000001', at = '2026-09-06T12:00:00.123456Z'
const now = new Date('2026-09-07T12:00:00Z'), timestamp = { rows: [{ at: '2026-09-07T12:00:00.123456Z' }] }
const incident = { id, component: 'google_ads', impact: 'degraded', status: 'monitoring', startedAt: new Date(at) }
function db(...statementResults: unknown[]) { mocks.databases.push(databaseDouble({ statementResults }).db) }
beforeEach(() => { mocks.databases.length = 0; vi.stubEnv('APP_ENCRYPTION_KEY', Buffer.alloc(32, 7).toString('base64url')); vi.stubEnv('APP_ENCRYPTION_KEYS', ''); vi.stubEnv('APP_ENCRYPTION_CURRENT_KID', '') })
afterEach(() => vi.unstubAllEnvs())

describe('public platform status', () => {
  it('does not infer operational service from an empty incident registry', async () => {
    db([])
    expect(await getPublicPlatformSummary()).toMatchObject({ overall: 'unknown', activeIncidentCount: 0 })
    db([], timestamp, [{ total: 0 }], [])
    expect(await getPublicPlatformStatus(now)).toMatchObject({ summary: { overall: 'unknown' }, page: { items: [], total: 0 }, consultedAt: now })
  })
  it('aggregates every active incident, independently of the page filter', async () => {
    db([{ component: 'google_ads', impact: 'major_outage', count: 521 }], timestamp, [{ total: 200 }], [{ incident: { ...incident, status: 'resolved' }, at }], [], [])
    const result = await getPublicPlatformStatus(now, { status: 'resolved' })
    expect(result.summary).toMatchObject({ overall: 'major_outage', activeIncidentCount: 521 })
    expect(result.page.items[0]).toMatchObject({ incident: { status: 'resolved' }, updates: [], hasMoreUpdates: false })
  })
  it('returns 25 incidents and three latest updates, with authenticated pagination', async () => {
    db([], timestamp, [{ total: 200 }], Array.from({ length: 26 }, () => ({ incident, at })), [], Array.from({ length: 4 }, (_, index) => ({ parentId: id, update: { id: String(index), incidentId: id, messageFr: 'Message' } })))
    const result = await getPublicPlatformStatus(now)
    expect(result.page.items).toHaveLength(25); expect(result.page.nextCursor).toBeTruthy()
    expect(result.page.items[0].updates.map((update) => update.id)).toEqual(['0', '1', '2'])
    expect(result.page.items[0].hasMoreUpdates).toBe(true)
    db([])
    expect((await getPublicPlatformStatus(now, { cursor: result.page.nextCursor!, status: 'active' })).page.invalidCursor).toBe(true)
  })
  it('keeps the service summary on a forged history link', async () => {
    db([{ component: 'email', impact: 'degraded', count: 1 }])
    expect(await getPublicPlatformStatus(now, { cursor: 'forged' })).toMatchObject({ summary: { overall: 'degraded' }, page: { invalidCursor: true, items: [] } })
  })
  it('does not expose private, deleted or malformed incident identifiers', async () => {
    expect(await getPublicPlatformIncident('invalid')).toBeNull()
    db([]); expect(await getPublicPlatformIncident(id)).toBeNull()
  })
  it('paginates complete incident updates and rejects a cursor for another parent', async () => {
    db([incident], timestamp, [{ total: 701 }], Array.from({ length: 26 }, (_, index) => ({ id, at, messageFr: String(index) })))
    const result = await getPublicPlatformIncident(id)
    expect(result?.page.items).toHaveLength(25); expect(result?.page.total).toBe(701); expect(result?.page.nextCursor).toBeTruthy()
    db([incident])
    expect((await getPublicPlatformIncident('81000000-0000-4000-8000-000000000002', { cursor: result!.page.nextCursor! }))?.page.invalidCursor).toBe(true)
    db([incident], timestamp, [{ total: 0 }], [])
    expect((await getPublicPlatformIncident(id))?.page.items).toEqual([])
  })
})
