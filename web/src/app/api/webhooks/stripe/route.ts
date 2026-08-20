import type Stripe from 'stripe'
import { NextResponse } from 'next/server'
import { getStripe } from '@/lib/billing'
import { processStripeWebhookEvent } from '@/lib/stripe-webhook-service'

export async function POST(request: Request) {
  const startedAt = Date.now()
  const signature = request.headers.get('stripe-signature')
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET
  if (!signature || !webhookSecret) {
    return NextResponse.json({ error: 'Stripe webhook is not configured' }, { status: 503 })
  }

  let event: Stripe.Event
  try {
    event = getStripe().webhooks.constructEvent(await request.text(), signature, webhookSecret)
  } catch (error) {
    console.error(JSON.stringify({
      level: 'error',
      message: 'stripe.webhook.invalid_signature',
      error: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - startedAt,
    }))
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  try {
    const result = await processStripeWebhookEvent(event, { stripe: getStripe() })
    if (result.duplicate) return NextResponse.json({ received: true, duplicate: true })
  } catch (error) {
    console.error(JSON.stringify({
      level: 'error',
      message: 'stripe.webhook.failed',
      eventId: event.id,
      eventType: event.type,
      error: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - startedAt,
    }))
    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 })
  }

  console.log(JSON.stringify({
    level: 'info',
    message: 'stripe.webhook.processed',
    eventId: event.id,
    eventType: event.type,
    durationMs: Date.now() - startedAt,
  }))
  return NextResponse.json({ received: true })
}
