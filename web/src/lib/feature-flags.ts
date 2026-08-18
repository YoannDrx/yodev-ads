import 'server-only'

import { z } from 'zod'

const booleanFlagSchema = z.enum(['0', '1']).default('0')

export const featureFlagEnvironment = {
  googleReads: 'GOOGLE_READS_ENABLED',
  googleMutations: 'GOOGLE_MUTATIONS_ENABLED',
  stripeCheckout: 'STRIPE_CHECKOUT_ENABLED',
  publicApi: 'PUBLIC_API_ENABLED',
  customDomains: 'CUSTOM_DOMAINS_ENABLED',
  publicBeta: 'PUBLIC_BETA_ENABLED',
  scheduler: 'SCHEDULER_ENABLED',
  notifications: 'NOTIFICATIONS_ENABLED',
  forceReadOnly: 'FORCE_READ_ONLY',
  googleMutationStatus: 'GOOGLE_MUTATION_STATUS_ENABLED',
  googleMutationBudget: 'GOOGLE_MUTATION_BUDGET_ENABLED',
  googleMutationKeywords: 'GOOGLE_MUTATION_KEYWORDS_ENABLED',
  googleMutationAds: 'GOOGLE_MUTATION_ADS_ENABLED',
  googleMutationBatch: 'GOOGLE_MUTATION_BATCH_ENABLED',
} as const

export type FeatureFlag = keyof typeof featureFlagEnvironment

export function featureEnabled(flag: FeatureFlag) {
  const value = process.env[featureFlagEnvironment[flag]]
  return booleanFlagSchema.parse(value) === '1'
}

export function privateApiWorkspaceAllowed(workspaceId: string, accessState: string) {
  if (!featureEnabled('publicApi')) return false
  if (accessState === 'internal') return true
  const allowlist = new Set((process.env.PRIVATE_API_WORKSPACE_IDS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean))
  return allowlist.has(workspaceId)
}

export function requireFeature(flag: FeatureFlag, message: string) {
  if (!featureEnabled(flag)) throw new Error(message)
}

export function requireWritableProduct() {
  requireFeature('googleMutations', 'Les mutations Google Ads sont temporairement désactivées.')
  if (featureEnabled('forceReadOnly')) throw new Error('Le produit est temporairement en lecture seule.')
}

export const GOOGLE_MUTATION_KINDS = [
  'campaign_status',
  'campaign_budget',
  'budget_reallocation',
  'atomic_change_batch',
  'keyword_create_negative',
  'keyword_create_positive',
  'keyword_status',
  'ad_status',
  'rsa_create_draft',
] as const

export type GoogleMutationKind = (typeof GOOGLE_MUTATION_KINDS)[number]

export function requireGoogleMutationKind(rawKind: string) {
  if (!GOOGLE_MUTATION_KINDS.includes(rawKind as GoogleMutationKind)) throw new Error('Type de mutation Google Ads non pris en charge.')
  const kind = rawKind as GoogleMutationKind
  const flag: FeatureFlag = kind === 'campaign_status'
    ? 'googleMutationStatus'
    : kind === 'campaign_budget'
      ? 'googleMutationBudget'
      : kind === 'budget_reallocation' || kind === 'atomic_change_batch'
        ? 'googleMutationBatch'
        : kind.startsWith('keyword_')
          ? 'googleMutationKeywords'
          : 'googleMutationAds'
  requireFeature(flag, `Le type de mutation Google Ads « ${kind} » est temporairement désactivé.`)
}
