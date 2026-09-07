import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { databaseDouble } from '../../test/fluent-db'
const mocks = vi.hoisted(() => ({ databases: [] as unknown[] }))
vi.mock('@/db/transactions', () => ({ withTenantTransaction: async (_: unknown, action: (db: unknown) => Promise<unknown>) => action(mocks.databases.shift()) }))
import { getPortfolioSnapshot } from './portfolio-data'
const workspaceId = '82000000-0000-4000-8000-000000000001', id = '82000000-0000-4000-8000-000000000003', at = '2026-09-06T12:00:00.123456Z'
const timestamp = { rows: [{ at: '2026-09-07T12:00:00.123456Z' }] }
function db(state: string | null, ...statementResults: unknown[]) { mocks.databases.push(databaseDouble({ statementResults, query: { workspaces: { findFirst: async () => state ? { accessState: state } : undefined } } }).db) }
beforeEach(() => { mocks.databases.length = 0; vi.stubEnv('APP_ENCRYPTION_KEY', Buffer.alloc(32,7).toString('base64url')); vi.stubEnv('APP_ENCRYPTION_KEYS',''); vi.stubEnv('APP_ENCRYPTION_CURRENT_KID','') })
afterEach(() => vi.unstubAllEnvs())
describe('portfolio read boundary', () => {
  it.each([null,'suspended','deletion_pending'])('denies portfolio reads in %s', async (state) => { db(state); expect(await getPortfolioSnapshot(workspaceId)).toBeNull() })
  it('rejects a foreign or forged cursor before the metrics query', async () => {
    db('active'); expect(await getPortfolioSnapshot(workspaceId, { cursor: 'forged' })).toMatchObject({ page: { invalidCursor: true, items: [] }, observedAt: null })
  })
  it('returns a bounded, authenticated page and all filtered summaries', async () => {
    db('grace', timestamp, { rows: [{ summary: { accounts: 50 }, groups: [{ currency_code: 'EUR' }], rows: Array.from({ length: 26 }, () => ({ id, at })) }] })
    const value = await getPortfolioSnapshot(workspaceId)
    expect(value?.page.items).toHaveLength(25); expect(value?.page.nextCursor).toBeTruthy(); expect(value?.summary.accounts).toBe(50)
    db('grace')
    expect((await getPortfolioSnapshot(workspaceId, { cursor: value!.page.nextCursor!, currency: 'USD' }))?.page.invalidCursor).toBe(true)
  })
  it.each(['all','action','critical','missing_data','overdue','pending_approval'])('applies the %s attention filter without losing valid zero totals', async (attention) => {
    db('internal', timestamp, { rows: [{ summary: { accounts: 0 }, groups: [], rows: [] }] })
    expect(await getPortfolioSnapshot(workspaceId, { attention, q: '%_', currency: 'JPY', assignee: attention === 'all' ? 'unassigned' : 'member' })).toMatchObject({ page: { total: 0, items: [] }, groups: [] })
  })
})
