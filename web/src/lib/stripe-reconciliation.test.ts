import type Stripe from 'stripe'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { databaseDouble } from '../../test/fluent-db'

const mocks = vi.hoisted(() => ({
  databases: [] as unknown[],
  transaction: vi.fn(async (callback: (db: unknown) => unknown) => callback(mocks.databases.shift())),
  retrieve: vi.fn(),
}))

vi.mock('@/db/transactions', () => ({ withSystemTransaction: mocks.transaction }))

import { reconcileStripeWorkspace } from './stripe-reconciliation'

const workspaceId = '00000000-0000-4000-8000-000000000001'
const periodEnd = new Date('2026-09-16T00:00:00.000Z')

function stripeSubscription(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sub_1',
    customer: 'cus_1',
    status: 'active',
    metadata: { workspaceId },
    items: { data: [{
      price: { id: 'price_studio', currency: 'eur', recurring: { interval: 'month' } },
      quantity: 1,
      current_period_end: Math.floor(periodEnd.getTime() / 1000),
    }] },
    ...overrides,
  } as unknown as Stripe.Subscription
}

function stripeDouble(input: {
  subscription?: Stripe.Subscription
  customer?: Stripe.Customer | Stripe.DeletedCustomer
  invoices?: Stripe.Invoice[]
  schedule?: Stripe.SubscriptionSchedule
} = {}) {
  return {
    subscriptions: { retrieve: vi.fn(async () => input.subscription ?? stripeSubscription()) },
    customers: { retrieve: vi.fn(async () => input.customer ?? ({ id: 'cus_1', deleted: false })) },
    invoices: { list: vi.fn(async () => ({ data: input.invoices ?? [] })) },
    subscriptionSchedules: { retrieve: vi.fn(async () => input.schedule) },
  } as unknown as Stripe
}

function localWorkspace(overrides: Record<string, unknown> = {}) {
  return {
    id: workspaceId,
    plan: 'studio',
    requestedPlan: null,
    stripeCustomerId: 'cus_1',
    stripeSubscriptionId: 'sub_1',
    subscriptionStatus: 'active',
    subscriptionCurrentPeriodEnd: periodEnd,
    billingReconciliationRequired: false,
    billingReconciliationReason: null,
    ...overrides,
  }
}

