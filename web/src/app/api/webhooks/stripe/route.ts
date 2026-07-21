import type Stripe from 'stripe'
import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { getDb } from '@/db'
import { auditEvents, workspaces } from '@/db/schema'
import { getStripe, subscriptionRecord } from '@/lib/billing'

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

  if (
    event.type === 'customer.subscription.created' ||
    event.type === 'customer.subscription.updated' ||
    event.type === 'customer.subscription.deleted'
  ) {
    const record = subscriptionRecord(event.data.object)
    if (!record.workspaceId || !record.plan) {
      return NextResponse.json({ error: 'Missing workspace or plan metadata' }, { status: 422 })
    }
    const [workspace] = await getDb()
      .update(workspaces)
      .set({
        plan: record.plan,
        stripeCustomerId: record.stripeCustomerId,
        stripeSubscriptionId: record.stripeSubscriptionId,
        subscriptionStatus: record.subscriptionStatus,
        subscriptionCurrentPeriodEnd: record.subscriptionCurrentPeriodEnd,
        updatedAt: new Date(),
      })
      .where(eq(workspaces.id, record.workspaceId))
      .returning({ id: workspaces.id })
    if (!workspace) return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
    await getDb().insert(auditEvents).values({
      workspaceId: workspace.id,
      actorUserId: 'system:stripe',
      action: `billing.${event.type}`,
      entityType: 'workspace',
      entityId: workspace.id,
      metadata: { eventId: event.id, plan: record.plan, status: record.subscriptionStatus },
    })
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
