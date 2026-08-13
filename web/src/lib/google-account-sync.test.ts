import { beforeEach, describe, expect, it, vi } from 'vitest'
import { databaseDouble } from '../../test/fluent-db'

const mocks = vi.hoisted(() => ({
  tenantDatabases: [] as unknown[],
  systemDatabases: [] as unknown[],
  tenantContexts: [] as unknown[],
  tenant: vi.fn(async (context: unknown, callback: (db: unknown) => unknown) => {
    mocks.tenantContexts.push(context)
    return callback(mocks.tenantDatabases.shift())
  }),
  system: vi.fn(async (callback: (db: unknown) => unknown) => callback(mocks.systemDatabases.shift())),
}))

vi.mock('@/db/transactions', () => ({
  withTenantTransaction: mocks.tenant,
  withSystemTransaction: mocks.system,
}))

import {
  persistSystemGoogleAccountInventory,
  persistTenantGoogleAccountInventory,
  type ManagedGoogleCustomer,
} from './google-account-sync'

const workspaceId = '00000000-0000-4000-8000-000000000001'
const customers: ManagedGoogleCustomer[] = [
  { customerId: '100-000-0000', name: 'Manager', currencyCode: 'EUR', timezone: 'Europe/Paris', isManager: true },
  { customerId: '200-000-0000', name: 'A', currencyCode: 'EUR', timezone: 'Europe/Paris', isManager: false },
  { customerId: '300-000-0000', name: 'B', currencyCode: 'EUR', timezone: 'Europe/Paris', isManager: false },
  { customerId: '400-000-0000', name: 'C', currencyCode: 'EUR', timezone: 'Europe/Paris', isManager: false },
  { customerId: '500-000-0000', name: 'D', currencyCode: 'EUR', timezone: 'Europe/Paris', isManager: false },
]

describe('Google account inventory repository', () => {
  beforeEach(() => {
    mocks.tenantDatabases = []
    mocks.systemDatabases = []
    mocks.tenantContexts = []
    vi.clearAllMocks()
  })

  it('replaces a complete inventory atomically, applies quota and records activation for a user sync', async () => {
    const database = databaseDouble()
    mocks.tenantDatabases.push(database.db)
    const result = await persistTenantGoogleAccountInventory({
      workspaceId,
      actorUserId: 'user-1',
      connectionId: 'connection-1',
      managedCustomers: customers,
      advertiserLimit: 3,
      plan: 'solo',
      action: 'google_ads.accounts_synced',
      recordActivation: true,
    })
    expect(result.included).toHaveLength(4)
    expect(result.excluded.map((customer) => customer.customerId)).toEqual(['500-000-0000'])
    expect(database.capture.sets[0]).toMatchObject({ active: false })
    expect(database.capture.values.slice(0, 5)).toEqual(expect.arrayContaining([
      expect.objectContaining({ googleCustomerId: '1000000000', active: true }),
      expect.objectContaining({ googleCustomerId: '4000000000', active: true }),
      expect.objectContaining({ googleCustomerId: '5000000000', active: false }),
    ]))
    expect(database.capture.values).toContainEqual(expect.objectContaining({ action: 'google_ads.accounts_synced' }))
    expect(database.capture.values).toContainEqual(expect.objectContaining({ milestone: 'accounts_synced' }))
    expect(mocks.tenantContexts).toEqual([{ workspaceId, userId: 'user-1' }])
  })

  it('supports unlimited system reconciliation without recording a duplicate activation milestone', async () => {
    const database = databaseDouble()
    mocks.systemDatabases.push(database.db)
    const result = await persistSystemGoogleAccountInventory({
      workspaceId,
      actorUserId: 'system:billing-account-sync',
      connectionId: 'connection-1',
      managedCustomers: customers,
      advertiserLimit: null,
      plan: 'internal',
      action: 'google_ads.accounts_synced_after_plan_change',
      recordActivation: false,
    })
    expect(result.excluded).toEqual([])
    expect(result.included).toHaveLength(5)
    expect(database.capture.values).not.toContainEqual(expect.objectContaining({ milestone: 'accounts_synced' }))
    expect(database.capture.values).toContainEqual(expect.objectContaining({
      action: 'google_ads.accounts_synced_after_plan_change',
      metadata: expect.objectContaining({ advertiserLimit: null }),
    }))
  })
})