describe('daily Stripe reconciliation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.databases = []
    process.env.STRIPE_PRICE_SOLO = 'price_solo'
    process.env.STRIPE_PRICE_STUDIO = 'price_studio'
  })

  afterEach(() => {
    delete process.env.STRIPE_PRICE_SOLO
    delete process.env.STRIPE_PRICE_STUDIO
  })

  it('clears the reconciliation gate when local and authoritative Stripe states match', async () => {
    const lookup = databaseDouble({
      query: { workspaces: { findFirst: vi.fn(async () => localWorkspace()) } },
    })
    const persistence = databaseDouble()
    mocks.databases.push(lookup.db, persistence.db)
    mocks.retrieve.mockResolvedValue(stripeSubscription())

    await expect(reconcileStripeWorkspace(workspaceId, {
      subscriptions: { retrieve: mocks.retrieve },
      customers: { retrieve: vi.fn(async () => ({ id: 'cus_1', deleted: false })) },
      invoices: { list: vi.fn(async () => ({ data: [{ id: 'in_1', status: 'paid', paid: true }] })) },
      subscriptionSchedules: { retrieve: vi.fn() },
    } as unknown as Stripe)).resolves.toEqual({ workspaceId, reconciled: true, differences: [] })
    expect(persistence.capture.sets[0]).toMatchObject({
      billingReconciliationRequired: false,
      billingReconciliationReason: null,
    })
    expect(persistence.capture.values).toHaveLength(0)
  })

  it('blocks checkout and audits unknown prices and divergent local state', async () => {
    const lookup = databaseDouble({
      query: { workspaces: { findFirst: vi.fn(async () => localWorkspace({ plan: 'solo', subscriptionStatus: 'past_due' })) } },
    })
    const persistence = databaseDouble()
    mocks.databases.push(lookup.db, persistence.db)
    mocks.retrieve.mockResolvedValue(stripeSubscription({
      items: { data: [{
        price: { id: 'price_unknown', currency: 'eur', recurring: { interval: 'month' } },
        quantity: 1,
        current_period_end: Math.floor(periodEnd.getTime() / 1000),
      }] },
    }))

    const result = await reconcileStripeWorkspace(workspaceId, {
      subscriptions: { retrieve: mocks.retrieve },
      customers: { retrieve: vi.fn(async () => ({ id: 'cus_1', deleted: false })) },
      invoices: { list: vi.fn(async () => ({ data: [{ id: 'in_1', status: 'open', paid: false }] })) },
      subscriptionSchedules: { retrieve: vi.fn() },
    } as unknown as Stripe)
    expect(result.reconciled).toBe(false)
    expect(result.differences).toEqual(expect.arrayContaining(['unknown_price:price_unknown', 'status:past_due->active', 'latest_invoice_unpaid:in_1']))
    expect(persistence.capture.sets[0]).toMatchObject({ billingReconciliationRequired: true })
    expect(persistence.capture.values[0]).toMatchObject({
      action: 'billing.reconciliation_required',
      metadata: expect.objectContaining({ subscriptionId: 'sub_1' }),
    })
  })

  it('persists provider retrieval failures before allowing the job to retry', async () => {
    const lookup = databaseDouble({
      query: { workspaces: { findFirst: vi.fn(async () => localWorkspace()) } },
    })
    const persistence = databaseDouble()
    mocks.databases.push(lookup.db, persistence.db)
    mocks.retrieve.mockRejectedValue(new Error('stripe unavailable'))

    await expect(reconcileStripeWorkspace(workspaceId, {
      subscriptions: { retrieve: mocks.retrieve },
      customers: { retrieve: vi.fn() },
      invoices: { list: vi.fn() },
      subscriptionSchedules: { retrieve: vi.fn() },
    } as unknown as Stripe)).rejects.toThrow('stripe unavailable')
    expect(persistence.capture.sets[0]).toMatchObject({
      billingReconciliationRequired: true,
      billingReconciliationReason: 'subscription_retrieve_failed:stripe unavailable',
    })
  })

  it.each([
    undefined,
    localWorkspace({ stripeSubscriptionId: null }),
  ])('rejects a workspace without an attached Stripe subscription', async (workspace) => {
    const lookup = databaseDouble({ query: { workspaces: { findFirst: vi.fn(async () => workspace) } } })
    mocks.databases.push(lookup.db)
    await expect(reconcileStripeWorkspace(workspaceId, stripeDouble())).rejects.toThrow('subscription missing')
  })

  it('collects identity, customer, period and requested-plan differences', async () => {
    const lookup = databaseDouble({
      query: { workspaces: { findFirst: vi.fn(async () => localWorkspace({
        stripeCustomerId: 'cus_local',
        stripeSubscriptionId: 'sub_local',
        subscriptionCurrentPeriodEnd: new Date('2026-01-01T00:00:00.000Z'),
        requestedPlan: null,
      })) } },
    })
    const persistence = databaseDouble()
    mocks.databases.push(lookup.db, persistence.db)
    const subscription = stripeSubscription({
      id: 'sub_provider',
      customer: { id: 'cus_provider' },
      metadata: { workspaceId: '00000000-0000-4000-8000-000000000099' },
      schedule: { id: 'sched_1' },
    })
    const schedule = {
      current_phase: { start_date: 1_780_000_000, end_date: 1_800_000_000 },
      phases: [{ start_date: 1_800_000_000, end_date: 1_900_000_000, items: [{ price: 'price_solo' }] }],
    } as unknown as Stripe.SubscriptionSchedule
    const result = await reconcileStripeWorkspace(workspaceId, stripeDouble({
      subscription,
      customer: { id: 'cus_provider', deleted: true } as Stripe.DeletedCustomer,
      schedule,
    }))
    expect(result.differences).toEqual(expect.arrayContaining([
      'workspace_mismatch', 'customer_mismatch', 'customer_deleted', 'subscription_mismatch',
      'period_end_mismatch', 'requested_plan:none->solo', 'requested_plan_effective_at_mismatch',
    ]))
  })

  it.each([
    [{ current_phase: null, phases: [] }, []],
    [{ current_phase: { end_date: 100 }, phases: [{ start_date: 100, items: [] }] }, ['schedule_items:0']],
    [{ current_phase: { end_date: 100 }, phases: [{ start_date: 100, items: [{ price: { id: 'price_unknown' } }] }] }, ['unknown_schedule_price:price_unknown']],
  ])('reconciles malformed or absent schedule futures', async (scheduleShape, expectedReasons) => {
    const lookup = databaseDouble({
      query: { workspaces: { findFirst: vi.fn(async () => localWorkspace()) } },
    })
    const persistence = databaseDouble()
    mocks.databases.push(lookup.db, persistence.db)
    const subscription = stripeSubscription({ schedule: 'sched_1' })
    const result = await reconcileStripeWorkspace(workspaceId, stripeDouble({
      subscription,
      schedule: scheduleShape as unknown as Stripe.SubscriptionSchedule,
    }))
    expect(result.differences).toEqual(expect.arrayContaining(expectedReasons))
  })

  it('normalizes non-Error provider failures before persisting them', async () => {
    const lookup = databaseDouble({ query: { workspaces: { findFirst: vi.fn(async () => localWorkspace()) } } })
    const persistence = databaseDouble()
    mocks.databases.push(lookup.db, persistence.db)
    const stripe = stripeDouble()
    vi.mocked(stripe.subscriptions.retrieve).mockRejectedValueOnce('offline')
    await expect(reconcileStripeWorkspace(workspaceId, stripe)).rejects.toBe('offline')
    expect(persistence.capture.sets[0]).toMatchObject({ billingReconciliationReason: 'subscription_retrieve_failed:offline' })
  })
})
