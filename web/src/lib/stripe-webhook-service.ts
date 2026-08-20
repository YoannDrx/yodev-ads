import 'server-only'

import type Stripe from 'stripe'
import { and, eq, isNull, lte, or } from 'drizzle-orm'
import { auditEvents, clients, jobs, stripeWebhookEvents, workspaces } from '@/db/schema'
import type { DatabaseTransaction } from '@/db/transactions'
import { withSystemTransaction } from '@/db/transactions'
import {
  accessStateForSubscription,
  accountsWithinPlan,
  chargeRefundRecord,
  planFromPriceId,
  shouldNotifyInvoiceEvent,
  subscriptionRecord,
  type PlanId,
} from '@/lib/billing'
import { insertActivationMilestone } from '@/lib/activation'
import { enqueueJob } from '@/lib/jobs'
import { operationsAlertJob } from '@/lib/operations-alert-model'

const subscriptionEvents = new Set<Stripe.Event.Type>([
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'customer.subscription.pending_update_applied',
  'customer.subscription.pending_update_expired',
])

const scheduleEvents = new Set<Stripe.Event.Type>([
  'subscription_schedule.created',
  'subscription_schedule.updated',
  'subscription_schedule.completed',
  'subscription_schedule.canceled',
])

type LifecycleNotification = {
  workspaceId: string
  kind: 'payment_succeeded' | 'payment_failed' | 'refund_processed' | 'cancellation_scheduled'
  referenceKey: string
  effectiveAt: string | null
}

const planRank: Record<string, number> = { trial: 0, solo: 1, studio: 2, agency: 3, internal: 99 }

function stripeId(value: string | { id: string } | null | undefined) {
  return typeof value === 'string' ? value : value?.id
}

function invoiceSubscriptionId(invoice: Stripe.Invoice) {
  return stripeId(invoice.parent?.subscription_details?.subscription)
}

async function authoritativeSubscription(
  event: Stripe.Event,
  stripe?: Stripe,
): Promise<Stripe.Subscription | null> {
  if (!stripe) return subscriptionEvents.has(event.type) ? event.data.object as Stripe.Subscription : null
  const subscriptionId = subscriptionEvents.has(event.type)
    ? (event.data.object as Stripe.Subscription).id
    : event.type.startsWith('invoice.')
      ? invoiceSubscriptionId(event.data.object as Stripe.Invoice)
      : null
  if (!subscriptionId) return subscriptionEvents.has(event.type) ? event.data.object as Stripe.Subscription : null
  return stripe.subscriptions.retrieve(subscriptionId)
}

async function authoritativeSchedule(event: Stripe.Event, stripe?: Stripe) {
  if (!scheduleEvents.has(event.type)) return null
  const schedule = event.data.object as Stripe.SubscriptionSchedule
  return stripe ? stripe.subscriptionSchedules.retrieve(schedule.id) : schedule
}

async function applyPlanQuota(
  db: DatabaseTransaction,
  workspaceId: string,
  plan: PlanId,
  eventId: string,
) {
  const workspaceClients = await db.query.clients.findMany({
    where: eq(clients.workspaceId, workspaceId),
    columns: { id: true, googleCustomerId: true, isManager: true, active: true },
  })
  const accountQuota = accountsWithinPlan(
    workspaceClients
      .filter((client) => client.active)
      .map((client) => ({ ...client, customerId: client.googleCustomerId })),
    plan,
  )
  const includedClientIds = new Set(accountQuota.included.map((client) => client.id))
  let accountActivationChanges = 0
  for (const client of workspaceClients) {
    const shouldBeActive = includedClientIds.has(client.id)
    if (client.active === shouldBeActive) continue
    await db.update(clients)
      .set({ active: shouldBeActive, updatedAt: new Date() })
      .where(and(eq(clients.workspaceId, workspaceId), eq(clients.id, client.id)))
    accountActivationChanges += 1
  }
  await db.insert(jobs).values({
    workspaceId,
    type: 'google.accounts_sync',
    payload: { workspaceId },
    priority: 25,
    deduplicationKey: `google.accounts_sync:${workspaceId}:${eventId}`,
  }).onConflictDoNothing({ target: jobs.deduplicationKey })
  return { accountQuota, accountActivationChanges }
}

