import 'server-only'

import Stripe from 'stripe'

export const planCatalog = {
  solo: {
    name: 'Solo',
    monthlyPrice: 29,
    accountLimit: 3,
    features: ['Analyse 360°', 'Vigies quotidiennes', 'Rapports clients'],
  },
  studio: {
    name: 'Studio',
    monthlyPrice: 89,
    accountLimit: 15,
    features: ['Tout Solo', 'Approbations collaboratives', 'Notifications multicanales', 'API agence'],
  },
  agency: {
    name: 'Agency',
    monthlyPrice: 189,
    accountLimit: 50,
    features: ['Tout Studio', 'Marque blanche', 'Règles de sécurité', 'Support prioritaire'],
  },
} as const

export type PlanId = keyof typeof planCatalog

export function isPlanId(value: string): value is PlanId {
  return value in planCatalog
}

export function priceIdForPlan(plan: PlanId) {
  const key = `STRIPE_PRICE_${plan.toUpperCase()}` as const
  return process.env[key]
}

export function planFromPriceId(priceId: string): PlanId | undefined {
  return (Object.keys(planCatalog) as PlanId[]).find((plan) => priceIdForPlan(plan) === priceId)
}

export function accountLimitForPlan(plan: string) {
  return isPlanId(plan) ? planCatalog[plan].accountLimit : planCatalog.solo.accountLimit
}

export function accountsWithinPlan<T extends { customerId: string; isManager: boolean }>(accounts: T[], plan: string) {
  const sorted = [...accounts].sort((left, right) => left.customerId.localeCompare(right.customerId))
  const managers = sorted.filter((account) => account.isManager)
  const advertisers = sorted.filter((account) => !account.isManager)
  const limit = accountLimitForPlan(plan)
  return {
    included: [...managers, ...advertisers.slice(0, limit)],
    excluded: advertisers.slice(limit),
    limit,
  }
}

export function subscriptionIsActive(status: string) {
  return ['active', 'trialing'].includes(status)
}

export function subscriptionRecord(subscription: Stripe.Subscription) {
  const workspaceId = subscription.metadata.workspaceId
  const priceId = subscription.items.data[0]?.price.id
  const plan = (subscription.metadata.plan && isPlanId(subscription.metadata.plan)
    ? subscription.metadata.plan
    : priceId
      ? planFromPriceId(priceId)
      : undefined) as PlanId | undefined
  const currentPeriodEnd = subscription.items.data.reduce(
    (latest, item) => Math.max(latest, item.current_period_end),
    0,
  )
  return {
    workspaceId,
    plan,
    stripeCustomerId: typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id,
    stripeSubscriptionId: subscription.id,
    subscriptionStatus: subscription.status,
    subscriptionCurrentPeriodEnd: currentPeriodEnd ? new Date(currentPeriodEnd * 1000) : null,
  }
}

let stripeClient: Stripe | undefined

export function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) throw new Error('La facturation Stripe n’est pas encore configurée.')
  stripeClient ??= new Stripe(key)
  return stripeClient
}

export function hasStripeConfiguration() {
  return Boolean(
    process.env.STRIPE_SECRET_KEY &&
      process.env.STRIPE_WEBHOOK_SECRET &&
      process.env.STRIPE_PRICE_SOLO &&
      process.env.STRIPE_PRICE_STUDIO &&
      process.env.STRIPE_PRICE_AGENCY,
  )
}
