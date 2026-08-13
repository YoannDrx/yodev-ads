import 'server-only'

import { and, eq, isNull, or } from 'drizzle-orm'
import { auditEvents, legalAcceptances, workspaces } from '@/db/schema'
import { withTenantTransaction } from '@/db/transactions'
import { insertActivationMilestone } from '@/lib/activation'
import { subscriptionIsActive } from '@/lib/billing'
import { LEGAL_VERSIONS } from '@/lib/legal'

type BillingActorContext = {
  workspaceId: string
  actorUserId: string
}

export function reserveWorkspaceCheckout(input: BillingActorContext & {
  checkoutAttemptId: string
  customerType: 'individual' | 'business'
  billingEmail: string
  countryCode: string
  locale: string
  requestFingerprint: string
  now?: Date
}) {
  const now = input.now ?? new Date()
  const reservationFreshAfter = new Date(now.getTime() - 30 * 60_000)
  return withTenantTransaction({ workspaceId: input.workspaceId, userId: input.actorUserId }, async (db) => {
    const [workspace] = await db
      .select({
        stripeSubscriptionId: workspaces.stripeSubscriptionId,
        subscriptionStatus: workspaces.subscriptionStatus,
        checkoutAttemptId: workspaces.checkoutAttemptId,
        checkoutReservedAt: workspaces.checkoutReservedAt,
      })
      .from(workspaces)
      .where(eq(workspaces.id, input.workspaceId))
      .limit(1)
      .for('update')
    if (!workspace) throw new Error('Espace de travail introuvable.')
    if (workspace.stripeSubscriptionId && subscriptionIsActive(workspace.subscriptionStatus)) {
      throw new Error('Un abonnement actif existe déjà. Utilisez le portail de facturation pour changer d’offre.')
    }
    const reservationIsFresh = Boolean(
      workspace.checkoutReservedAt && workspace.checkoutReservedAt > reservationFreshAfter,
    )
    if (reservationIsFresh && workspace.checkoutAttemptId !== input.checkoutAttemptId) {
      throw new Error('Une souscription est déjà en cours. Réutilisez la fenêtre Stripe ouverte ou réessayez dans 30 minutes.')
    }
    await db.insert(legalAcceptances).values({
      workspaceId: input.workspaceId,
      userId: input.actorUserId,
      termsVersion: LEGAL_VERSIONS.terms,
      privacyVersion: LEGAL_VERSIONS.privacy,
      dpaVersion: input.customerType === 'business' ? LEGAL_VERSIONS.dpa : null,
      locale: input.locale,
      context: `checkout_${input.customerType}`,
      requestFingerprint: input.requestFingerprint,
    })
    await insertActivationMilestone(db, {
      workspaceId: input.workspaceId,
      milestone: 'legal_accepted',
      actorUserId: input.actorUserId,
      metadata: { context: `checkout_${input.customerType}` },
    })
    await db.update(workspaces).set({
      billingEmail: input.billingEmail,
      countryCode: input.countryCode,
      termsVersion: LEGAL_VERSIONS.terms,
      privacyVersion: LEGAL_VERSIONS.privacy,
      checkoutAttemptId: input.checkoutAttemptId,
      checkoutReservedAt: now,
      updatedAt: now,
    }).where(eq(workspaces.id, input.workspaceId))
  })
}

export function persistWorkspaceStripeCustomer(input: BillingActorContext & { stripeCustomerId: string; now?: Date }) {
  const now = input.now ?? new Date()
  return withTenantTransaction({ workspaceId: input.workspaceId, userId: input.actorUserId }, async (db) => {
    const [saved] = await db.update(workspaces).set({
      stripeCustomerId: input.stripeCustomerId,
      updatedAt: now,
    }).where(and(
      eq(workspaces.id, input.workspaceId),
      or(isNull(workspaces.stripeCustomerId), eq(workspaces.stripeCustomerId, input.stripeCustomerId)),
    )).returning({ stripeCustomerId: workspaces.stripeCustomerId })
    if (saved) return saved.stripeCustomerId

    const existing = await db.query.workspaces.findFirst({
      where: eq(workspaces.id, input.workspaceId),
      columns: { stripeCustomerId: true },
    })
    if (existing?.stripeCustomerId === input.stripeCustomerId) return input.stripeCustomerId
    throw new Error('Un autre client Stripe est déjà associé à cet espace.')
  })
}

export function releaseWorkspaceCheckoutReservation(input: BillingActorContext & {
  checkoutAttemptId: string
  now?: Date
}) {
  const now = input.now ?? new Date()
  return withTenantTransaction({ workspaceId: input.workspaceId, userId: input.actorUserId }, (db) => db
    .update(workspaces)
    .set({ checkoutAttemptId: null, checkoutReservedAt: null, updatedAt: now })
    .where(and(
      eq(workspaces.id, input.workspaceId),
      eq(workspaces.checkoutAttemptId, input.checkoutAttemptId),
    )))
}

export function recordSubscriptionCancellationRequested(input: BillingActorContext & {
  subscriptionId: string
  currentPeriodEnd: Date | null
}) {
  return withTenantTransaction({ workspaceId: input.workspaceId, userId: input.actorUserId }, (db) => db
    .insert(auditEvents)
    .values({
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      action: 'billing.cancellation_requested',
      entityType: 'workspace',
      entityId: input.workspaceId,
      metadata: {
        subscriptionId: input.subscriptionId,
        currentPeriodEnd: input.currentPeriodEnd?.toISOString(),
      },
    }))
}

export function recordSubscriptionCancellationRevoked(input: BillingActorContext) {
  return withTenantTransaction({ workspaceId: input.workspaceId, userId: input.actorUserId }, (db) => db
    .insert(auditEvents)
    .values({
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      action: 'billing.cancellation_revoked',
      entityType: 'workspace',
      entityId: input.workspaceId,
      metadata: {},
    }))
}
