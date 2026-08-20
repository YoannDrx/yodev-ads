import type Stripe from 'stripe'
import { afterEach, describe, expect, it } from 'vitest'
import {
  accountLimitForPlan,
  accessStateForSubscription,
  accountsWithinPlan,
  billingPortalConfigurationId,
  checkoutTaxConfiguration,
  chargeRefundRecord,
  planFeaturesForLocale,
  planFromPriceId,
  shouldNotifyInvoiceEvent,
  subscriptionIsActive,
  subscriptionRecord,
  taxCheckoutCopy,
} from '@/lib/billing'

describe('billing plans', () => {
  const originalStudioPrice = process.env.STRIPE_PRICE_STUDIO
  const originalTaxMode = process.env.STRIPE_TAX_MODE
  const originalTaxValidation = process.env.STRIPE_TAX_CONFIGURATION_VALIDATED
  const originalPortalConfiguration = process.env.STRIPE_PORTAL_CONFIGURATION_ID

  afterEach(() => {
    if (originalStudioPrice) process.env.STRIPE_PRICE_STUDIO = originalStudioPrice
    else delete process.env.STRIPE_PRICE_STUDIO
    if (originalTaxMode) process.env.STRIPE_TAX_MODE = originalTaxMode
    else delete process.env.STRIPE_TAX_MODE
    if (originalTaxValidation) process.env.STRIPE_TAX_CONFIGURATION_VALIDATED = originalTaxValidation
    else delete process.env.STRIPE_TAX_CONFIGURATION_VALIDATED
    if (originalPortalConfiguration) process.env.STRIPE_PORTAL_CONFIGURATION_ID = originalPortalConfiguration
    else delete process.env.STRIPE_PORTAL_CONFIGURATION_ID
  })

  it('provides plan features in both supported commercial locales', () => {
    expect(planFeaturesForLocale('solo', 'fr')).toContain('Vigies quotidiennes')
    expect(planFeaturesForLocale('solo', 'en')).toContain('Daily monitors')
    expect(planFeaturesForLocale('agency', 'en')).toContain('White label')
  })

  it('blocks checkout until the tax mode is explicitly and safely configured', () => {
    delete process.env.STRIPE_TAX_MODE
    expect(() => checkoutTaxConfiguration()).toThrow('STRIPE_TAX_MODE')

    process.env.STRIPE_TAX_MODE = 'exempt_293b'
    expect(checkoutTaxConfiguration()).toEqual({ mode: 'exempt_293b', automaticTax: { enabled: false } })

    process.env.STRIPE_TAX_MODE = 'stripe_tax'
    delete process.env.STRIPE_TAX_CONFIGURATION_VALIDATED
    expect(() => checkoutTaxConfiguration()).toThrow('validé juridiquement')
    process.env.STRIPE_TAX_CONFIGURATION_VALIDATED = '1'
    expect(checkoutTaxConfiguration()).toEqual({ mode: 'stripe_tax', automaticTax: { enabled: true } })
  })

  it('fails closed unless the billing portal uses an explicit Stripe configuration', () => {
    delete process.env.STRIPE_PORTAL_CONFIGURATION_ID
    expect(() => billingPortalConfigurationId()).toThrow('STRIPE_PORTAL_CONFIGURATION_ID')
    process.env.STRIPE_PORTAL_CONFIGURATION_ID = 'invalid'
    expect(() => billingPortalConfigurationId()).toThrow('invalide')
    process.env.STRIPE_PORTAL_CONFIGURATION_ID = 'bpc_yodev_ads'
    expect(billingPortalConfigurationId()).toBe('bpc_yodev_ads')
  })

  it('provides explicit checkout and invoice wording for each tax mode', () => {
    expect(taxCheckoutCopy('exempt_293b', 'fr')).toMatchObject({
      checkoutMessage: expect.stringContaining('293 B'),
      invoiceFooter: expect.stringContaining('TVA non applicable'),
    })
    expect(taxCheckoutCopy('exempt_293b', 'en').checkoutMessage).toContain('VAT not applicable')
    expect(taxCheckoutCopy('stripe_tax', 'en')).toMatchObject({ checkoutMessage: expect.stringContaining('calculated'), invoiceFooter: '' })
  })

  it('applies deterministic account limits and active states', () => {
    expect(accountLimitForPlan('solo')).toBe(3)
    expect(accountLimitForPlan('studio')).toBe(15)
    expect(accountLimitForPlan('unknown')).toBe(3)
    expect(subscriptionIsActive('trialing')).toBe(true)
    expect(subscriptionIsActive('past_due')).toBe(false)
  })

  it('maps Stripe lifecycle states without cutting access before cancellation completes', () => {
    const at = new Date('2026-08-12T10:00:00Z')
    expect(accessStateForSubscription('active', at)).toEqual({ accessState: 'active', graceEndsAt: null })
    expect(accessStateForSubscription('past_due', at)).toEqual({
      accessState: 'grace',
      graceEndsAt: new Date('2026-08-19T10:00:00Z'),
    })
    expect(accessStateForSubscription('canceled', at)).toEqual({ accessState: 'suspended', graceEndsAt: null })
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
      metadata: { workspaceId: 'workspace-1', plan: 'solo' },
      items: { data: [{ price: { id: 'price_studio', currency: 'eur', recurring: { interval: 'month' } }, quantity: 1, current_period_end: 1_800_000_000 }] },
    } as unknown as Stripe.Subscription
    expect(subscriptionRecord(subscription)).toMatchObject({
      workspaceId: 'workspace-1',
      plan: 'studio',
      stripeCustomerId: 'cus_123',
      stripeSubscriptionId: 'sub_123',
      subscriptionStatus: 'active',
      reconciliationReason: null,
    })
  })

  it('never trusts plan metadata and rejects unknown or ambiguous recurring items', () => {
    process.env.STRIPE_PRICE_STUDIO = 'price_studio'
    const base = {
      id: 'sub_123', customer: 'cus_123', status: 'active', metadata: { workspaceId: 'workspace-1', plan: 'solo' },
    }
    expect(subscriptionRecord({
      ...base,
      items: { data: [{ price: { id: 'price_studio', currency: 'eur', recurring: { interval: 'month' } }, quantity: 1, current_period_end: 1_800_000_000 }] },
    } as unknown as Stripe.Subscription).plan).toBe('studio')
    expect(subscriptionRecord({
      ...base,
      items: { data: [{ price: { id: 'price_unknown', currency: 'eur', recurring: { interval: 'month' } }, quantity: 1, current_period_end: 1_800_000_000 }] },
    } as unknown as Stripe.Subscription)).toMatchObject({ plan: undefined, reconciliationReason: 'unknown_price:price_unknown' })
    expect(subscriptionRecord({
      ...base,
      items: { data: [
        { price: { id: 'price_studio', currency: 'eur', recurring: { interval: 'month' } }, quantity: 1, current_period_end: 1_800_000_000 },
        { price: { id: 'price_studio', currency: 'eur', recurring: { interval: 'month' } }, quantity: 1, current_period_end: 1_800_000_000 },
      ] },
    } as unknown as Stripe.Subscription).reconciliationReason).toBe('expected_one_recurring_item:2')
  })

  it('maps successful partial and full refunds without changing subscription access', () => {
    expect(chargeRefundRecord({
      id: 'ch_partial',
      customer: 'cus_123',
      payment_intent: 'pi_123',
      currency: 'eur',
      amount: 8900,
      amount_refunded: 2900,
      refunded: false,
    } as Stripe.Charge)).toEqual({
      customerId: 'cus_123',
      chargeId: 'ch_partial',
      paymentIntentId: 'pi_123',
      currency: 'EUR',
      originalAmount: 8900,
      refundedAmount: 2900,
      fullyRefunded: false,
    })
    expect(chargeRefundRecord({
      id: 'ch_full', customer: 'cus_123', payment_intent: null, currency: 'eur', amount: 2900,
      amount_refunded: 2900, refunded: true,
    } as Stripe.Charge)?.fullyRefunded).toBe(true)
    expect(chargeRefundRecord({
      id: 'ch_none', customer: null, currency: 'eur', amount: 2900, amount_refunded: 0, refunded: false,
    } as Stripe.Charge)).toBeNull()
  })

  it('suppresses stale invoice notifications unless they match the authoritative subscription state', () => {
    const eventCreatedAt = new Date('2026-08-12T10:00:00Z')
    const stateAppliedAt = new Date('2026-08-12T10:00:05Z')
    expect(shouldNotifyInvoiceEvent({ type: 'invoice.payment_failed', eventCreatedAt, stateAppliedAt, subscriptionStatus: 'active' })).toBe(false)
    expect(shouldNotifyInvoiceEvent({ type: 'invoice.payment_failed', eventCreatedAt, stateAppliedAt, subscriptionStatus: 'past_due' })).toBe(true)
    expect(shouldNotifyInvoiceEvent({ type: 'invoice.paid', eventCreatedAt, stateAppliedAt, subscriptionStatus: 'active' })).toBe(true)
    expect(shouldNotifyInvoiceEvent({ type: 'invoice.paid', eventCreatedAt, stateAppliedAt: null, subscriptionStatus: 'past_due' })).toBe(true)
  })
})
