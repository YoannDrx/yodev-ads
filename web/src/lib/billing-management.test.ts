import { beforeEach, describe, expect, it, vi } from 'vitest'
import { databaseDouble } from '../../test/fluent-db'

const mocks = vi.hoisted(() => ({
  databases: [] as unknown[],
  contexts: [] as unknown[],
  transaction: vi.fn(async (context: unknown, callback: (db: unknown) => unknown) => {
    mocks.contexts.push(context)
    return callback(mocks.databases.shift())
  }),
}))

vi.mock('@/db/transactions', () => ({ withTenantTransaction: mocks.transaction }))

import {
  persistWorkspaceStripeCustomer,
  recordSubscriptionCancellationRequested,
  recordSubscriptionCancellationRevoked,
  releaseWorkspaceCheckoutReservation,
  reserveWorkspaceCheckout,
} from './billing-management'

const workspaceId = '00000000-0000-4000-8000-000000000001'
const actorUserId = 'user-1'
const checkoutAttemptId = '00000000-0000-4000-8000-000000000002'
const now = new Date('2026-08-12T08:00:00.000Z')

function billingDatabase(input: { statementResults?: unknown[]; stripeCustomerId?: string | null } = {}) {
  return databaseDouble({
    statementResults: input.statementResults,
    query: {
      workspaces: { findFirst: vi.fn(async () => ({ stripeCustomerId: input.stripeCustomerId ?? null })) },
    },
  })
}

describe('billing management', () => {
  beforeEach(() => {
    mocks.databases = []
    mocks.contexts = []
    vi.clearAllMocks()
  })

  it('reserves checkout atomically and records legal evidence and activation', async () => {
    const database = billingDatabase({ statementResults: [[{
      stripeSubscriptionId: null,
      subscriptionStatus: null,
      checkoutAttemptId: null,
      checkoutReservedAt: null,
      billingReconciliationRequired: false,
    }]] })
    mocks.databases.push(database.db)

    await reserveWorkspaceCheckout({
      workspaceId,
      actorUserId,
      checkoutAttemptId,
      customerType: 'business',
      billingEmail: 'billing@example.test',
      billingLegalName: 'ACME SAS',
      countryCode: 'FR',
      locale: 'fr',
      requestFingerprint: 'fingerprint',
      now,
    })

    expect(mocks.contexts).toContainEqual({ workspaceId, userId: actorUserId })
    expect(database.capture.values[0]).toMatchObject({
      workspaceId,
      userId: actorUserId,
      dpaVersion: '2026-08-16-b2b',
      context: 'checkout_business',
      requestFingerprint: 'fingerprint',
    })
    expect(database.capture.values[1]).toMatchObject({
      workspaceId, milestone: 'legal_accepted', actorUserId,
    })
    expect(database.capture.sets[0]).toMatchObject({
      billingEmail: 'billing@example.test', billingLegalName: 'ACME SAS', countryCode: 'FR', checkoutAttemptId, checkoutReservedAt: now,
    })
  })

  it('rejects active subscriptions and concurrent fresh checkout attempts', async () => {
    mocks.databases.push(
      billingDatabase({ statementResults: [[{
        stripeSubscriptionId: 'sub_active', subscriptionStatus: 'active', checkoutAttemptId: null, checkoutReservedAt: null, billingReconciliationRequired: false,
      }]] }).db,
      billingDatabase({ statementResults: [[{
        stripeSubscriptionId: null,
        subscriptionStatus: null,
        checkoutAttemptId: '00000000-0000-4000-8000-000000000099',
        checkoutReservedAt: new Date('2026-08-12T07:45:00.000Z'), billingReconciliationRequired: false,
      }]] }).db,
    )
    const input = {
      workspaceId, actorUserId, checkoutAttemptId, customerType: 'business' as const,
      billingEmail: 'billing@example.test', billingLegalName: 'ACME SAS', countryCode: 'FR', locale: 'fr', requestFingerprint: 'fp', now,
    }
    await expect(reserveWorkspaceCheckout(input)).rejects.toThrow('abonnement actif existe déjà')
    await expect(reserveWorkspaceCheckout(input)).rejects.toThrow('souscription est déjà en cours')
  })

  it('allows the same checkout attempt to resume and treats stale reservations as expired', async () => {
    for (const checkoutReservedAt of [
      new Date('2026-08-12T07:45:00.000Z'),
      new Date('2026-08-12T07:29:59.000Z'),
    ]) {
      const database = billingDatabase({ statementResults: [[{
        stripeSubscriptionId: null,
        subscriptionStatus: null,
        checkoutAttemptId,
        checkoutReservedAt,
        billingReconciliationRequired: false,
      }]] })
      mocks.databases.push(database.db)
      await expect(reserveWorkspaceCheckout({
        workspaceId, actorUserId, checkoutAttemptId, customerType: 'business', billingEmail: 'a@example.test', billingLegalName: 'ACME SAS',
        countryCode: 'FR', locale: 'fr', requestFingerprint: 'fp', now,
      })).resolves.toBeUndefined()
    }
  })

  it('persists a Stripe customer with compare-and-set semantics', async () => {
    const created = billingDatabase({ statementResults: [[{ stripeCustomerId: 'cus_123' }]] })
    const replay = billingDatabase({ statementResults: [[]], stripeCustomerId: 'cus_123' })
    const conflict = billingDatabase({ statementResults: [[]], stripeCustomerId: 'cus_other' })
    mocks.databases.push(created.db, replay.db, conflict.db)

    const input = { workspaceId, actorUserId, stripeCustomerId: 'cus_123', now }
    await expect(persistWorkspaceStripeCustomer(input)).resolves.toBe('cus_123')
    await expect(persistWorkspaceStripeCustomer(input)).resolves.toBe('cus_123')
    await expect(persistWorkspaceStripeCustomer(input)).rejects.toThrow('Un autre client Stripe')
    expect(created.capture.sets[0]).toEqual({ stripeCustomerId: 'cus_123', updatedAt: now })
  })

  it('releases only the matching checkout reservation', async () => {
    const database = billingDatabase()
    mocks.databases.push(database.db)
    await releaseWorkspaceCheckoutReservation({ workspaceId, actorUserId, checkoutAttemptId, now })
    expect(database.capture.sets[0]).toEqual({ checkoutAttemptId: null, checkoutReservedAt: null, updatedAt: now })
  })

  it('records cancellation and reactivation audit evidence', async () => {
    const cancellation = billingDatabase()
    const reactivation = billingDatabase()
    mocks.databases.push(cancellation.db, reactivation.db)
    await recordSubscriptionCancellationRequested({
      workspaceId, actorUserId, subscriptionId: 'sub_123', currentPeriodEnd: now,
    })
    await recordSubscriptionCancellationRevoked({ workspaceId, actorUserId })
    expect(cancellation.capture.values[0]).toMatchObject({
      action: 'billing.cancellation_requested', metadata: { subscriptionId: 'sub_123', currentPeriodEnd: now.toISOString() },
    })
    expect(reactivation.capture.values[0]).toMatchObject({ action: 'billing.cancellation_revoked', metadata: {} })
  })
})
