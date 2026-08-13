import 'server-only'

import type Stripe from 'stripe'
import { and, eq, isNull, lte, or } from 'drizzle-orm'
import { auditEvents, clients, jobs, stripeWebhookEvents, workspaces } from '@/db/schema'
import { withSystemTransaction } from '@/db/transactions'
import {
  accessStateForSubscription,
  accountsWithinPlan,
  chargeRefundRecord,
  shouldNotifyInvoiceEvent,
  subscriptionRecord,
} from '@/lib/billing'
import { insertActivationMilestone } from '@/lib/activation'
import { enqueueJob } from '@/lib/jobs'
import { operationsAlertJob } from '@/lib/operations-alert-model'

const subscriptionEvents = new Set<Stripe.Event.Type>([
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
])

type LifecycleNotification = {
  workspaceId: string
  kind: 'payment_succeeded' | 'payment_failed' | 'refund_processed' | 'cancellation_scheduled'
  referenceKey: string
  effectiveAt: string | null
}

export async function processStripeWebhookEvent(event: Stripe.Event) {
  const stripeCreatedAt = new Date(event.created * 1000)
  const eventRow = await withSystemTransaction(async (db) => {
    const [claim] = await db
      .insert(stripeWebhookEvents)
      .values({ eventId: event.id, eventType: event.type, stripeCreatedAt, status: 'processing' })
      .onConflictDoNothing()
      .returning({ id: stripeWebhookEvents.id })
    if (claim) return claim
    const [reclaimed] = await db
      .update(stripeWebhookEvents)
      .set({ status: 'processing', errorMessage: null, updatedAt: new Date() })
      .where(and(eq(stripeWebhookEvents.eventId, event.id), eq(stripeWebhookEvents.status, 'failed')))
      .returning({ id: stripeWebhookEvents.id })
    return reclaimed
  })
  if (!eventRow) return { duplicate: true as const }

  try {
    const lifecycleNotification = await withSystemTransaction(async (db) => {
      let notification: LifecycleNotification | null = null
      if (event.type === 'invoice.paid' || event.type === 'invoice.payment_failed') {
        const invoice = event.data.object as Stripe.Invoice
        const customerId = typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id
        if (customerId) {
          const invoiceWorkspace = await db.query.workspaces.findFirst({
            where: eq(workspaces.stripeCustomerId, customerId),
            columns: { id: true, graceEndsAt: true, stripeStateAppliedAt: true, subscriptionStatus: true },
          })
          if (invoiceWorkspace) {
            const shouldNotify = shouldNotifyInvoiceEvent({
              type: event.type,
              eventCreatedAt: stripeCreatedAt,
              stateAppliedAt: invoiceWorkspace.stripeStateAppliedAt,
              subscriptionStatus: invoiceWorkspace.subscriptionStatus,
            })
            await db.insert(auditEvents).values({
              workspaceId: invoiceWorkspace.id,
              actorUserId: 'system:stripe',
              action: shouldNotify ? `billing.${event.type}` : 'billing.invoice_event_ignored_stale',
              entityType: 'workspace',
              entityId: invoiceWorkspace.id,
              metadata: { eventId: event.id, eventType: event.type, stripeCreatedAt: stripeCreatedAt.toISOString() },
            })
            if (shouldNotify) {
              notification = {
                workspaceId: invoiceWorkspace.id,
                kind: event.type === 'invoice.paid' ? 'payment_succeeded' : 'payment_failed',
                referenceKey: event.id,
                effectiveAt: event.type === 'invoice.payment_failed'
                  ? invoiceWorkspace.graceEndsAt?.toISOString() ?? null
                  : null,
              }
            }
          }
        }
      }
      if (event.type === 'charge.refunded') {
        const refund = chargeRefundRecord(event.data.object as Stripe.Charge)
        if (refund) {
          const refundWorkspace = await db.query.workspaces.findFirst({
            where: eq(workspaces.stripeCustomerId, refund.customerId),
            columns: { id: true },
          })
          if (refundWorkspace) {
            await db.insert(auditEvents).values({
              workspaceId: refundWorkspace.id,
              actorUserId: 'system:stripe',
              action: 'billing.charge.refunded',
              entityType: 'workspace',
              entityId: refundWorkspace.id,
              metadata: {
                eventId: event.id,
                chargeId: refund.chargeId,
                paymentIntentId: refund.paymentIntentId,
                currency: refund.currency,
                originalAmount: refund.originalAmount,
                refundedAmount: refund.refundedAmount,
                fullyRefunded: refund.fullyRefunded,
              },
            })
            notification = {
              workspaceId: refundWorkspace.id,
              kind: 'refund_processed',
              referenceKey: event.id,
              effectiveAt: stripeCreatedAt.toISOString(),
            }
          }
        }
      }
      if (subscriptionEvents.has(event.type)) {
        const subscription = event.data.object as Stripe.Subscription
        const record = subscriptionRecord(subscription)
        // A Stripe account may contain other products or manual sandbox probes.
        // They are valid provider events, but they do not belong to Ads by Yodev
        // and must not poison retries or the webhook dead-letter queue.
        if (!record.workspaceId || !record.plan) {
          await db.update(stripeWebhookEvents)
            .set({ status: 'processed', processedAt: new Date(), updatedAt: new Date(), errorMessage: null })
            .where(eq(stripeWebhookEvents.id, eventRow.id))
          return notification
        }
        const lifecycle = accessStateForSubscription(subscription.status, stripeCreatedAt)
        const existingWorkspace = await db.query.workspaces.findFirst({
          where: eq(workspaces.id, record.workspaceId),
          columns: { id: true },
        })
        if (!existingWorkspace) throw new Error('Workspace not found')
        const [workspace] = await db
          .update(workspaces)
          .set({
            plan: record.plan,
            allowSelfApproval: record.plan === 'solo',
            ...(record.plan === 'solo' ? { approvalMode: 'single', requiredApprovals: 1 } : {}),
            accessState: lifecycle.accessState,
            graceEndsAt: lifecycle.graceEndsAt,
            stripeCustomerId: record.stripeCustomerId,
            stripeSubscriptionId: record.stripeSubscriptionId,
            checkoutAttemptId: null,
            checkoutReservedAt: null,
            subscriptionStatus: record.subscriptionStatus,
            subscriptionCurrentPeriodEnd: record.subscriptionCurrentPeriodEnd,
            stripeStateAppliedAt: stripeCreatedAt,
            updatedAt: new Date(),
          })
          .where(and(
            eq(workspaces.id, record.workspaceId),
            or(isNull(workspaces.stripeStateAppliedAt), lte(workspaces.stripeStateAppliedAt, stripeCreatedAt)),
          ))
          .returning({ id: workspaces.id })

        if (workspace) {
          const workspaceClients = await db.query.clients.findMany({
            where: eq(clients.workspaceId, workspace.id),
            columns: { id: true, googleCustomerId: true, isManager: true, active: true },
          })
          const accountQuota = accountsWithinPlan(
            workspaceClients
              .filter((client) => client.active)
              .map((client) => ({ ...client, customerId: client.googleCustomerId })),
            record.plan,
          )
          const includedClientIds = new Set(accountQuota.included.map((client) => client.id))
          let accountActivationChanges = 0
          for (const client of workspaceClients) {
            const shouldBeActive = includedClientIds.has(client.id)
            if (client.active === shouldBeActive) continue
            await db.update(clients)
              .set({ active: shouldBeActive, updatedAt: new Date() })
              .where(and(eq(clients.workspaceId, workspace.id), eq(clients.id, client.id)))
            accountActivationChanges += 1
          }
          if (lifecycle.accessState === 'active') {
            await db.insert(jobs).values({
              workspaceId: workspace.id,
              type: 'google.accounts_sync',
              payload: { workspaceId: workspace.id },
              priority: 25,
              deduplicationKey: `google.accounts_sync:${workspace.id}:${event.id}`,
            }).onConflictDoNothing({ target: jobs.deduplicationKey })
          }
          await db.insert(auditEvents).values({
            workspaceId: workspace.id,
            actorUserId: 'system:stripe',
            action: `billing.${event.type}`,
            entityType: 'workspace',
            entityId: workspace.id,
            metadata: {
              eventId: event.id,
              plan: record.plan,
              status: record.subscriptionStatus,
              accessState: lifecycle.accessState,
              advertiserAccountLimit: accountQuota.limit,
              activeAdvertiserAccounts: accountQuota.included.filter((client) => !client.isManager).length,
              inactiveAdvertiserAccounts: accountQuota.excluded.length,
              accountActivationChanges,
            },
          })
          if (record.subscriptionStatus === 'active') {
            await insertActivationMilestone(db, {
              workspaceId: workspace.id,
              milestone: 'paid_conversion',
              actorUserId: 'system:stripe',
              sourceEntityId: record.stripeSubscriptionId,
              metadata: { eventId: event.id, plan: record.plan },
            })
          }
          if (subscription.cancel_at_period_end) {
            notification = {
              workspaceId: workspace.id,
              kind: 'cancellation_scheduled',
              referenceKey: `${subscription.id}:${record.subscriptionCurrentPeriodEnd?.getTime() ?? 'unknown'}`,
              effectiveAt: record.subscriptionCurrentPeriodEnd?.toISOString() ?? null,
            }
          }
        }
      }

      await db.update(stripeWebhookEvents)
        .set({ status: 'processed', processedAt: new Date(), updatedAt: new Date() })
        .where(eq(stripeWebhookEvents.id, eventRow.id))
      return notification
    })
    if (lifecycleNotification) {
      await enqueueJob({
        workspaceId: lifecycleNotification.workspaceId,
        type: 'lifecycle.email',
        payload: {
          workspaceId: lifecycleNotification.workspaceId,
          kind: lifecycleNotification.kind,
          referenceKey: lifecycleNotification.referenceKey,
          effectiveAt: lifecycleNotification.effectiveAt,
        },
        priority: 20,
        deduplicationKey: `lifecycle.email:${lifecycleNotification.workspaceId}:${lifecycleNotification.kind}:${lifecycleNotification.referenceKey}`,
      })
    }
    return { duplicate: false as const }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    await withSystemTransaction(async (db) => {
      await db.update(stripeWebhookEvents)
        .set({ status: 'failed', errorMessage: errorMessage.slice(0, 2000), updatedAt: new Date() })
        .where(eq(stripeWebhookEvents.id, eventRow.id))
      await db.insert(jobs).values(operationsAlertJob({
        kind: 'stripe_webhook_failed',
        sourceId: event.id,
        title: event.type,
        description: 'Le webhook Stripe n’a pas pu être appliqué. Inspecter l’événement dédupliqué et les logs structurés.',
      })).onConflictDoNothing({ target: jobs.deduplicationKey })
    })
    throw error
  }
}
