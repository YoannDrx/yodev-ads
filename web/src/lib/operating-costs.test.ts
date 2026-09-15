import { beforeEach, describe, expect, it, vi } from 'vitest'
import { databaseDouble } from '../../test/fluent-db'
const mocks = vi.hoisted(() => ({ db: undefined as unknown, transaction: vi.fn(async (callback: (db: unknown) => unknown) => callback(mocks.db)) }))
vi.mock('@/db/transactions', () => ({ withSystemTransaction: mocks.transaction }))
import { getOperatingCostSnapshot, saveOperatingCost } from './operating-costs'

const operator = { operatorWorkspaceId: '00000000-0000-4000-8000-000000000001', actorUserId: 'operator' }
const actor = [{ state: 'internal', owner: 'owner', role: 'admin' }]
const entry = { sourceKey: 'invoice-line-1', month: '2026-01', category: 'support', currency: 'EUR', basis: 'documented', amount: '', supportMinutes: '30.5', allocationMethod: 'direct', trialWeight: 0, soloWeight: 100, studioWeight: 0, agencyWeight: 0, internalWeight: 0, unallocatedWeight: 0, expectedVersion: 0, voided: 'false' }
const saved = { id: 'entry-1', ...entry, amountMicros: null, supportMinutes: '30.50', soloWeight: 10000, version: 1, voided: false, updatedBy: 'operator', createdAt: new Date(), updatedAt: new Date() }
describe('operator cost boundary', () => {
  beforeEach(() => vi.clearAllMocks())
  it('refuses a future service period before opening a transaction', async () => {
    await expect(saveOperatingCost({ ...operator, entry: { ...entry, month: '2099-01' } })).rejects.toThrow('commencée')
    expect(mocks.transaction).not.toHaveBeenCalled()
  })
  it.each([{ currentActor: [] }, { currentActor: [{ ...actor[0], state: 'active' }] }, { currentActor: [{ ...actor[0], role: 'analyst' }] }])('requires a current internal operator for reading aggregate evidence', async ({ currentActor }) => {
    mocks.db = databaseDouble({ statementResults: [[], currentActor] }).db
    await expect(getOperatingCostSnapshot({ ...operator, month: '2026-01' })).rejects.toThrow()
  })
  it('audits a new unpriced support observation and makes its lost-response retry idempotent', async () => {
    const first = databaseDouble({ statementResults: [[], actor, [], [], [saved], []] }); mocks.db = first.db
    await expect(saveOperatingCost({ ...operator, entry })).resolves.toMatchObject({ changed: true, version: 1 })
    expect(first.capture.values[0]).toMatchObject({ amountMicros: null, supportMinutes: '30.5', soloWeight: 10000 })
    expect(first.capture.values[1]).toMatchObject({ action: 'operations.cost_recorded', metadata: { before: null, after: { sourceKey: entry.sourceKey, amountMicros: null } } })
    const retry = databaseDouble({ statementResults: [[], actor, [], [saved]] }); mocks.db = retry.db
    await expect(saveOperatingCost({ ...operator, entry })).resolves.toMatchObject({ changed: false })
    expect(retry.capture.values).toHaveLength(0)
  })
  it('refuses truncated aggregates above the safety bound instead of returning plausible totals', async () => {
    mocks.db = databaseDouble({ statementResults: [[], actor, Array.from({ length: 10001 }, () => saved)] }).db
    await expect(getOperatingCostSnapshot({ ...operator, month: '2026-01' })).rejects.toThrow('Aucun total partiel')
  })
  it('returns explicit empty evidence without manufacturing usage or amounts', async () => {
    mocks.db = databaseDouble({ statementResults: [[], actor, [], { rows: [] }] }).db
    await expect(getOperatingCostSnapshot({ ...operator, month: '2026-01' })).resolves.toMatchObject({ totalReferences: 0, activeReferences: 0, entries: [], cells: [], usage: [], next: null })
  })
})
