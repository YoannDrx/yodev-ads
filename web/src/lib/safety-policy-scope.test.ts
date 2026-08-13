import { describe, expect, it } from 'vitest'
import { assertSafetyPolicyScope } from '@/lib/safety-policy-scope'

describe('safety policy plan scopes', () => {
  it('enforces workspace, client and campaign scope entitlements', () => {
    expect(assertSafetyPolicyScope('solo', 'workspace')).toBe('workspace')
    expect(() => assertSafetyPolicyScope('solo', 'client')).toThrow('Studio')
    expect(assertSafetyPolicyScope('studio', 'client')).toBe('client')
    expect(() => assertSafetyPolicyScope('studio', 'campaign')).toThrow('Agency')
    expect(assertSafetyPolicyScope('agency', 'campaign')).toBe('campaign')
    expect(assertSafetyPolicyScope('internal', 'campaign')).toBe('campaign')
  })
})
