import Stripe from 'stripe'

const secretKey = process.env.STRIPE_SECRET_KEY
if (!secretKey?.includes('_test_')) throw new Error('Refusing to run the billing drill outside Stripe test mode')
const soloPrice = process.env.STRIPE_PRICE_SOLO
const studioPrice = process.env.STRIPE_PRICE_STUDIO
if (!soloPrice || !studioPrice) throw new Error('STRIPE_PRICE_SOLO and STRIPE_PRICE_STUDIO are required')

const stripe = new Stripe(secretKey)
let customerId: string | undefined
let subscriptionId: string | undefined
let scheduleId: string | undefined
let failedCustomerId: string | undefined
let failedSubscriptionId: string | undefined

function itemPeriod(subscription: Stripe.Subscription) {
  const items = subscription.items.data.filter((item) => item.price.recurring)
  if (items.length !== 1) throw new Error(`Expected one recurring item, received ${items.length}`)
  return items[0]
}

async function main() {
  const drillStartedAt = Math.floor(Date.now() / 1000)
  const paymentMethod = await stripe.paymentMethods.create({ type: 'card', card: { token: 'tok_visa' } })
  const customer = await stripe.customers.create({
    name: 'YoDevAds automated Stripe drill',
    payment_method: paymentMethod.id,
    invoice_settings: { default_payment_method: paymentMethod.id },
    metadata: { yodev_drill: 'plan_change' },
  })
  customerId = customer.id
  const subscription = await stripe.subscriptions.create({
    customer: customer.id,
    items: [{ price: soloPrice, quantity: 1 }],
    payment_behavior: 'error_if_incomplete',
    payment_settings: { save_default_payment_method: 'on_subscription' },
    metadata: { yodev_drill: 'plan_change' },
  })
  subscriptionId = subscription.id
  const soloItem = itemPeriod(subscription)
  if (soloItem.price.id !== soloPrice || subscription.status !== 'active') {
    throw new Error(`Solo activation failed (${subscription.status}, ${soloItem.price.id})`)
  }

  const upgraded = await stripe.subscriptions.update(subscription.id, {
    items: [{ id: soloItem.id, price: studioPrice, quantity: 1 }],
    payment_behavior: 'pending_if_incomplete',
    proration_behavior: 'always_invoice',
  }, { idempotencyKey: `drill-upgrade:${subscription.id}:studio` })
  const studioItem = itemPeriod(upgraded)
  if (studioItem.price.id !== studioPrice || upgraded.pending_update) {
    throw new Error(`Paid upgrade was not applied (${studioItem.price.id}, pending=${Boolean(upgraded.pending_update)})`)
  }

  const schedule = await stripe.subscriptionSchedules.create({
    from_subscription: upgraded.id,
  }, { idempotencyKey: `drill-schedule:${upgraded.id}` })
  scheduleId = schedule.id
  if (!schedule.current_phase) throw new Error('Schedule has no current phase')
  const configured = await stripe.subscriptionSchedules.update(schedule.id, {
    end_behavior: 'release',
    proration_behavior: 'none',
    metadata: { yodev_drill: 'plan_change' },
    phases: [
      {
        start_date: schedule.current_phase.start_date,
        end_date: schedule.current_phase.end_date,
        items: [{ price: studioPrice, quantity: 1 }],
        proration_behavior: 'none',
      },
      {
        start_date: schedule.current_phase.end_date,
        duration: { interval: 'month', interval_count: 1 },
        items: [{ price: soloPrice, quantity: 1 }],
        proration_behavior: 'none',
      },
    ],
  }, { idempotencyKey: `drill-downgrade:${upgraded.id}:solo` })
  const future = configured.phases.find((phase) => phase.start_date === schedule.current_phase?.end_date)
  const futurePriceObject = future?.items[0]?.price
  const futurePrice = typeof futurePriceObject === 'string' ? futurePriceObject : futurePriceObject?.id
  if (futurePrice !== soloPrice) throw new Error(`Scheduled downgrade has unexpected price ${futurePrice}`)

  await stripe.subscriptionSchedules.release(schedule.id, { preserve_cancel_date: true })
  scheduleId = undefined
  const afterRelease = await stripe.subscriptions.retrieve(upgraded.id)
  if (afterRelease.schedule) throw new Error('Schedule release did not detach the subscription')

  const paidCharge = (await stripe.charges.list({ customer: customer.id, limit: 10 })).data
    .find((charge) => charge.paid && charge.amount > 1 && charge.amount_refunded === 0)
  if (!paidCharge) throw new Error('No paid subscription charge was available for the refund drill')
  const partialRefund = await stripe.refunds.create({
    charge: paidCharge.id,
    amount: 1,
    metadata: { yodev_drill: 'partial_refund' },
  }, { idempotencyKey: `drill-refund-partial:${paidCharge.id}` })
  if (partialRefund.status !== 'succeeded' || partialRefund.amount !== 1) {
    throw new Error(`Partial refund failed (${partialRefund.status}, ${partialRefund.amount})`)
  }
  const fullRefund = await stripe.refunds.create({
    charge: paidCharge.id,
    amount: paidCharge.amount - 1,
    metadata: { yodev_drill: 'full_refund' },
  }, { idempotencyKey: `drill-refund-full:${paidCharge.id}` })
  const refundedCharge = await stripe.charges.retrieve(paidCharge.id)
  if (fullRefund.status !== 'succeeded' || !refundedCharge.refunded || refundedCharge.amount_refunded !== paidCharge.amount) {
    throw new Error('Full refund did not reconcile with the authoritative charge')
  }

  const failingPaymentMethod = await stripe.paymentMethods.create({
    type: 'card',
    card: { token: 'tok_chargeCustomerFail' },
  })
  const failedCustomer = await stripe.customers.create({
    name: 'Ads by Yodev failed-payment drill',
    payment_method: failingPaymentMethod.id,
    invoice_settings: { default_payment_method: failingPaymentMethod.id },
    metadata: { yodev_drill: 'payment_failure' },
  })
  failedCustomerId = failedCustomer.id
  const failedSubscription = await stripe.subscriptions.create({
    customer: failedCustomer.id,
    items: [{ price: soloPrice, quantity: 1 }],
    payment_behavior: 'allow_incomplete',
    payment_settings: { save_default_payment_method: 'on_subscription' },
    metadata: { yodev_drill: 'payment_failure' },
  })
  failedSubscriptionId = failedSubscription.id
  if (failedSubscription.status !== 'incomplete') {
    throw new Error(`Failed-payment subscription had unexpected status ${failedSubscription.status}`)
  }

  const failedInvoice = typeof failedSubscription.latest_invoice === 'string'
    ? await stripe.invoices.retrieve(failedSubscription.latest_invoice)
    : failedSubscription.latest_invoice
  if (!failedInvoice || failedInvoice.status !== 'open' || failedInvoice.attempted !== true) {
    throw new Error('Failed-payment invoice did not remain open after an attempted collection')
  }

  const recentEvents = await stripe.events.list({
    created: { gte: drillStartedAt },
    types: ['charge.refunded', 'invoice.payment_failed'],
    limit: 100,
  })
  const eventTypes = new Set(recentEvents.data.map((event) => event.type))
  if (!eventTypes.has('charge.refunded') || !eventTypes.has('invoice.payment_failed')) {
    throw new Error(`Stripe lifecycle events were incomplete (${[...eventTypes].join(', ')})`)
  }

  process.stdout.write(`${JSON.stringify({
    mode: 'test',
    soloActivated: true,
    upgradePaidAndApplied: true,
    downgradeScheduledAt: new Date(schedule.current_phase.end_date * 1000).toISOString(),
    scheduleCanceled: true,
    failedPaymentObserved: true,
    partialRefundSucceeded: true,
    fullRefundSucceeded: true,
    lifecycleEventsObserved: [...eventTypes].sort(),
  }, null, 2)}\n`)
}

void main().finally(async () => {
  if (scheduleId) {
    try { await stripe.subscriptionSchedules.release(scheduleId, { preserve_cancel_date: true }) } catch { /* cleanup best effort */ }
  }
  if (subscriptionId) {
    try { await stripe.subscriptions.cancel(subscriptionId, { invoice_now: false, prorate: false }) } catch { /* cleanup best effort */ }
  }
  if (failedSubscriptionId) {
    try { await stripe.subscriptions.cancel(failedSubscriptionId, { invoice_now: false, prorate: false }) } catch { /* cleanup best effort */ }
  }
  if (customerId) {
    try { await stripe.customers.del(customerId) } catch { /* cleanup best effort */ }
  }
  if (failedCustomerId) {
    try { await stripe.customers.del(failedCustomerId) } catch { /* cleanup best effort */ }
  }
})
