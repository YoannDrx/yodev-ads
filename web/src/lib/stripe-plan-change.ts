import 'server-only'

import type Stripe from 'stripe'
import { planFromPriceId, priceIdForPlan, subscriptionRecord, type PlanId } from '@/lib/billing'

const planRank: Record<PlanId, number> = { solo: 1, studio: 2, agency: 3 }

function stripeId(value: string | { id: string } | null | undefined) {
  return typeof value === 'string' ? value : value?.id
}

function recurringItem(subscription: Stripe.Subscription) {
  const items = subscription.items.data.filter((item) => item.price.recurring)
  if (items.length !== 1) throw new Error(`Abonnement Stripe incohérent : ${items.length} ligne(s) récurrente(s).`)
  return items[0]
}

function assertAuthoritativeSubscription(
  subscription: Stripe.Subscription,
  input: { workspaceId: string; currentPlan: PlanId },
) {
  const record = subscriptionRecord(subscription)
  if (record.workspaceId !== input.workspaceId) throw new Error('L’abonnement Stripe n’appartient pas à cet espace.')
  if (record.reconciliationReason || !record.plan) {
    throw new Error(`L’abonnement Stripe doit être réconcilié : ${record.reconciliationReason ?? 'forfait absent'}.`)
  }
  if (record.plan !== input.currentPlan) {
    throw new Error(`Le forfait Stripe (${record.plan}) ne correspond pas au forfait local (${input.currentPlan}).`)
  }
  if (!['active', 'trialing'].includes(subscription.status)) {
    throw new Error(`Le changement de formule est indisponible pour un abonnement ${subscription.status}.`)
  }
}

export type StripePlanChangeResult = {
  mode: 'upgrade' | 'downgrade'
  stripeReference: string
  effectiveAt: Date | null
  paymentPending: boolean
}

export async function requestStripePlanChange(input: {
  stripe: Stripe
  subscriptionId: string
  workspaceId: string
  currentPlan: PlanId
  targetPlan: PlanId
}): Promise<StripePlanChangeResult> {
  if (input.currentPlan === input.targetPlan) throw new Error('Cette formule est déjà active.')
  const targetPrice = priceIdForPlan(input.targetPlan)
  if (!targetPrice) throw new Error(`Le Price Stripe ${input.targetPlan} n’est pas configuré.`)

  const subscription = await input.stripe.subscriptions.retrieve(input.subscriptionId)
  assertAuthoritativeSubscription(subscription, input)
  const item = recurringItem(subscription)
  const scheduleId = stripeId(subscription.schedule)
  const isUpgrade = planRank[input.targetPlan] > planRank[input.currentPlan]

  if (isUpgrade) {
    if (scheduleId) {
      throw new Error('Annulez d’abord le changement de formule déjà programmé.')
    }
    const updated = await input.stripe.subscriptions.update(
      subscription.id,
      {
        items: [{ id: item.id, price: targetPrice, quantity: 1 }],
        payment_behavior: 'pending_if_incomplete',
        proration_behavior: 'always_invoice',
        metadata: { ...subscription.metadata, workspaceId: input.workspaceId },
      },
      { idempotencyKey: `plan-upgrade:${input.workspaceId}:${input.targetPlan}:${item.current_period_end}` },
    )
    return {
      mode: 'upgrade',
      stripeReference: updated.id,
      effectiveAt: null,
      paymentPending: Boolean(updated.pending_update),
    }
  }

  if (subscription.pending_update) {
    throw new Error('Un paiement de changement de formule est déjà en attente.')
  }
  const schedule = scheduleId
    ? await input.stripe.subscriptionSchedules.retrieve(scheduleId)
    : await input.stripe.subscriptionSchedules.create(
        { from_subscription: subscription.id },
        { idempotencyKey: `plan-schedule:${input.workspaceId}:${item.current_period_end}` },
      )
  if (!schedule.current_phase) throw new Error('Stripe n’a pas renvoyé de période courante pour la programmation.')

  const effectiveAt = new Date(schedule.current_phase.end_date * 1000)
  const currentPrice = planFromPriceId(item.price.id)
  if (currentPrice !== input.currentPlan) throw new Error('Le Price Stripe courant a changé pendant la demande.')
  const updatedSchedule = await input.stripe.subscriptionSchedules.update(
    schedule.id,
    {
      end_behavior: 'release',
      proration_behavior: 'none',
      metadata: { ...schedule.metadata, workspaceId: input.workspaceId },
      phases: [
        {
          start_date: schedule.current_phase.start_date,
          end_date: schedule.current_phase.end_date,
          items: [{ price: item.price.id, quantity: 1 }],
          proration_behavior: 'none',
          metadata: { workspaceId: input.workspaceId },
        },
        {
          start_date: schedule.current_phase.end_date,
          duration: { interval: 'month', interval_count: 1 },
          items: [{ price: targetPrice, quantity: 1 }],
          proration_behavior: 'none',
          metadata: { workspaceId: input.workspaceId },
        },
      ],
    },
    { idempotencyKey: `plan-downgrade:${input.workspaceId}:${input.targetPlan}:${schedule.current_phase.end_date}` },
  )
  return {
    mode: 'downgrade',
    stripeReference: updatedSchedule.id,
    effectiveAt,
    paymentPending: false,
  }
}

export async function cancelStripeScheduledPlanChange(input: {
  stripe: Stripe
  subscriptionId: string
  workspaceId: string
}) {
  const subscription = await input.stripe.subscriptions.retrieve(input.subscriptionId)
  if (subscription.metadata.workspaceId !== input.workspaceId) {
    throw new Error('L’abonnement Stripe n’appartient pas à cet espace.')
  }
  const scheduleId = stripeId(subscription.schedule)
  if (!scheduleId) throw new Error('Aucun changement de formule programmé à annuler.')
  const released = await input.stripe.subscriptionSchedules.release(
    scheduleId,
    { preserve_cancel_date: true },
    { idempotencyKey: `plan-schedule-release:${input.workspaceId}:${scheduleId}` },
  )
  return released.id
}
