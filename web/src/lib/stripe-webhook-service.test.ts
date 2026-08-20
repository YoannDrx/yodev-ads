import type Stripe from 'stripe'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { databaseDouble } from '../../test/fluent-db'

const mocks = vi.hoisted(() => ({
  databases: [] as unknown[],
  transaction: vi.fn(async (callback: (db: unknown) => unknown) => callback(mocks.databases.shift())),
  enqueueJob: vi.fn(),
}))

vi.mock('@/db/transactions', () => ({ withSystemTransaction: mocks.transaction }))
vi.mock('@/lib/jobs', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/jobs')>(),
  enqueueJob: mocks.enqueueJob,
}))

import { processStripeWebhookEvent } from './stripe-webhook-service'

const workspaceId = '00000000-0000-4000-8000-000000000001'

function event(type: Stripe.Event.Type, object: unknown, id = 'evt_1'): Stripe.Event {
  return { id, type, created: 1_786_531_200, data: { object } } as Stripe.Event
}

function queryMap(input: { workspace?: unknown; clients?: unknown[]; googleConnection?: unknown } = {}) {
  return {
    workspaces: { findFirst: vi.fn(async () => input.workspace) },
    clients: { findMany: vi.fn(async () => input.clients ?? []) },
    googleAdsConnections: { findFirst: vi.fn(async () => input.googleConnection) },
  }
}

