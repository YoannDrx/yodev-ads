import { describe, expect, it } from 'vitest'
import { entitlementContext, requireCapability, requireQuota, type Plan } from '@/lib/entitlements'

describe('entitlements', () => {
  it.each([
    ['trial', 1, 3, false],
    ['solo', 3, 5, true],
    ['studio', 15, 50, true],
    ['agency', 50, 200, true],
    ['internal', null, null, true],
  ] as const)('maps %s limits and mutation access', (plan, accounts, monitors, canMutate) => {
    const state = plan === 'internal' ? 'internal' : plan === 'trial' ? 'trial' : 'active'
    const context = entitlementContext(state, plan)
    expect(context.limits.advertiserAccounts).toBe(accounts)
    expect(context.limits.monitors).toBe(monitors)
    expect(context.capabilities.has('google.mutate.basic')).toBe(canMutate)
  })

  it.each(['grace', 'suspended', 'deletion_pending', 'deleted'] as const)(
    'removes external capabilities in %s state',
    (state) => {
      expect(entitlementContext(state, 'agency').capabilities.size).toBe(0)
    },
  )

  it('fails closed on missing capabilities and exhausted quotas', () => {
    const context = entitlementContext('trial', 'trial')
    expect(() => requireCapability(context, 'google.mutate.basic')).toThrowError(/Capability required/)
    expect(() => requireQuota(context, 'advertiserAccounts', 1)).toThrowError(/Quota exceeded/)
    expect(() => requireQuota(context, 'advertiserAccounts', 0)).not.toThrow()
    expect(() => requireQuota(entitlementContext('internal', 'internal'), 'apiKeys', 1_000_000)).not.toThrow()
  })

  it.each(['trial', 'solo', 'studio', 'agency', 'internal'] as Plan[])('always preserves the requested plan shape for %s', (plan) => {
    const state = plan === 'internal' ? 'internal' : plan === 'trial' ? 'trial' : 'active'
    expect(entitlementContext(state, plan).plan).toBe(plan)
  })
})
