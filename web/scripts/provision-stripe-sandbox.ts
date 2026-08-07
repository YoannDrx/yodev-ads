import { spawnSync } from 'node:child_process'
import Stripe from 'stripe'

const secretKey = process.env.STRIPE_SECRET_KEY
if (!secretKey) throw new Error('STRIPE_SECRET_KEY is required')
if (!secretKey.includes('_test_')) throw new Error('Refusing to provision products outside a Stripe sandbox')

const stripe = new Stripe(secretKey)
const plans = [
  { id: 'solo', name: 'Ads by Yodev Solo', amount: 2_900 },
  { id: 'studio', name: 'Ads by Yodev Studio', amount: 8_900 },
  { id: 'agency', name: 'Ads by Yodev Agency', amount: 18_900 },
] as const

function setVercelEnvironment(name: string, value: string, sensitive = false) {
  const targets = sensitive
    ? [
        { environments: 'production,preview', visibility: '--sensitive' },
        { environments: 'development', visibility: '--no-sensitive' },
      ]
    : [{ environments: 'production,preview,development', visibility: '--no-sensitive' }]
  for (const target of targets) {
    const result = spawnSync(
      'vercel',
      ['env', 'add', name, target.environments, '--force', '--yes', target.visibility],
      { cwd: process.cwd(), input: value, encoding: 'utf8' },
    )
    if (result.status !== 0) throw new Error(`Unable to configure ${name}: ${result.stderr || result.stdout}`)
  }
  process.stdout.write(`Configured ${name} in Vercel.\n`)
}

async function main() {
  const existingProducts = await stripe.products.list({ active: true, limit: 100 })
  for (const plan of plans) {
    const product =
      existingProducts.data.find((item) => item.metadata.yodev_product === 'ads' && item.metadata.yodev_plan === plan.id) ??
      (await stripe.products.create({
        name: plan.name,
        metadata: { yodev_product: 'ads', yodev_plan: plan.id },
      }))
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
    setVercelEnvironment(`STRIPE_PRICE_${plan.id.toUpperCase()}`, price.id)
  }

  const endpointUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? 'https://ads.yodev.fr'}/api/webhooks/stripe`
  const endpoints = await stripe.webhookEndpoints.list({ limit: 100 })
  const existingEndpoint = endpoints.data.find((endpoint) => endpoint.url === endpointUrl && endpoint.status === 'enabled')
  if (existingEndpoint && !process.env.STRIPE_WEBHOOK_SECRET) {
    throw new Error('The Ads by Yodev webhook already exists. Rotate its signing secret in Stripe before provisioning.')
  }
  if (!existingEndpoint) {
    const endpoint = await stripe.webhookEndpoints.create({
      url: endpointUrl,
      enabled_events: [
        'customer.subscription.created',
        'customer.subscription.updated',
        'customer.subscription.deleted',
      ],
      description: 'Ads by Yodev subscription lifecycle',
    })
    if (!endpoint.secret) throw new Error('Stripe did not return a webhook signing secret')
    setVercelEnvironment('STRIPE_WEBHOOK_SECRET', endpoint.secret, true)
  }
}

void main()
