import 'server-only'

import { randomBytes } from 'node:crypto'
import Stripe from 'stripe'
import { z } from 'zod'
import type { WorkspaceAccessState } from '@/lib/entitlements'
import type { Locale } from '@/lib/i18n'

const taxModeSchema = z.enum(['exempt_293b', 'stripe_tax'])

export type TaxMode = z.infer<typeof taxModeSchema>

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

const planFeaturesByLocale = {
  fr: {
    solo: ['Analyse 360°', 'Vigies quotidiennes', 'Rapports clients'],
    studio: ['Tout Solo', 'Approbations collaboratives', 'Notifications multicanales', 'API agence'],
    agency: ['Tout Studio', 'Marque blanche', 'Règles de sécurité', 'Support prioritaire'],
  },
  en: {
    solo: ['360° analysis', 'Daily monitors', 'Client reports'],
    studio: ['Everything in Solo', 'Collaborative approvals', 'Multichannel notifications', 'Agency API'],
    agency: ['Everything in Studio', 'White label', 'Safety policies', 'Priority support'],
  },
} as const satisfies Record<Locale, Record<PlanId, readonly string[]>>

export function planFeaturesForLocale(plan: PlanId, locale: Locale) {
  return planFeaturesByLocale[locale][plan]
}

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
  return accountsWithinLimit(accounts, accountLimitForPlan(plan))
}

export function accountsWithinLimit<T extends { customerId: string; isManager: boolean }>(
  accounts: T[],
  limit: number | null,
) {
  const sorted = [...accounts].sort((left, right) => left.customerId.localeCompare(right.customerId))
  const managers = sorted.filter((account) => account.isManager)
  const advertisers = sorted.filter((account) => !account.isManager)
  return {
    included: [...managers, ...(limit === null ? advertisers : advertisers.slice(0, limit))],
    excluded: limit === null ? [] : advertisers.slice(limit),
    limit,
  }
}

export function subscriptionIsActive(status: string) {
  return ['active', 'trialing'].includes(status)
}

export function accessStateForSubscription(
  status: Stripe.Subscription.Status,
  eventCreatedAt: Date,
): { accessState: WorkspaceAccessState; graceEndsAt: Date | null } {
  if (status === 'active' || status === 'trialing') return { accessState: 'active', graceEndsAt: null }
  if (status === 'past_due') {
    return { accessState: 'grace', graceEndsAt: new Date(eventCreatedAt.getTime() + 7 * 24 * 60 * 60 * 1000) }
  }
  return { accessState: 'suspended', graceEndsAt: null }
}

export function checkoutTaxConfiguration() {
  const mode = taxModeSchema.safeParse(process.env.STRIPE_TAX_MODE)
  if (!mode.success) {
    throw new Error('Le checkout est bloqué tant que STRIPE_TAX_MODE n’est pas explicitement configuré.')
  }
  if (mode.data === 'stripe_tax' && process.env.STRIPE_TAX_CONFIGURATION_VALIDATED !== '1') {
    throw new Error('Stripe Tax doit être validé juridiquement et comptablement avant activation.')
  }
  return {
    mode: mode.data,
    automaticTax: { enabled: mode.data === 'stripe_tax' },
  }
}

export function taxCheckoutCopy(mode: TaxMode, locale: Locale) {
  if (mode === 'exempt_293b') {
    return {
      checkoutMessage: locale === 'en'
        ? 'VAT not applicable — Article 293 B of the French General Tax Code. This wording will appear on your invoices.'
        : 'TVA non applicable, article 293 B du Code général des impôts. Cette mention figurera sur vos factures.',
      invoiceFooter: 'TVA non applicable, article 293 B du Code général des impôts.',
    }
  }
  return {
    checkoutMessage: locale === 'en'
      ? 'Applicable taxes are calculated from your billing address and tax status.'
      : 'Les taxes applicables sont calculées selon votre adresse de facturation et votre statut fiscal.',
    invoiceFooter: '',
  }
}

export function checkoutIntegrationIdentifier() {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz'
  const suffix = [...randomBytes(8)].map((value) => alphabet[value % alphabet.length]).join('')
  return `yodev_ads_${suffix}`
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

export function chargeRefundRecord(charge: Stripe.Charge) {
  const customerId = typeof charge.customer === 'string' ? charge.customer : charge.customer?.id
  if (!customerId || charge.amount_refunded <= 0) return null
  return {
    customerId,
    chargeId: charge.id,
    paymentIntentId: typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id ?? null,
    currency: charge.currency.toUpperCase(),
    originalAmount: charge.amount,
    refundedAmount: charge.amount_refunded,
    fullyRefunded: charge.refunded || charge.amount_refunded >= charge.amount,
  }
}

export function shouldNotifyInvoiceEvent(input: {
  type: 'invoice.paid' | 'invoice.payment_failed'
  eventCreatedAt: Date
  stateAppliedAt: Date | null
  subscriptionStatus: string
}) {
  if (!input.stateAppliedAt || input.stateAppliedAt <= input.eventCreatedAt) return true
  return input.type === 'invoice.paid'
    ? subscriptionIsActive(input.subscriptionStatus)
    : input.subscriptionStatus === 'past_due'
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
