import { afterEach, describe, expect, it } from 'vitest'
import { featureEnabled, featureFlagEnvironment, requireFeature, requireGoogleMutationKind, requireWritableProduct } from '@/lib/feature-flags'

describe('feature flags', () => {
  const originalValues = Object.fromEntries(
    Object.values(featureFlagEnvironment).map((name) => [name, process.env[name]]),
  )

  afterEach(() => {
    for (const name of Object.values(featureFlagEnvironment)) {
      const original = originalValues[name]
      if (original === undefined) delete process.env[name]
      else process.env[name] = original
    }
  })

  it('fails closed when a flag is absent', () => {
    delete process.env.PUBLIC_API_ENABLED
    expect(featureEnabled('publicApi')).toBe(false)
    expect(() => requireFeature('publicApi', 'disabled')).toThrow('disabled')
  })

  it('accepts only explicit binary values', () => {
    process.env.PUBLIC_API_ENABLED = '1'
    expect(featureEnabled('publicApi')).toBe(true)
    process.env.PUBLIC_API_ENABLED = 'true'
    expect(() => featureEnabled('publicApi')).toThrow()
  })

  it('lets the emergency read-only switch override mutation enablement', () => {
    process.env.GOOGLE_MUTATIONS_ENABLED = '1'
    process.env.FORCE_READ_ONLY = '1'
    expect(() => requireWritableProduct()).toThrow('lecture seule')
  })

  it('fails closed independently for each Google mutation family', () => {
    process.env.GOOGLE_MUTATION_BUDGET_ENABLED = '1'
    expect(() => requireGoogleMutationKind('campaign_budget')).not.toThrow()
    expect(() => requireGoogleMutationKind('campaign_status')).toThrow('campaign_status')
    expect(() => requireGoogleMutationKind('budget_reallocation')).toThrow('budget_reallocation')
  })
})
