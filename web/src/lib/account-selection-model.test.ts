import { describe, expect, it } from 'vitest'
import { accountSelectionPreview, selectedAccountsWithinLimit, type AccountSelection } from './account-selection-model'

function accounts(count = 60): AccountSelection[] {
  return Array.from({ length: count }, (_, index) => ({ id: `account-${index}`, googleCustomerId: String(1000000000 + index), isManager: false,
    googleAccessible: true, managedSelected: true, managementPriority: index + 1, active: true }))
}
describe('managed account preferences and effective quotas', () => {
  it.each([3, 15, 50])('keeps the chosen priority order at quota %s without consuming slots for nested managers', (limit) => {
    const input = accounts()
    const managers = [{ ...input[0], id: 'root', isManager: true }, { ...input[1], id: 'nested', isManager: true }]
    input[55].managementPriority = 0
    const result = selectedAccountsWithinLimit([...input.reverse(), ...managers], limit)
    expect(result.includedAdvertisers).toHaveLength(limit)
    expect(result.includedAdvertisers[0].id).toBe('account-55')
    expect(result.included).toHaveLength(limit + 2)
    expect(result.excluded).toHaveLength(60 - limit)
  })
  it('does not auto-select a newly accessible account or replace unavailable preferences with an unselected account', () => {
    const input = accounts(5)
    input[0].googleAccessible = false
    input[1].managedSelected = false
    const result = selectedAccountsWithinLimit(input, 3)
    expect(result.includedAdvertisers.map((account) => account.id)).toEqual(['account-2', 'account-3', 'account-4'])
    expect(input[0].managedSelected).toBe(true)
    expect(input[1].managedSelected).toBe(false)
  })
  it('previews exactly which active accounts a downgrade suspends and an upgrade restores', () => {
    const input = accounts(15)
    const downgrade = accountSelectionPreview(input, 3)
    expect(downgrade.deactivated.map((account) => account.id)).toEqual(input.slice(3).map((account) => account.id))
    const reduced = input.map((account, index) => ({ ...account, active: index < 3 }))
    const upgrade = accountSelectionPreview(reduced, 15)
    expect(upgrade.activated.map((account) => account.id)).toEqual(input.slice(3).map((account) => account.id))
    expect(upgrade.deactivated).toEqual([])
  })
  it('uses a deterministic tie-breaker and supports unlimited or zero quotas', () => {
    const input = accounts(5).map((account) => ({ ...account, managementPriority: 1000 }))
    expect(selectedAccountsWithinLimit([...input].reverse(), 3).includedAdvertisers).toEqual(input.slice(0, 3))
    expect(selectedAccountsWithinLimit(input, null).includedAdvertisers).toHaveLength(5)
    expect(selectedAccountsWithinLimit(input, 0).includedAdvertisers).toHaveLength(0)
    expect(() => selectedAccountsWithinLimit(input, -1)).toThrow('quota')
  })
})
