import { beforeEach, describe, expect, it, vi } from 'vitest'
import { databaseDouble } from '../../test/fluent-db'

const mocks = vi.hoisted(() => ({
  db: undefined as unknown, tenant: vi.fn(), system: vi.fn(), lock: vi.fn(), reconcile: vi.fn(),
}))
vi.mock('@/db/transactions', () => ({ withTenantTransaction: mocks.tenant, withSystemTransaction: mocks.system }))
vi.mock('@/lib/account-selection', () => ({ lockAccountManagement: mocks.lock, reconcileManagedAccountSelection: mocks.reconcile }))
import { googleInventoryConnectionIdentity, persistSystemGoogleAccountInventory, persistTenantGoogleAccountInventory, type ManagedGoogleCustomer } from './google-account-sync'

const workspaceId = '00000000-0000-4000-8000-000000000001'
const connection = { id: 'connection-1', managerCustomerId: '1000000000', encryptedRefreshToken: 'fixture-only', scopes: ['ads'] }
const customers: ManagedGoogleCustomer[] = [
  { customerId: '100-000-0000', name: 'Manager', currencyCode: 'EUR', timezone: 'Europe/Paris', isManager: true },
  { customerId: '200-000-0000', name: 'A', currencyCode: 'EUR', timezone: 'Europe/Paris', isManager: false },
]
const input = { workspaceId, actorUserId: 'user-1', connectionId: connection.id, connectionIdentity: googleInventoryConnectionIdentity(connection), observedAt: new Date('2026-08-01'), managedCustomers: customers, action: 'google_ads.accounts_synced' as const, recordActivation: true }
function database(latest?: unknown, current: unknown = connection) {
  const result = databaseDouble({ query: { googleAdsConnections: { findFirst: vi.fn(async () => current) }, auditEvents: { findFirst: vi.fn(async () => latest) } } })
  mocks.db = result.db
  return result
}
describe('Google account inventory repository', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.tenant.mockImplementation(async (_context, callback) => callback(mocks.db))
    mocks.system.mockImplementation(async (callback) => callback(mocks.db))
    mocks.lock.mockResolvedValue({ workspace: { plan: 'solo' }, entitlements: { limits: { advertiserAccounts: 3 } } })
    mocks.reconcile.mockResolvedValue({ included: [{ id: 'manager', isManager: true }], includedAdvertisers: [], excluded: [], limit: 3 })
  })
  it('discovers unselected accounts without overwriting existing preferences on conflict', async () => {
    const db = database()
    await persistTenantGoogleAccountInventory(input)
    expect(db.capture.values.slice(0, 2)).toEqual(expect.arrayContaining([
      expect.objectContaining({ googleCustomerId: '1000000000', active: false, managedSelected: false, googleAccessible: true }),
      expect.objectContaining({ googleCustomerId: '2000000000', active: false, managedSelected: false, googleAccessible: true }),
    ]))
    for (const conflict of db.capture.conflicts as { set: Record<string, unknown> }[]) {
      expect(conflict.set).not.toHaveProperty('managedSelected')
      expect(conflict.set).not.toHaveProperty('managementPriority')
    }
    expect(mocks.reconcile).toHaveBeenCalledWith(db.db, workspaceId, 3)
    expect(db.capture.values).toContainEqual(expect.objectContaining({ milestone: 'accounts_synced' }))
  })
  it('records even an empty complete inventory so an older response cannot restore missing accounts', async () => {
    const db = database()
    await persistSystemGoogleAccountInventory({ ...input, managedCustomers: [], recordActivation: false })
    expect(db.capture.values).toEqual([expect.objectContaining({ action: input.action, metadata: expect.objectContaining({ accessibleCount: 0, observedAt: input.observedAt.toISOString() }) })])
    expect(db.capture.sets[0]).toMatchObject({ googleAccessible: false })
  })
  it('skips an older or duplicate response before replacing inventory', async () => {
    const db = database({ metadata: { observedAt: input.observedAt.toISOString() } })
    expect((await persistSystemGoogleAccountInventory(input)).skipped).toBe(true)
    expect(db.capture.values).toEqual([])
    expect(db.capture.sets).toEqual([])
  })
  it.each([null, { ...connection, encryptedRefreshToken: 'new-credentials' }])('rejects a changed or revoked connection', async (current) => {
    const db = database(undefined, current)
    await expect(persistTenantGoogleAccountInventory(input)).rejects.toThrow('connection changed')
    expect(db.capture.sets).toEqual([])
  })
  it('deduplicates equivalent normalized accounts and rejects conflicting metadata before writes', async () => {
    const db = database()
    await persistTenantGoogleAccountInventory({ ...input, managedCustomers: [customers[0], { ...customers[0], customerId: '1000000000' }] })
    expect(db.capture.conflicts).toHaveLength(1)
    const conflict = database()
    await expect(persistTenantGoogleAccountInventory({ ...input, managedCustomers: [customers[0], { ...customers[0], name: 'Conflicting' }] })).rejects.toThrow('Conflicting')
    expect(conflict.capture.sets).toEqual([])
  })
  it('rejects invalid observation dates and customer identifiers', async () => {
    database()
    await expect(persistTenantGoogleAccountInventory({ ...input, observedAt: new Date('invalid') })).rejects.toThrow('observation')
    await expect(persistTenantGoogleAccountInventory({ ...input, managedCustomers: [{ ...customers[0], customerId: '1' }] })).rejects.toThrow('10 digits')
  })
})