function scheduledPlan(schedule: Stripe.SubscriptionSchedule) {
  const currentEnd = schedule.current_phase?.end_date ?? 0
  const future = schedule.phases.find((phase) => phase.start_date >= currentEnd)
  if (!future) return null
  if (future.items.length !== 1) return { plan: undefined, effectiveAt: new Date(future.start_date * 1000), reason: `schedule_items:${future.items.length}` }
  const priceId = stripeId(future.items[0].price)
  const plan = priceId ? planFromPriceId(priceId) : undefined
  return {
    plan,
    effectiveAt: new Date(future.start_date * 1000),
    reason: plan ? null : `unknown_schedule_price:${priceId ?? 'missing'}`,
  }
}

export async function processStripeWebhookEvent(event: Stripe.Event, options: { stripe?: Stripe } = {}) {
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

  let affectedWorkspaceId: string | undefined
  try {
    const subscription = await authoritativeSubscription(event, options.stripe)
    const schedule = await authoritativeSchedule(event, options.stripe)
    const lifecycleNotification = await withSystemTransaction(async (db) => {
      let notification: LifecycleNotification | null = null

      if (event.type === 'checkout.session.completed') {
        const session = event.data.object as Stripe.Checkout.Session
        const workspaceId = session.metadata?.workspaceId ?? session.client_reference_id
        if (workspaceId) {
          affectedWorkspaceId = workspaceId
          await db.insert(auditEvents).values({
            workspaceId,
            actorUserId: 'system:stripe',
            action: 'billing.checkout.session.completed',
            entityType: 'workspace',
            entityId: workspaceId,
            metadata: { eventId: event.id, sessionId: session.id, paymentStatus: session.payment_status },
          })
        }
      }

      if (event.type === 'invoice.paid' || event.type === 'invoice.payment_failed' || event.type === 'invoice.payment_action_required') {
        const invoice = event.data.object as Stripe.Invoice
        const customerId = stripeId(invoice.customer)
        if (customerId) {
          const invoiceWorkspace = await db.query.workspaces.findFirst({
            where: eq(workspaces.stripeCustomerId, customerId),
            columns: {
              id: true,
              plan: true,
              graceEndsAt: true,
              stripeStateAppliedAt: true,
              subscriptionStatus: true,
              requestedPlan: true,
            },
          })
          if (invoiceWorkspace) {
            affectedWorkspaceId = invoiceWorkspace.id
            const normalizedType = event.type === 'invoice.paid' ? 'invoice.paid' : 'invoice.payment_failed'
            const shouldNotify = shouldNotifyInvoiceEvent({
              type: normalizedType,
              eventCreatedAt: stripeCreatedAt,
              stateAppliedAt: invoiceWorkspace.stripeStateAppliedAt,
              subscriptionStatus: invoiceWorkspace.subscriptionStatus,
            })
            let paidPlan: PlanId | undefined
            let subscriptionRecordValue: ReturnType<typeof subscriptionRecord> | null = null
            if (subscription) {
              subscriptionRecordValue = subscriptionRecord(subscription)
              if (subscriptionRecordValue.workspaceId && subscriptionRecordValue.workspaceId !== invoiceWorkspace.id) {
                throw new Error('Invoice subscription workspace mismatch')
              }
              if (subscriptionRecordValue.reconciliationReason || !subscriptionRecordValue.plan) {
                throw new Error(subscriptionRecordValue.reconciliationReason ?? 'Invoice subscription plan missing')
              }
              paidPlan = subscriptionRecordValue.plan
            }
            if (event.type === 'invoice.paid' && paidPlan) {
              const lifecycle = subscription
                ? accessStateForSubscription(subscription.status, stripeCreatedAt)
                : { accessState: 'active' as const, graceEndsAt: null }
              const [paidWorkspace] = await db.update(workspaces).set({
                plan: paidPlan,
                allowSelfApproval: paidPlan === 'solo',
                ...(paidPlan === 'solo' ? { approvalMode: 'single', requiredApprovals: 1 } : {}),
                accessState: lifecycle.accessState,
                graceEndsAt: lifecycle.graceEndsAt,
                requestedPlan: null,
                requestedPlanEffectiveAt: null,
                billingReconciliationRequired: false,
                billingReconciliationReason: null,
                ...(subscriptionRecordValue ? {
                  stripeCustomerId: subscriptionRecordValue.stripeCustomerId,
                  stripeSubscriptionId: subscriptionRecordValue.stripeSubscriptionId,
                  subscriptionStatus: subscriptionRecordValue.subscriptionStatus,
                  subscriptionCurrentPeriodEnd: subscriptionRecordValue.subscriptionCurrentPeriodEnd,
                } : {}),
                checkoutAttemptId: null,
                checkoutReservedAt: null,
                stripeStateAppliedAt: stripeCreatedAt,
                updatedAt: new Date(),
              }).where(and(
                eq(workspaces.id, invoiceWorkspace.id),
                or(isNull(workspaces.stripeStateAppliedAt), lte(workspaces.stripeStateAppliedAt, stripeCreatedAt)),
              )).returning({ id: workspaces.id })
              if (paidWorkspace) {
                await applyPlanQuota(db, paidWorkspace.id, paidPlan, event.id)
                await insertActivationMilestone(db, {
                  workspaceId: paidWorkspace.id,
                  milestone: 'paid_conversion',
                  actorUserId: 'system:stripe',
                  sourceEntityId: subscriptionRecordValue?.stripeSubscriptionId ?? invoice.id,
                  metadata: { eventId: event.id, plan: paidPlan },
                })
              }
            } else if (event.type !== 'invoice.paid' && subscriptionRecordValue && subscription) {
              const lifecycle = accessStateForSubscription(subscription.status, stripeCreatedAt)
              await db.update(workspaces).set({
                accessState: lifecycle.accessState,
                graceEndsAt: lifecycle.graceEndsAt,
                subscriptionStatus: subscriptionRecordValue.subscriptionStatus,
                subscriptionCurrentPeriodEnd: subscriptionRecordValue.subscriptionCurrentPeriodEnd,
                stripeStateAppliedAt: stripeCreatedAt,
                updatedAt: new Date(),
              }).where(and(
                eq(workspaces.id, invoiceWorkspace.id),
                or(isNull(workspaces.stripeStateAppliedAt), lte(workspaces.stripeStateAppliedAt, stripeCreatedAt)),
              ))
            }
            await db.insert(auditEvents).values({
              workspaceId: invoiceWorkspace.id,
              actorUserId: 'system:stripe',
              action: shouldNotify ? `billing.${event.type}` : 'billing.invoice_event_ignored_stale',
              entityType: 'workspace',
              entityId: invoiceWorkspace.id,
              metadata: { eventId: event.id, eventType: event.type, stripeCreatedAt: stripeCreatedAt.toISOString(), paidPlan },
            })
            if (shouldNotify) {
              notification = {
                workspaceId: invoiceWorkspace.id,
                kind: event.type === 'invoice.paid' ? 'payment_succeeded' : 'payment_failed',
                referenceKey: event.id,
                effectiveAt: event.type === 'invoice.paid' ? null : invoiceWorkspace.graceEndsAt?.toISOString() ?? null,
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
              metadata: { eventId: event.id, ...refund },
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

      if (subscriptionEvents.has(event.type) && subscription) {
        const record = subscriptionRecord(subscription)
        if (!record.workspaceId) {
          await db.update(stripeWebhookEvents)
            .set({ status: 'processed', processedAt: new Date(), updatedAt: new Date(), errorMessage: null })
            .where(eq(stripeWebhookEvents.id, eventRow.id))
          return notification
        }
        affectedWorkspaceId = record.workspaceId
        if (record.reconciliationReason || !record.plan) throw new Error(record.reconciliationReason ?? 'Subscription plan missing')
        const lifecycle = accessStateForSubscription(subscription.status, stripeCreatedAt)
        const existingWorkspace = await db.query.workspaces.findFirst({
          where: eq(workspaces.id, record.workspaceId),
          columns: { id: true, plan: true, accessState: true },
        })
        if (!existingWorkspace) throw new Error('Workspace not found')
        const isUpgrade = (planRank[record.plan] ?? 0) > (planRank[existingWorkspace.plan] ?? 0)
        const planToApply = isUpgrade ? existingWorkspace.plan as PlanId : record.plan
        const [workspace] = await db.update(workspaces).set({
          ...(isUpgrade ? {
            requestedPlan: record.plan,
            requestedPlanEffectiveAt: stripeCreatedAt,
          } : {
            plan: record.plan,
            requestedPlan: null,
            requestedPlanEffectiveAt: null,
            allowSelfApproval: record.plan === 'solo',
            ...(record.plan === 'solo' ? { approvalMode: 'single', requiredApprovals: 1 } : {}),
          }),
          accessState: isUpgrade ? existingWorkspace.accessState : lifecycle.accessState,
          graceEndsAt: isUpgrade ? undefined : lifecycle.graceEndsAt,
          stripeCustomerId: record.stripeCustomerId,
          stripeSubscriptionId: record.stripeSubscriptionId,
          checkoutAttemptId: null,
          checkoutReservedAt: null,
          subscriptionStatus: record.subscriptionStatus,
          subscriptionCurrentPeriodEnd: record.subscriptionCurrentPeriodEnd,
          stripeStateAppliedAt: stripeCreatedAt,
          billingReconciliationRequired: false,
          billingReconciliationReason: null,
          updatedAt: new Date(),
        }).where(and(
          eq(workspaces.id, record.workspaceId),
          or(isNull(workspaces.stripeStateAppliedAt), lte(workspaces.stripeStateAppliedAt, stripeCreatedAt)),
        )).returning({ id: workspaces.id })

        if (workspace) {
          const quota = isUpgrade
            ? { accountQuota: accountsWithinPlan([], planToApply), accountActivationChanges: 0 }
            : await applyPlanQuota(db, workspace.id, record.plan, event.id)
          await db.insert(auditEvents).values({
            workspaceId: workspace.id,
            actorUserId: 'system:stripe',
            action: `billing.${event.type}`,
            entityType: 'workspace',
            entityId: workspace.id,
            metadata: {
              eventId: event.id,
              effectivePlan: planToApply,
              requestedPlan: isUpgrade ? record.plan : null,
              status: record.subscriptionStatus,
              accessState: isUpgrade ? existingWorkspace.accessState : lifecycle.accessState,
              advertiserAccountLimit: quota.accountQuota.limit,
              activeAdvertiserAccounts: quota.accountQuota.included.filter((client) => !client.isManager).length,
              inactiveAdvertiserAccounts: quota.accountQuota.excluded.length,
              accountActivationChanges: quota.accountActivationChanges,
            },
          })
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

      if (scheduleEvents.has(event.type) && schedule) {
        const subscriptionId = stripeId(schedule.subscription)
        if (subscriptionId) {
          const scheduleWorkspace = await db.query.workspaces.findFirst({
            where: eq(workspaces.stripeSubscriptionId, subscriptionId),
            columns: { id: true },
          })
          if (scheduleWorkspace) {
            affectedWorkspaceId = scheduleWorkspace.id
            const future = event.type === 'subscription_schedule.canceled' || event.type === 'subscription_schedule.completed'
              ? null
              : scheduledPlan(schedule)
            if (future?.reason || (future && !future.plan)) throw new Error(future.reason ?? 'Scheduled plan missing')
            await db.update(workspaces).set({
              requestedPlan: future?.plan ?? null,
              requestedPlanEffectiveAt: future?.effectiveAt ?? null,
              billingReconciliationRequired: false,
              billingReconciliationReason: null,
              updatedAt: new Date(),
            }).where(eq(workspaces.id, scheduleWorkspace.id))
            await db.insert(auditEvents).values({
              workspaceId: scheduleWorkspace.id,
              actorUserId: 'system:stripe',
              action: `billing.${event.type}`,
              entityType: 'workspace',
              entityId: scheduleWorkspace.id,
              metadata: { eventId: event.id, requestedPlan: future?.plan ?? null, effectiveAt: future?.effectiveAt.toISOString() ?? null },
            })
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
    const object = event.data.object as { metadata?: Record<string, string> }
    const workspaceId = affectedWorkspaceId ?? (subscriptionEvents.has(event.type) ? object.metadata?.workspaceId : undefined)
    await withSystemTransaction(async (db) => {
      await db.update(stripeWebhookEvents)
        .set({ status: 'failed', errorMessage: errorMessage.slice(0, 2000), updatedAt: new Date() })
        .where(eq(stripeWebhookEvents.id, eventRow.id))
      if (workspaceId) {
        await db.update(workspaces).set({
          billingReconciliationRequired: true,
          billingReconciliationReason: errorMessage.slice(0, 2000),
          updatedAt: new Date(),
        }).where(eq(workspaces.id, workspaceId))
      }
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
