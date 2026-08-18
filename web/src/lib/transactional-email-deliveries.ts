import 'server-only'

import { and, eq, inArray, lte, or, sql } from 'drizzle-orm'
import { transactionalEmailDeliveries } from '@/db/schema'
import { withSystemTransaction } from '@/db/transactions'
import { NonRetryableJobError } from '@/lib/jobs'

export const TERMINAL_EMAIL_DELIVERY_STATUSES = [
  'delivered',
  'failed',
  'suppressed',
  'hard_bounced',
  'complained',
] as const

export async function claimTransactionalEmailDelivery(input: {
  workspaceId?: string | null
  category: string
  businessKey: string
  recipientHash: string
  contentHash: string
  now?: Date
}) {
  const now = input.now ?? new Date()
  const staleSubmittingAt = new Date(now.getTime() - 5 * 60_000)
  return withSystemTransaction(async (db) => {
    const [inserted] = await db.insert(transactionalEmailDeliveries).values({
      workspaceId: input.workspaceId ?? null,
      category: input.category,
      businessKey: input.businessKey,
      recipientHash: input.recipientHash,
      contentHash: input.contentHash,
    }).onConflictDoNothing({ target: transactionalEmailDeliveries.businessKey }).returning()
    const existing = inserted ?? await db.query.transactionalEmailDeliveries.findFirst({
      where: eq(transactionalEmailDeliveries.businessKey, input.businessKey),
    })
    if (!existing) throw new Error('Unable to resolve transactional email delivery')
    if (
      existing.recipientHash !== input.recipientHash
      || existing.category !== input.category
      || existing.contentHash !== input.contentHash
    ) {
      throw new NonRetryableJobError('Transactional email idempotency key conflicts with another message')
    }
    if (['accepted', 'sent', ...TERMINAL_EMAIL_DELIVERY_STATUSES].includes(existing.status as never)) {
      return { delivery: existing, claimed: false }
    }
    const [claimed] = await db.update(transactionalEmailDeliveries).set({
      status: 'submitting',
      attemptCount: sql`${transactionalEmailDeliveries.attemptCount} + 1`,
      lastError: null,
      updatedAt: now,
    }).where(and(
      eq(transactionalEmailDeliveries.id, existing.id),
      or(
        inArray(transactionalEmailDeliveries.status, ['pending', 'ambiguous']),
        and(eq(transactionalEmailDeliveries.status, 'submitting'), lte(transactionalEmailDeliveries.updatedAt, staleSubmittingAt)),
      ),
    )).returning()
    return { delivery: claimed ?? existing, claimed: Boolean(claimed) }
  })
}

export function markTransactionalEmailAccepted(
  deliveryId: string,
  providerMessageId: string,
  providerStatus = 'queued',
  acceptedAt = new Date(),
) {
  const status = providerStatus === 'delivered' ? 'delivered'
    : providerStatus === 'hard_bounced' ? 'hard_bounced'
      : providerStatus === 'complained' ? 'complained'
        : providerStatus === 'suppressed' ? 'suppressed'
          : providerStatus === 'failed' || providerStatus === 'soft_bounced' ? 'failed'
            : providerStatus === 'unknown' ? 'ambiguous'
              : providerStatus === 'sent' ? 'sent'
                : 'accepted'
  const terminal = ['delivered', 'hard_bounced', 'complained', 'suppressed', 'failed'].includes(status)
  return withSystemTransaction((db) => db.update(transactionalEmailDeliveries).set({
    providerMessageId,
    status,
    acceptedAt,
    deliveredAt: status === 'delivered' ? acceptedAt : null,
    terminalAt: terminal ? acceptedAt : null,
    lastError: ['failed', 'hard_bounced', 'complained', 'suppressed', 'ambiguous'].includes(status) ? `yodevmail_${providerStatus}` : null,
    updatedAt: acceptedAt,
  }).where(eq(transactionalEmailDeliveries.id, deliveryId)))
}

export function markTransactionalEmailFailure(
  deliveryId: string,
  status: 'pending' | 'failed' | 'ambiguous',
  error: unknown,
  now = new Date(),
) {
  return withSystemTransaction((db) => db.update(transactionalEmailDeliveries).set({
    status,
    lastError: (error instanceof Error ? error.message : String(error)).slice(0, 2000),
    terminalAt: status === 'failed' ? now : null,
    updatedAt: now,
  }).where(eq(transactionalEmailDeliveries.id, deliveryId)))
}