describe('Stripe webhook durable service', () => {
  beforeEach(() => {
    mocks.databases = []
    vi.clearAllMocks()
    mocks.enqueueJob.mockResolvedValue({ created: true })
    process.env.STRIPE_PRICE_SOLO = 'price_solo'
    process.env.STRIPE_PRICE_STUDIO = 'price_studio'
  })

  it('returns duplicate without applying the provider event twice', async () => {
    mocks.databases.push(databaseDouble({ statementResults: [[], []] }).db)
    await expect(processStripeWebhookEvent(event('invoice.paid', { customer: 'cus_1' })))
      .resolves.toEqual({ duplicate: true })
    expect(mocks.transaction).toHaveBeenCalledTimes(1)
    expect(mocks.enqueueJob).not.toHaveBeenCalled()
  })

  it('audits and enqueues a lifecycle email for a current invoice event', async () => {
    const claim = databaseDouble({ statementResults: [[{ id: 'event-row' }]] })
    const processing = databaseDouble({ query: queryMap({ workspace: {
      id: workspaceId,
      graceEndsAt: null,
      stripeStateAppliedAt: null,
      subscriptionStatus: 'active',
    } }) })
    mocks.databases.push(claim.db, processing.db)
    await expect(processStripeWebhookEvent(event('invoice.paid', { customer: 'cus_1' })))
      .resolves.toEqual({ duplicate: false })
    expect(processing.capture.values[0]).toMatchObject({
      action: 'billing.invoice.paid',
      workspaceId,
    })
    expect(mocks.enqueueJob).toHaveBeenCalledWith(expect.objectContaining({
      type: 'lifecycle.email',
      payload: expect.objectContaining({ workspaceId, kind: 'payment_succeeded' }),
    }))
  })

  it('audits a stale failed invoice without sending a misleading lifecycle email', async () => {
    const claim = databaseDouble({ statementResults: [[{ id: 'event-row' }]] })
    const processing = databaseDouble({ query: queryMap({ workspace: {
      id: workspaceId,
      graceEndsAt: new Date('2026-08-20T00:00:00Z'),
      stripeStateAppliedAt: new Date('2030-01-01T00:00:00Z'),
      subscriptionStatus: 'active',
    } }) })
    mocks.databases.push(claim.db, processing.db)
    await expect(processStripeWebhookEvent(event('invoice.payment_failed', { customer: { id: 'cus_1' } })))
      .resolves.toEqual({ duplicate: false })
    expect(processing.capture.values[0]).toMatchObject({ action: 'billing.invoice_event_ignored_stale' })
    expect(mocks.enqueueJob).not.toHaveBeenCalled()
  })

  it('audits partial refunds and notifies the billing lifecycle without changing access', async () => {
    const claim = databaseDouble({ statementResults: [[{ id: 'event-row' }]] })
    const processing = databaseDouble({ query: queryMap({ workspace: { id: workspaceId } }) })
    mocks.databases.push(claim.db, processing.db)
    await expect(processStripeWebhookEvent(event('charge.refunded', {
      id: 'ch_1',
      customer: 'cus_1',
      payment_intent: { id: 'pi_1' },
      currency: 'eur',
      amount: 2900,
      amount_refunded: 1000,
      refunded: false,
    }))).resolves.toEqual({ duplicate: false })
    expect(processing.capture.values[0]).toMatchObject({
      action: 'billing.charge.refunded',
      metadata: expect.objectContaining({ fullyRefunded: false, refundedAmount: 1000 }),
    })
    expect(mocks.enqueueJob).toHaveBeenCalledWith(expect.objectContaining({
      payload: expect.objectContaining({ kind: 'refund_processed' }),
    }))
  })

  it('normalizes Solo approvals, deactivates over-quota accounts and queues a fresh MCC sync', async () => {
    const claim = databaseDouble({ statementResults: [[{ id: 'event-row' }]] })
    const accounts = ['1000000000', '2000000000', '3000000000', '4000000000'].map((googleCustomerId, index) => ({
      id: `00000000-0000-4000-8000-00000000000${index + 2}`,
      googleCustomerId,
      isManager: false,
      active: true,
    }))
    const processing = databaseDouble({
      statementResults: [[{ id: workspaceId }]],
      query: queryMap({
        workspace: { id: workspaceId, plan: 'studio', accessState: 'active' },
        clients: accounts,
        googleConnection: { id: 'connection-1' },
      }),
    })
    mocks.databases.push(claim.db, processing.db)
    const subscription = {
      id: 'sub_1',
      customer: 'cus_1',
      status: 'active',
      cancel_at_period_end: false,
      metadata: { workspaceId, plan: 'agency' },
      items: { data: [{ price: { id: 'price_solo', currency: 'eur', recurring: { interval: 'month' } }, quantity: 1, current_period_end: 1_800_000_000 }] },
    }
    await expect(processStripeWebhookEvent(event('customer.subscription.updated', subscription)))
      .resolves.toEqual({ duplicate: false })
    expect(processing.capture.sets[0]).toMatchObject({
      plan: 'solo',
      approvalMode: 'single',
      requiredApprovals: 1,
      allowSelfApproval: true,
    })
    expect(processing.capture.sets).toContainEqual(expect.objectContaining({ active: false }))
    expect(processing.capture.values).toContainEqual(expect.objectContaining({
      type: 'google.accounts_sync',
      workspaceId,
    }))
    expect(processing.capture.values).toContainEqual(expect.objectContaining({
      action: 'billing.customer.subscription.updated',
      metadata: expect.objectContaining({ inactiveAdvertiserAccounts: 1, accountSyncQueued: true }),
    }))
  })

  it('does not enqueue a Google account sync without an active Google Ads connection', async () => {
    const claim = databaseDouble({ statementResults: [[{ id: 'event-row' }]] })
    const processing = databaseDouble({
      statementResults: [[{ id: workspaceId }]],
      query: queryMap({ workspace: { id: workspaceId, plan: 'solo', accessState: 'suspended' } }),
    })
    mocks.databases.push(claim.db, processing.db)
    const subscription = {
      id: 'sub_1',
      customer: 'cus_1',
      status: 'active',
      cancel_at_period_end: false,
      metadata: { workspaceId, plan: 'solo' },
      items: { data: [{ price: { id: 'price_solo', currency: 'eur', recurring: { interval: 'month' } }, quantity: 1, current_period_end: 1_800_000_000 }] },
    }

    await expect(processStripeWebhookEvent(event('customer.subscription.created', subscription)))
      .resolves.toEqual({ duplicate: false })

    expect(processing.capture.values).not.toContainEqual(expect.objectContaining({ type: 'google.accounts_sync' }))
    expect(processing.capture.values).toContainEqual(expect.objectContaining({
      action: 'billing.customer.subscription.created',
      metadata: expect.objectContaining({ accountSyncQueued: false }),
    }))
  })

  it('keeps current rights on upgrade until an authoritative paid invoice confirms the new Price', async () => {
    const subscription = {
      id: 'sub_1',
      customer: 'cus_1',
      status: 'active',
      cancel_at_period_end: false,
      metadata: { workspaceId, plan: 'solo' },
      items: { data: [{ price: { id: 'price_studio', currency: 'eur', recurring: { interval: 'month' } }, quantity: 1, current_period_end: 1_800_000_000 }] },
    } as unknown as Stripe.Subscription
    const upgradeClaim = databaseDouble({ statementResults: [[{ id: 'upgrade-event-row' }]] })
    const upgrade = databaseDouble({
      statementResults: [[{ id: workspaceId }]],
      query: queryMap({ workspace: { id: workspaceId, plan: 'solo', accessState: 'active' } }),
    })
    mocks.databases.push(upgradeClaim.db, upgrade.db)
    await processStripeWebhookEvent(event('customer.subscription.updated', subscription, 'evt_upgrade'))
    expect(upgrade.capture.sets[0]).toMatchObject({ requestedPlan: 'studio' })
    expect(upgrade.capture.sets[0]).not.toHaveProperty('plan')

    const invoiceClaim = databaseDouble({ statementResults: [[{ id: 'invoice-event-row' }]] })
    const invoice = databaseDouble({ statementResults: [[{ id: workspaceId }]], query: queryMap({
      workspace: {
        id: workspaceId,
        plan: 'solo',
        graceEndsAt: null,
        stripeStateAppliedAt: null,
        subscriptionStatus: 'active',
        requestedPlan: 'studio',
      },
      clients: [],
    }) })
    mocks.databases.push(invoiceClaim.db, invoice.db)
    const stripe = {
      subscriptions: { retrieve: vi.fn(async () => subscription) },
      subscriptionSchedules: { retrieve: vi.fn() },
    } as unknown as Stripe
    await processStripeWebhookEvent(event('invoice.paid', {
      id: 'in_upgrade',
      customer: 'cus_1',
      parent: { subscription_details: { subscription: 'sub_1' } },
    }, 'evt_invoice_paid'), { stripe })
    expect(invoice.capture.sets[0]).toMatchObject({
      plan: 'studio',
      requestedPlan: null,
      billingReconciliationRequired: false,
      accessState: 'active',
    })
  })

  it('does not reapply plan quotas when an older paid invoice loses the workspace compare-and-set', async () => {
    const subscription = {
      id: 'sub_1', customer: 'cus_1', status: 'active', cancel_at_period_end: false,
      metadata: { workspaceId },
      items: { data: [{ price: { id: 'price_studio', currency: 'eur', recurring: { interval: 'month' } }, quantity: 1, current_period_end: 1_800_000_000 }] },
    } as unknown as Stripe.Subscription
    const claim = databaseDouble({ statementResults: [[{ id: 'event-row' }]] })
    const clientsFindMany = vi.fn(async () => [])
    const processing = databaseDouble({
      statementResults: [[]],
      query: {
        workspaces: { findFirst: vi.fn(async () => ({
          id: workspaceId,
          plan: 'solo',
          graceEndsAt: null,
          stripeStateAppliedAt: new Date('2030-01-01T00:00:00.000Z'),
          subscriptionStatus: 'active',
          requestedPlan: 'studio',
        })) },
        clients: { findMany: clientsFindMany },
      },
    })
    mocks.databases.push(claim.db, processing.db)
    const stripe = {
      subscriptions: { retrieve: vi.fn(async () => subscription) },
      subscriptionSchedules: { retrieve: vi.fn() },
    } as unknown as Stripe

    await processStripeWebhookEvent(event('invoice.paid', {
      id: 'in_stale', customer: 'cus_1', parent: { subscription_details: { subscription: 'sub_1' } },
    }, 'evt_stale_paid'), { stripe })

    expect(clientsFindMany).not.toHaveBeenCalled()
    expect(processing.capture.values).not.toContainEqual(expect.objectContaining({ type: 'google.accounts_sync' }))
  })

  it('uses the authoritative schedule so a stale schedule event cannot restore an obsolete downgrade', async () => {
    const stale = {
      id: 'sub_sched_1',
      subscription: 'sub_1',
      current_phase: { start_date: 1_780_000_000, end_date: 1_800_000_000 },
      phases: [{ start_date: 1_800_000_000, end_date: 1_900_000_000, items: [{ price: 'price_solo' }] }],
    } as unknown as Stripe.SubscriptionSchedule
    const authoritative = { ...stale, phases: [] } as unknown as Stripe.SubscriptionSchedule
    const claim = databaseDouble({ statementResults: [[{ id: 'schedule-event-row' }]] })
    const processing = databaseDouble({ query: queryMap({ workspace: { id: workspaceId } }) })
    mocks.databases.push(claim.db, processing.db)
    const stripe = {
      subscriptions: { retrieve: vi.fn() },
      subscriptionSchedules: { retrieve: vi.fn(async () => authoritative) },
    } as unknown as Stripe
    await processStripeWebhookEvent(event('subscription_schedule.updated', stale, 'evt_stale_schedule'), { stripe })
    expect(processing.capture.sets[0]).toMatchObject({ requestedPlan: null, requestedPlanEffectiveAt: null })
    expect(processing.capture.values[0]).toMatchObject({
      action: 'billing.subscription_schedule.updated',
      metadata: expect.objectContaining({ requestedPlan: null }),
    })
  })

  it('acknowledges subscription events belonging to another Stripe product', async () => {
    const claim = databaseDouble({ statementResults: [[{ id: 'event-row' }]] })
    const processing = databaseDouble()
    mocks.databases.push(claim.db, processing.db)
    await expect(processStripeWebhookEvent(event('customer.subscription.created', {
      id: 'sub_unrelated',
      customer: 'cus_unrelated',
      status: 'active',
      cancel_at_period_end: false,
      metadata: {},
      items: { data: [{ price: { id: 'price_unrelated' }, current_period_end: 1_800_000_000 }] },
    }))).resolves.toEqual({ duplicate: false })
    expect(processing.capture.sets[0]).toMatchObject({ status: 'processed', errorMessage: null })
    expect(mocks.enqueueJob).not.toHaveBeenCalled()
  })

  it('marks processing failures and creates a deduplicated operations alert before rethrowing', async () => {
    const claim = databaseDouble({ statementResults: [[{ id: 'event-row' }]] })
    const failing = { query: { workspaces: { findFirst: vi.fn(async () => { throw new Error('database unavailable') }) } } }
    const failureAudit = databaseDouble()
    mocks.databases.push(claim.db, failing, failureAudit.db)
    await expect(processStripeWebhookEvent(event('invoice.paid', { customer: 'cus_1' }, 'evt_failed')))
      .rejects.toThrow('database unavailable')
    expect(failureAudit.capture.sets[0]).toMatchObject({ status: 'failed', errorMessage: 'database unavailable' })
    expect(failureAudit.capture.values[0]).toMatchObject({
      type: 'operations.alert',
      deduplicationKey: 'operations.alert:stripe_webhook_failed:evt_failed',
    })
  })
})
