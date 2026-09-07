import { beforeEach, describe, expect, it, vi } from 'vitest'
import { databaseDouble } from '../../test/fluent-db'
const mocks = vi.hoisted(() => ({ databases: [] as unknown[], state: 'active' }))
vi.mock('@/db/transactions', () => ({ withTenantTransaction: async (_: unknown, action: (db: unknown) => Promise<unknown>) => action(mocks.databases.shift()) }))
vi.mock('@/lib/workspace-transaction-guard', () => ({ lockWorkspaceEntitlements: async () => ({ state: mocks.state }) }))
import { deletePortfolioView, listPortfolioViews, savePortfolioView } from './portfolio-views'
const workspaceId = '83000000-0000-4000-8000-000000000001', id = '83000000-0000-4000-8000-000000000003', version = '83000000-0000-4000-8000-000000000004'
const input = { workspaceId, actorUserId: 'actor', name: 'Review', criteria: { q: '', currency: 'EUR', attention: 'critical' as const, assignee: '' } }
function db(...results: unknown[]) { const value = databaseDouble({ statementResults: results, query: { workspaces: { findFirst: async () => mocks.state === 'missing' ? undefined : { accessState: mocks.state } } } }); mocks.databases.push(value.db); return value }
beforeEach(() => { mocks.databases.length = 0; mocks.state = 'active' })
describe('personal portfolio views', () => {
  it('creates an audited view below the quota and returns the immutable version token', async () => {
    const value = db([{ total: 19 }], [{ id, version }], [])
    expect(await savePortfolioView(input)).toEqual({ id, version })
    expect(value.capture.values[0]).toMatchObject({ workspaceId, userId: 'actor', criteria: input.criteria })
    expect(value.capture.values[1]).toMatchObject({ action: 'portfolio.view_created', entityId: id })
  })
  it('never exceeds the personal quota', async () => {
    const value = db([{ total: 20 }])
    await expect(savePortfolioView(input)).rejects.toThrow('Portfolio view quota')
    expect(value.capture.values).toEqual([])
  })
  it('updates by scope and version, with explicit concurrent-change failure', async () => {
    db([{ id, version }], [])
    expect(await savePortfolioView({ ...input, id, version })).toEqual({ id, version })
    db([])
    await expect(savePortfolioView({ ...input, id, version })).rejects.toThrow('Portfolio view conflict')
  })
  it('deletes only the requested current version and audits success', async () => {
    const value = db([{ id }], [])
    await deletePortfolioView({ ...input, id, version })
    expect(value.capture.values[0]).toMatchObject({ action: 'portfolio.view_deleted', entityId: id })
    db([]); await expect(deletePortfolioView({ ...input, id, version })).rejects.toThrow('Portfolio view conflict')
  })
  it('keeps saved views readable in grace but denies every write', async () => {
    mocks.state = 'grace'; db([{ id }])
    expect(await listPortfolioViews(workspaceId, 'actor')).toEqual([{ id }])
    db(); await expect(savePortfolioView(input)).rejects.toThrow('unavailable')
    db(); await expect(deletePortfolioView({ ...input, id, version })).rejects.toThrow('unavailable')
  })
  it.each(['suspended','missing'])('does not expose saved views in %s', async (state) => {
    mocks.state = state; db(); expect(await listPortfolioViews(workspaceId, 'actor')).toEqual([])
  })
  it('validates paired versions, criteria and names before mutation', async () => {
    for (const values of [{ id }, { version }, { name: '' }, { criteria: { ...input.criteria, currency: 'invalid' } }]) await expect(savePortfolioView({ ...input, ...values })).rejects.toThrow()
  })
})
