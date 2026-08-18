import type Stripe from 'stripe'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cancelStripeScheduledPlanChange, requestStripePlanChange } from './stripe-plan-change'

const periodStart = 1_787_000_000
const periodEnd = 1_789_592_000

function subscription(input: Partial<Stripe.Subscription> = {}) {
  return {
    id: 'sub_123',
    status: 'active',
    customer: 'cus_123',
    metadata: { workspaceId: 'ws_123' },
    schedule: null,
    pending_update: null,
    items: {
      data: [{
        id: 'si_123',
        quantity: 1,
        current_period_start: periodStart,
        current_period_end: periodEnd,
        price: { id: 'price_solo', currency: 'eur', recurring: { interval: 'month' } },
      }],
    },
    ...input,
  } as unknown as Stripe.Subscription
}

function stripeDouble(current: Stripe.Subscription) {
  const subscriptions = {
    retrieve: vi.fn(async () => current),
    update: vi.fn(async () => ({ ...current, pending_update: { expires_at: periodEnd } })),
  }
  const subscriptionSchedules = {
    create: vi.fn(async () => ({
      id: 'sub_sched_123', metadata: {}, current_phase: { start_date: periodStart, end_date: periodEnd },
    })),
    retrieve: vi.fn(async () => ({
      id: 'sub_sched_123', metadata: {}, current_phase: { start_date: periodStart, end_date: periodEnd },
    })),
    update: vi.fn(async () => ({ id: 'sub_sched_123' })),
    release: vi.fn(async () => ({ id: 'sub_sched_123' })),
  }
  return {
    stripe: { subscriptions, subscriptionSchedules } as unknown as Stripe,
    subscriptions,
    subscriptionSchedules,
  }
}

