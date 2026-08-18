import 'server-only'

import type Stripe from 'stripe'
import { eq } from 'drizzle-orm'
import { auditEvents, workspaces } from '@/db/schema'
import { withSystemTransaction } from '@/db/transactions'
import { planFromPriceId, subscriptionRecord } from '@/lib/billing'
import { NonRetryableJobError } from '@/lib/jobs'

export async function reconcileStripeWorkspace(workspaceId: string, stripe: Stripe, now = new Date()) {
  const workspace = await withSystemTransaction((db) => db.query.workspaces.findFirst({
    where: eq(workspaces.id, workspaceId),
    columns: {
      id: true,
      plan: true,
      requestedPlan: true,
      requestedPlanEffectiveAt: true,
      stripeCustomerId: true,
      stripeSubscriptionId: true,
      subscriptionStatus: true,
      subscriptionCurrentPeriodEnd: true,
      billingReconciliationRequired: true,
      billingReconciliationReason: true,
    },
  }))
  if (!workspace?.stripeSubscriptionId) throw new NonRetryableJobError('Workspace Stripe subscription missing')

  let subscription: Stripe.Subscription
  let customer: Stripe.Customer | Stripe.DeletedCustomer | null = null
  let schedule: Stripe.SubscriptionSchedule | null = null
  let latestInvoice: Stripe.Invoice | null = null
  try {
    subscription = await stripe.subscriptions.retrieve(workspace.stripeSubscriptionId)
    const customerId = typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id
    const scheduleId = typeof subscription.schedule === 'string' ? subscription.schedule : subscription.schedule?.id
    const [resolvedCustomer, invoices, resolvedSchedule] = await Promise.all([
      stripe.customers.retrieve(customerId),
      stripe.invoices.list({ subscription: subscription.id, limit: 1 }),
      scheduleId ? stripe.subscriptionSchedules.retrieve(scheduleId) : Promise.resolve(null),
    ])
    customer = resolvedCustomer
    latestInvoice = invoices.data[0] ?? null
    schedule = resolvedSchedule
  } catch (error) {
    const reason = `subscription_retrieve_failed:${error instanceof Error ? error.message : String(error)}`.slice(0, 2000)
    await persistReconciliationResult(workspace.id, reason, now)
    throw error
  }
  const record = subscriptionRecord(subscription)
  const differences: string[] = []
  if (record.reconciliationReason || !record.plan) differences.push(record.reconciliationReason ?? 'plan_missing')
  if (record.workspaceId !== workspace.id) differences.push('workspace_mismatch')
  if (record.stripeCustomerId !== workspace.stripeCustomerId) differences.push('customer_mismatch')
  if (customer?.deleted) differences.push('customer_deleted')
  if (record.stripeSubscriptionId !== workspace.stripeSubscriptionId) differences.push('subscription_mismatch')
  if (record.subscriptionStatus !== workspace.subscriptionStatus) differences.push(`status:${workspace.subscriptionStatus}->${record.subscriptionStatus}`)
  if (record.plan && record.plan !== workspace.plan && record.plan !== workspace.requestedPlan) {
    differences.push(`plan:${workspace.plan}->${record.plan}`)
  }
  if (record.subscriptionCurrentPeriodEnd?.getTime() !== workspace.subscriptionCurrentPeriodEnd?.getTime()) {
    differences.push('period_end_mismatch')
  }
  const future = requestedPlanFromSchedule(schedule)
  if (future.reason) differences.push(future.reason)
  if (future.plan !== workspace.requestedPlan) differences.push(`requested_plan:${workspace.requestedPlan ?? 'none'}->${future.plan ?? 'none'}`)
  if (future.effectiveAt?.getTime() !== workspace.requestedPlanEffectiveAt?.getTime()) differences.push('requested_plan_effective_at_mismatch')
  if (latestInvoice && ['open', 'uncollectible'].includes(latestInvoice.status ?? '')) {
    differences.push(`latest_invoice_unpaid:${latestInvoice.id}`)
  }

  const reason = differences.length > 0 ? differences.join(',').slice(0, 2000) : null
  await withSystemTransaction(async (db) => {
    await db.update(workspaces).set({
      billingReconciliationRequired: Boolean(reason),
      billingReconciliationReason: reason,
      updatedAt: now,
    }).where(eq(workspaces.id, workspace.id))
    if (reason) {
      await db.insert(auditEvents).values({
        workspaceId: workspace.id,
        actorUserId: 'system:stripe-reconciliation',
        action: 'billing.reconciliation_required',
        entityType: 'workspace',
        entityId: workspace.id,
        metadata: { differences, subscriptionId: subscription.id },
      })
    }
  })
  return { workspaceId: workspace.id, reconciled: !reason, differences }
}

function requestedPlanFromSchedule(schedule: Stripe.SubscriptionSchedule | null) {
  if (!schedule) return { plan: null, effectiveAt: null, reason: null }
  const currentEnd = schedule.current_phase?.end_date ?? 0
  const future = schedule.phases.find((phase) => phase.start_date >= currentEnd)
  if (!future) return { plan: null, effectiveAt: null, reason: null }
  if (future.items.length !== 1) {
    return { plan: null, effectiveAt: new Date(future.start_date * 1000), reason: `schedule_items:${future.items.length}` }
  }
  const rawPrice = future.items[0].price
  const priceId = typeof rawPrice === 'string' ? rawPrice : rawPrice.id
  const plan = planFromPriceId(priceId)
  return {
    plan: plan ?? null,
    effectiveAt: new Date(future.start_date * 1000),
    reason: plan ? null : `unknown_schedule_price:${priceId}`,
  }
}

function persistReconciliationResult(workspaceId: string, reason: string, now: Date) {
  return withSystemTransaction((db) => db.update(workspaces).set({
    billingReconciliationRequired: true,
    billingReconciliationReason: reason,
    updatedAt: now,
  }).where(eq(workspaces.id, workspaceId)))
}
