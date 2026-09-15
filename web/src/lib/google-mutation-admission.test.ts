import { beforeEach, describe, expect, it, vi } from 'vitest'
import { databaseDouble } from '../../test/fluent-db'
import type { DatabaseTransaction } from '@/db/transactions'
import { entitlementContext } from './entitlements'
const lock = vi.hoisted(() => vi.fn())
vi.mock('@/lib/account-selection', () => ({ lockAccountManagement: lock }))
import { admitGoogleMutation } from './google-mutation-admission'

describe('Final mutation admission after account selection changes', () => {
  beforeEach(() => { lock.mockReset(); lock.mockResolvedValue({ entitlements: entitlementContext('active', 'solo') }) })
  function db(kind?: string) { return databaseDouble({ statementResults: [kind ? [{ kind }] : []] }).db as unknown as DatabaseTransaction }
  it('rejects a now-inactive account or unavailable execution before marking dispatch', async () => {
    await expect(admitGoogleMutation(db(), 'workspace', 'execution')).rejects.toThrow('plus disponible')
  })
  it('admits a basic change under current Solo rights', async () => {
    const database = db('campaign_budget')
    await expect(admitGoogleMutation(database, 'workspace', 'execution')).resolves.toBeUndefined()
    expect(lock).toHaveBeenCalledWith(database, 'workspace')
  })
  it('rejects advanced mutations after a downgrade to Solo', async () => {
    await expect(admitGoogleMutation(db('keyword_status'), 'workspace', 'execution')).rejects.toThrow()
  })
  it('rejects batches after a downgrade to Studio', async () => {
    lock.mockResolvedValue({ entitlements: entitlementContext('active', 'studio') })
    await expect(admitGoogleMutation(db('atomic_change_batch'), 'workspace', 'execution')).rejects.toThrow('groupé')
  })
  it('admits batches with current Agency rights', async () => {
    lock.mockResolvedValue({ entitlements: entitlementContext('active', 'agency') })
    await expect(admitGoogleMutation(db('atomic_change_batch'), 'workspace', 'execution')).resolves.toBeUndefined()
  })
})