describe('Stripe plan changes', () => {
  beforeEach(() => {
    process.env.STRIPE_PRICE_SOLO = 'price_solo'
    process.env.STRIPE_PRICE_STUDIO = 'price_studio'
    process.env.STRIPE_PRICE_AGENCY = 'price_agency'
  })

  afterEach(() => vi.restoreAllMocks())

  it('requests an invoiced pending update for an upgrade', async () => {
    const mock = stripeDouble(subscription())
    const result = await requestStripePlanChange({
      stripe: mock.stripe,
      subscriptionId: 'sub_123',
      workspaceId: 'ws_123',
      currentPlan: 'solo',
      targetPlan: 'studio',
    })

    expect(mock.subscriptions.update).toHaveBeenCalledWith('sub_123', expect.objectContaining({
      items: [{ id: 'si_123', price: 'price_studio', quantity: 1 }],
      payment_behavior: 'pending_if_incomplete',
      proration_behavior: 'always_invoice',
    }), expect.objectContaining({ idempotencyKey: expect.stringContaining('plan-upgrade:ws_123:studio') }))
    expect(result).toMatchObject({ mode: 'upgrade', paymentPending: true, effectiveAt: null })
  })

  it('programs a downgrade at the exact end of the current phase', async () => {
    const mock = stripeDouble(subscription())
    const result = await requestStripePlanChange({
      stripe: mock.stripe,
      subscriptionId: 'sub_123',
      workspaceId: 'ws_123',
      currentPlan: 'solo',
      targetPlan: 'solo',
    }).catch((error) => error)
    expect(result).toBeInstanceOf(Error)

    const agency = stripeDouble(subscription({
      items: { data: [{
        id: 'si_123', quantity: 1, current_period_start: periodStart, current_period_end: periodEnd,
        price: { id: 'price_agency', currency: 'eur', recurring: { interval: 'month' } },
      }] } as Stripe.ApiList<Stripe.SubscriptionItem>,
    }))
    const downgrade = await requestStripePlanChange({
      stripe: agency.stripe,
      subscriptionId: 'sub_123',
      workspaceId: 'ws_123',
      currentPlan: 'agency',
      targetPlan: 'studio',
    })
    expect(agency.subscriptionSchedules.create).toHaveBeenCalledWith(
      { from_subscription: 'sub_123' }, expect.any(Object),
    )
    expect(agency.subscriptionSchedules.update).toHaveBeenCalledWith('sub_sched_123', expect.objectContaining({
      end_behavior: 'release',
      proration_behavior: 'none',
      phases: [
        expect.objectContaining({ end_date: periodEnd, items: [{ price: 'price_agency', quantity: 1 }] }),
        expect.objectContaining({ start_date: periodEnd, duration: { interval: 'month', interval_count: 1 }, items: [{ price: 'price_studio', quantity: 1 }] }),
      ],
    }), expect.any(Object))
    expect(downgrade).toMatchObject({ mode: 'downgrade', paymentPending: false, stripeReference: 'sub_sched_123' })
    expect(downgrade.effectiveAt).toEqual(new Date(periodEnd * 1000))
  })

  it('refuses an upgrade while a schedule exists and releases a scheduled change explicitly', async () => {
    const current = subscription({ schedule: 'sub_sched_123' })
    const mock = stripeDouble(current)
    await expect(requestStripePlanChange({
      stripe: mock.stripe,
      subscriptionId: 'sub_123', workspaceId: 'ws_123', currentPlan: 'solo', targetPlan: 'studio',
    })).rejects.toThrow('Annulez d’abord')

    await expect(cancelStripeScheduledPlanChange({
      stripe: mock.stripe, subscriptionId: 'sub_123', workspaceId: 'ws_123',
    })).resolves.toBe('sub_sched_123')
    expect(mock.subscriptionSchedules.release).toHaveBeenCalledWith(
      'sub_sched_123', { preserve_cancel_date: true }, expect.objectContaining({ idempotencyKey: expect.any(String) }),
    )
  })

  it('fails closed on missing prices and inconsistent recurring items', async () => {
    delete process.env.STRIPE_PRICE_STUDIO
    const missingPrice = stripeDouble(subscription())
    await expect(requestStripePlanChange({
      stripe: missingPrice.stripe, subscriptionId: 'sub_123', workspaceId: 'ws_123', currentPlan: 'solo', targetPlan: 'studio',
    })).rejects.toThrow('n’est pas configuré')

    process.env.STRIPE_PRICE_STUDIO = 'price_studio'
    const noRecurring = stripeDouble(subscription({ items: { data: [] } as unknown as Stripe.ApiList<Stripe.SubscriptionItem> }))
    await expect(requestStripePlanChange({
      stripe: noRecurring.stripe, subscriptionId: 'sub_123', workspaceId: 'ws_123', currentPlan: 'solo', targetPlan: 'studio',
    })).rejects.toThrow('expected_one_recurring_item:0')
  })

  it.each([
    ['foreign workspace', { metadata: { workspaceId: 'ws_other' } }, 'n’appartient pas'],
    ['unknown price', { items: { data: [{ id: 'si_123', quantity: 1, current_period_start: periodStart, current_period_end: periodEnd, price: { id: 'price_unknown', currency: 'eur', recurring: { interval: 'month' } } }] } }, 'doit être réconcilié'],
    ['different plan', { items: { data: [{ id: 'si_123', quantity: 1, current_period_start: periodStart, current_period_end: periodEnd, price: { id: 'price_studio', currency: 'eur', recurring: { interval: 'month' } } }] } }, 'ne correspond pas'],
    ['inactive subscription', { status: 'past_due' }, 'indisponible'],
  ])('rejects an authoritative subscription with %s', async (_label, overrides, message) => {
    const mock = stripeDouble(subscription(overrides as Partial<Stripe.Subscription>))
    await expect(requestStripePlanChange({
      stripe: mock.stripe, subscriptionId: 'sub_123', workspaceId: 'ws_123', currentPlan: 'solo', targetPlan: 'studio',
    })).rejects.toThrow(message)
  })

  it('rejects pending upgrades and incomplete or drifting downgrade schedules', async () => {
    const studioItems = { data: [{
      id: 'si_123', quantity: 1, current_period_start: periodStart, current_period_end: periodEnd,
      price: { id: 'price_studio', currency: 'eur', recurring: { interval: 'month' } },
    }] } as Stripe.ApiList<Stripe.SubscriptionItem>
    const pending = stripeDouble(subscription({ pending_update: { expires_at: periodEnd } as never, items: studioItems }))
    await expect(requestStripePlanChange({
      stripe: pending.stripe, subscriptionId: 'sub_123', workspaceId: 'ws_123', currentPlan: 'studio', targetPlan: 'solo',
    })).rejects.toThrow('paiement')

    const missingPhase = stripeDouble(subscription({
      items: { data: [{ id: 'si_123', quantity: 1, current_period_start: periodStart, current_period_end: periodEnd, price: { id: 'price_studio', currency: 'eur', recurring: { interval: 'month' } } }] } as Stripe.ApiList<Stripe.SubscriptionItem>,
    }))
    missingPhase.subscriptionSchedules.create.mockResolvedValueOnce({ id: 'sub_sched_123', metadata: {}, current_phase: null } as never)
    await expect(requestStripePlanChange({
      stripe: missingPhase.stripe, subscriptionId: 'sub_123', workspaceId: 'ws_123', currentPlan: 'studio', targetPlan: 'solo',
    })).rejects.toThrow('période courante')

    const drifting = stripeDouble(subscription({
      items: { data: [{ id: 'si_123', quantity: 1, current_period_start: periodStart, current_period_end: periodEnd, price: { id: 'price_studio', currency: 'eur', recurring: { interval: 'month' } } }] } as Stripe.ApiList<Stripe.SubscriptionItem>,
    }))
    drifting.subscriptionSchedules.create.mockImplementationOnce(async () => {
      process.env.STRIPE_PRICE_STUDIO = 'price_changed'
      return { id: 'sub_sched_123', metadata: {}, current_phase: { start_date: periodStart, end_date: periodEnd } }
    })
    await expect(requestStripePlanChange({
      stripe: drifting.stripe, subscriptionId: 'sub_123', workspaceId: 'ws_123', currentPlan: 'studio', targetPlan: 'solo',
    })).rejects.toThrow('Price Stripe courant')
  })

  it('validates scheduled-change ownership and presence before release', async () => {
    const foreign = stripeDouble(subscription({ metadata: { workspaceId: 'ws_other' }, schedule: 'sub_sched_123' }))
    await expect(cancelStripeScheduledPlanChange({ stripe: foreign.stripe, subscriptionId: 'sub_123', workspaceId: 'ws_123' }))
      .rejects.toThrow('n’appartient pas')
    const absent = stripeDouble(subscription())
    await expect(cancelStripeScheduledPlanChange({ stripe: absent.stripe, subscriptionId: 'sub_123', workspaceId: 'ws_123' }))
      .rejects.toThrow('Aucun changement')
  })
})
