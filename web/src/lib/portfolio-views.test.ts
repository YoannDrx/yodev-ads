import { beforeEach, describe, expect, it, vi } from 'vitest'
import { databaseDouble } from '../../test/fluent-db'
const mocks = vi.hoisted(() => ({ databases: [] as unknown[], state: 'active', role: 'analyst' }))
vi.mock('@/db/transactions', () => ({ withTenantTransaction: async (_: unknown, action: (db: unknown) => Promise<unknown>) => action(mocks.databases.shift()) }))
import { deletePortfolioView, listPortfolioViews, savePortfolioView } from './portfolio-views'
const workspaceId = '83000000-0000-4000-8000-000000000001', id = '83000000-0000-4000-8000-000000000003', version = '83000000-0000-4000-8000-000000000004'
const input = { workspaceId, actorUserId: 'actor', name: 'Review', criteria: { q: '', currency: 'EUR', attention: 'critical' as const, assignee: '' } }
function db(...results: unknown[]) { const value = databaseDouble({ statementResults: results, query: { workspaces: { findFirst: async () => mocks.state === 'missing' ? undefined : { accessState: mocks.state } } } }); mocks.databases.push(value.db); return value }
function writeDb(...results: unknown[]) { return db({ rows: [{ state: mocks.state, plan: 'agency', member_role: mocks.role, is_owner: false, trial_expired: false }] }, ...results) }
beforeEach(() => { mocks.databases.length = 0; mocks.state = 'active'; mocks.role = 'analyst' })
describe('personal portfolio views', () => {
  it.each(['create', 'update', 'delete'])('refuses %s after loss of portfolio rights', async (operation) => {
    mocks.role = 'client'; const value = writeDb()
    const run = operation === 'delete' ? () => deletePortfolioView({ ...input, id, version })
      : () => savePortfolioView({ ...input, ...(operation === 'update' ? { id, version } : {}) })
    await expect(run()).rejects.toThrow('non autorisée')
    expect(value.capture.values).toEqual([]); expect(value.capture.sets).toEqual([])
  })

  it('creates an audited view below the quota and returns the immutable version token', async () => {
    const value = writeDb([{ total: 19 }], [{ id, version }], [])
    expect(await savePortfolioView(input)).toEqual({ id, version })
    expect(value.capture.values[0]).toMatchObject({ workspaceId, userId: 'actor', criteria: input.criteria })
    expect(value.capture.values[1]).toMatchObject({ action: 'portfolio.view_created', entityId: id })
  })
  it('never exceeds the personal quota', async () => {
    const value = writeDb([{ total: 20 }])
    await expect(savePortfolioView(input)).rejects.toThrow('Portfolio view quota')
    expect(value.capture.values).toEqual([])
  })
  it('updates by scope and version, with explicit concurrent-change failure', async () => {
    writeDb([{ id, version }], [])
    expect(await savePortfolioView({ ...input, id, version })).toEqual({ id, version })
    writeDb([])
    await expect(savePortfolioView({ ...input, id, version })).rejects.toThrow('Portfolio view conflict')
  })
  it('deletes only the requested current version and audits success', async () => {
    const value = writeDb([{ id }], [])
    await deletePortfolioView({ ...input, id, version })
    expect(value.capture.values[0]).toMatchObject({ action: 'portfolio.view_deleted', entityId: id })
    writeDb([]); await expect(deletePortfolioView({ ...input, id, version })).rejects.toThrow('Portfolio view conflict')
  })
  it('keeps saved views readable in grace but denies every write', async () => {
    mocks.state = 'grace'; db([{ id }])
    expect(await listPortfolioViews(workspaceId, 'actor')).toEqual([{ id }])
    writeDb(); await expect(savePortfolioView(input)).rejects.toThrow('non autorisée')
    writeDb(); await expect(deletePortfolioView({ ...input, id, version })).rejects.toThrow('non autorisée')
  })
  it.each(['suspended','missing'])('does not expose saved views in %s', async (state) => {
    mocks.state = state; db(); expect(await listPortfolioViews(workspaceId, 'actor')).toEqual([])
  })
  it('validates paired versions, criteria and names before mutation', async () => {
    for (const values of [{ id }, { version }, { name: '' }, { criteria: { ...input.criteria, currency: 'invalid' } }]) await expect(savePortfolioView({ ...input, ...values })).rejects.toThrow()
  })
})
