import Stripe from 'stripe'

const secretKey = process.env.STRIPE_SECRET_KEY
if (!secretKey) throw new Error('STRIPE_SECRET_KEY is required')
const configuredSecretKey: string = secretKey

const stripe = new Stripe(configuredSecretKey)

async function main() {
  const [account, products, prices, portals, webhooks] = await Promise.all([
    stripe.accounts.retrieveCurrent(),
    stripe.products.list({ limit: 100 }),
    stripe.prices.list({ limit: 100 }),
    stripe.billingPortal.configurations.list({ limit: 100 }),
    stripe.webhookEndpoints.list({ limit: 100 }),
  ])
  const yodevProducts = products.data.filter((product) =>
    product.metadata.yodev_product === 'ads' || /ads by yodev/i.test(product.name),
  )
  const yodevProductIds = new Set(yodevProducts.map((product) => product.id))
  const yodevPrices = prices.data.filter((price) => {
    const productId = typeof price.product === 'string' ? price.product : price.product.id
    return yodevProductIds.has(productId) || price.metadata.yodev_product === 'ads'
  })
  process.stdout.write(`${JSON.stringify({
    mode: configuredSecretKey.includes('_live_') ? 'live' : 'test',
    account: {
      id: account.id,
      country: account.country,
      defaultCurrency: account.default_currency,
      chargesEnabled: account.charges_enabled,
      payoutsEnabled: account.payouts_enabled,
      detailsSubmitted: account.details_submitted,
    },
    products: yodevProducts.map((product) => ({
      id: product.id,
      name: product.name,
      active: product.active,
      metadata: product.metadata,
    })),
    prices: yodevPrices.map((price) => ({
      id: price.id,
      productId: typeof price.product === 'string' ? price.product : price.product.id,
      active: price.active,
      currency: price.currency,
      unitAmount: price.unit_amount,
      recurring: price.recurring ? { interval: price.recurring.interval, intervalCount: price.recurring.interval_count } : null,
      lookupKey: price.lookup_key,
      metadata: price.metadata,
    })),
    portalConfigurations: portals.data.map((portal) => ({
      id: portal.id,
      active: portal.active,
      isDefault: portal.is_default,
      metadata: portal.metadata,
      features: portal.features,
    })),
    webhookEndpoints: webhooks.data.map((endpoint) => ({
      id: endpoint.id,
      url: endpoint.url,
      status: endpoint.status,
      enabledEvents: endpoint.enabled_events,
      apiVersion: endpoint.api_version,
    })),
  }, null, 2)}\n`)
}

void main()
