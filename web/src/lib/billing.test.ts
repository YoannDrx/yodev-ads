import type Stripe from 'stripe'
import { afterEach, describe, expect, it } from 'vitest'
import {
  accountLimitForPlan,
  accountsWithinPlan,
  planFromPriceId,
  subscriptionIsActive,
  subscriptionRecord,
} from '@/lib/billing'

describe('billing plans', () => {
  const originalStudioPrice = process.env.STRIPE_PRICE_STUDIO

  afterEach(() => {
    if (originalStudioPrice) process.env.STRIPE_PRICE_STUDIO = originalStudioPrice
    else delete process.env.STRIPE_PRICE_STUDIO
  })

  it('applies deterministic account limits and active states', () => {
    expect(accountLimitForPlan('solo')).toBe(3)
    expect(accountLimitForPlan('studio')).toBe(15)
    expect(accountLimitForPlan('unknown')).toBe(3)
    expect(subscriptionIsActive('trialing')).toBe(true)
    expect(subscriptionIsActive('past_due')).toBe(false)
  })

  it('keeps manager accounts while enforcing the advertiser quota deterministically', () => {
    const result = accountsWithinPlan(
      [
        { customerId: '9000000000', isManager: false },
        { customerId: '1000000000', isManager: true },
        { customerId: '5000000000', isManager: false },
        { customerId: '4000000000', isManager: false },
        { customerId: '3000000000', isManager: false },
      ],
      'solo',
    )
    expect(result.included.map((account) => account.customerId)).toEqual([
      '1000000000',
      '3000000000',
      '4000000000',
      '5000000000',
    ])
    expect(result.excluded.map((account) => account.customerId)).toEqual(['9000000000'])
    expect(result.limit).toBe(3)
  })

  it('maps Stripe prices and subscription items to the workspace record', () => {
    process.env.STRIPE_PRICE_STUDIO = 'price_studio'
    expect(planFromPriceId('price_studio')).toBe('studio')
    const subscription = {
      id: 'sub_123',
      customer: 'cus_123',
      status: 'active',
      metadata: { workspaceId: 'workspace-1' },
      items: { data: [{ price: { id: 'price_studio' }, current_period_end: 1_800_000_000 }] },
    } as unknown as Stripe.Subscription
    expect(subscriptionRecord(subscription)).toMatchObject({
      workspaceId: 'workspace-1',
      plan: 'studio',
      stripeCustomerId: 'cus_123',
      stripeSubscriptionId: 'sub_123',
      subscriptionStatus: 'active',
    })
  })
})
