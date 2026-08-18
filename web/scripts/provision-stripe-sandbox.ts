import { spawnSync } from 'node:child_process'
import Stripe from 'stripe'

const secretKey = process.env.STRIPE_SECRET_KEY
if (!secretKey) throw new Error('STRIPE_SECRET_KEY is required')
if (!secretKey.includes('_test_')) throw new Error('Refusing to provision products outside a Stripe sandbox')
const vercelProject = process.env.YODEV_VERCEL_PROJECT
if (!vercelProject) throw new Error('YODEV_VERCEL_PROJECT is required to prevent accidental production configuration')
const appUrl = process.env.NEXT_PUBLIC_APP_URL
if (!appUrl || !appUrl.startsWith('https://')) throw new Error('NEXT_PUBLIC_APP_URL must be an HTTPS staging URL')
const targetVercelProject: string = vercelProject
const targetAppUrl: string = appUrl

const stripe = new Stripe(secretKey)
const plans = [
  { id: 'solo', name: 'Ads by Yodev Solo', amount: 2_900 },
  { id: 'studio', name: 'Ads by Yodev Studio', amount: 8_900 },
  { id: 'agency', name: 'Ads by Yodev Agency', amount: 18_900 },
] as const

function setVercelEnvironment(name: string, value: string, sensitive = false) {
  const targets = [{ environments: 'production', visibility: sensitive ? '--sensitive' : '--no-sensitive' }]
  for (const target of targets) {
    const result = spawnSync(
      'npx',
      ['vercel', 'env', 'add', name, target.environments, '--project', targetVercelProject, '--force', '--yes', target.visibility],
      { cwd: process.cwd(), input: value, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
    )
    if (result.status !== 0) {
      const safeOutput = `${result.stderr || result.stdout}`.replaceAll(value, '[REDACTED]')
      throw new Error(`Unable to configure ${name}: ${safeOutput}`)
    }
  }
  process.stdout.write(`Configured ${name} in Vercel project ${targetVercelProject}.\n`)
}

async function main() {
  const existingProducts = await stripe.products.list({ active: true, limit: 100 })
  const product = existingProducts.data.find(
    (item) => item.metadata.yodev_product === 'ads' && item.metadata.yodev_catalog === 'commercial_v1',
  ) ?? await stripe.products.create({
    name: 'Ads by Yodev',
    metadata: { yodev_product: 'ads', yodev_catalog: 'commercial_v1' },
  })
  const configuredPrices: string[] = []
  for (const plan of plans) {
    const prices = await stripe.prices.list({ product: product.id, active: true, limit: 100 })
    const price =
      prices.data.find(
        (item) =>
          item.currency === 'eur' &&
          item.unit_amount === plan.amount &&
          item.recurring?.interval === 'month',
      ) ??
      (await stripe.prices.create({
        product: product.id,
        currency: 'eur',
        unit_amount: plan.amount,
        recurring: { interval: 'month' },
        lookup_key: `yodev_ads_${plan.id}_monthly_v1`,
        transfer_lookup_key: true,
        metadata: { yodev_product: 'ads', yodev_plan: plan.id },
      }))
    configuredPrices.push(price.id)
    setVercelEnvironment(`STRIPE_PRICE_${plan.id.toUpperCase()}`, price.id)
  }

  const portalConfigurations = await stripe.billingPortal.configurations.list({ active: true, limit: 100 })
  const portalMetadata = { yodev_product: 'ads', yodev_environment: 'staging' }
  const existingPortal = portalConfigurations.data.find(
    (configuration) => configuration.metadata?.yodev_product === portalMetadata.yodev_product
      && configuration.metadata?.yodev_environment === portalMetadata.yodev_environment,
  )
  const portalFeatures: Stripe.BillingPortal.ConfigurationCreateParams.Features = {
    customer_update: {
      enabled: true,
      allowed_updates: ['address', 'email', 'name', 'phone', 'tax_id'],
    },
    invoice_history: { enabled: true },
    payment_method_update: { enabled: true },
    subscription_cancel: {
      enabled: true,
      mode: 'at_period_end',
      proration_behavior: 'none',
      cancellation_reason: {
        enabled: true,
        options: ['too_expensive', 'missing_features', 'switched_service', 'unused', 'customer_service', 'other'],
      },
    },
    // Stripe's hosted portal rejects several prices with the same recurring
    // interval on a single product. YoDevAds deliberately keeps one commercial
    // product and handles upgrades/downgrades through its audited billing
    // actions, so the portal is limited to payment details, invoices and
    // cancellation.
    subscription_update: { enabled: false },
  }
  const portal = existingPortal
    ? await stripe.billingPortal.configurations.update(existingPortal.id, {
        business_profile: {
          headline: 'Ads by Yodev — gestion de votre abonnement',
          privacy_policy_url: `${targetAppUrl}/privacy`,
          terms_of_service_url: `${targetAppUrl}/terms`,
        },
        default_return_url: `${targetAppUrl}/billing`,
        features: portalFeatures,
      })
    : await stripe.billingPortal.configurations.create({
        business_profile: {
          headline: 'Ads by Yodev — gestion de votre abonnement',
          privacy_policy_url: `${targetAppUrl}/privacy`,
          terms_of_service_url: `${targetAppUrl}/terms`,
        },
        default_return_url: `${targetAppUrl}/billing`,
        features: portalFeatures,
        metadata: portalMetadata,
      })
  setVercelEnvironment('STRIPE_PORTAL_CONFIGURATION_ID', portal.id)

  const endpointUrl = `${targetAppUrl}/api/webhooks/stripe`
  const endpoints = await stripe.webhookEndpoints.list({ limit: 100 })
  const existingEndpoint = endpoints.data.find((endpoint) => endpoint.url === endpointUrl && endpoint.status === 'enabled')
  const enabledEvents: Stripe.WebhookEndpointCreateParams.EnabledEvent[] = [
    'charge.refunded',
    'checkout.session.completed',
    'customer.subscription.created',
    'customer.subscription.updated',
    'customer.subscription.deleted',
    'customer.subscription.pending_update_applied',
    'customer.subscription.pending_update_expired',
    'subscription_schedule.created',
    'subscription_schedule.updated',
    'subscription_schedule.completed',
    'subscription_schedule.canceled',
    'invoice.paid',
    'invoice.payment_failed',
    'invoice.payment_action_required',
  ]
  if (existingEndpoint && !process.env.STRIPE_WEBHOOK_SECRET) {
    throw new Error('The Ads by Yodev webhook already exists. Rotate its signing secret in Stripe before provisioning.')
  }
  if (existingEndpoint) {
    await stripe.webhookEndpoints.update(existingEndpoint.id, {
      enabled_events: enabledEvents,
      description: 'Ads by Yodev staging subscription, invoice and refund lifecycle',
    })
  }
  if (!existingEndpoint) {
    const endpoint = await stripe.webhookEndpoints.create({
      url: endpointUrl,
      enabled_events: enabledEvents,
      description: 'Ads by Yodev staging subscription, invoice and refund lifecycle',
    })
    if (!endpoint.secret) throw new Error('Stripe did not return a webhook signing secret')
    setVercelEnvironment('STRIPE_WEBHOOK_SECRET', endpoint.secret, true)
  }
}

void main()
