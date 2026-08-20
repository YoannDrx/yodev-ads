import 'server-only'

import { createHmac, timingSafeEqual } from 'node:crypto'
import { desc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { jobs, transactionalEmailDeliveries, yodevMailEvents } from '@/db/schema'
import { withSystemTransaction } from '@/db/transactions'
import { operationsAlertJob } from '@/lib/operations-alert-model'

const eventSchema = z.object({
  id: z.string().uuid(),
  type: z.enum(['email.queued', 'email.sent', 'email.delivered', 'email.failed', 'email.suppressed', 'email.hard_bounced', 'email.soft_bounced', 'email.complained']),
  created_at: z.coerce.date(),
  data: z.object({ message_id: z.string().uuid() }).strict(),
}).strict()

function equal(left: string, right: string) {
  const a = Buffer.from(left)
  const b = Buffer.from(right)
  return a.length === b.length && timingSafeEqual(a, b)
}

export function verifyAndParseYodevMailWebhook(input: {
  body: string
  signature: string
  timestamp: string
  secret: string
  now?: Date
}) {
  const now = input.now ?? new Date()
  if (!/^\d{10}$/.test(input.timestamp)) throw new Error('invalid_timestamp')
  const timestampMs = Number(input.timestamp) * 1000
  if (timestampMs < now.getTime() - 5 * 60_000 || timestampMs > now.getTime() + 60_000) throw new Error('stale_timestamp')
  const expected = createHmac('sha256', input.secret).update(`${input.timestamp}.${input.body}`).digest('hex')
  if (!equal(input.signature, expected)) throw new Error('invalid_signature')
  return eventSchema.parse(JSON.parse(input.body))
}

export async function recordYodevMailEvent(event: z.infer<typeof eventSchema>) {
  return withSystemTransaction(async (db) => {
    const inserted = await db.insert(yodevMailEvents).values({
      eventId: event.id,
      messageId: event.data.message_id,
      type: event.type,
      occurredAt: event.created_at,
    }).onConflictDoNothing().returning({ eventId: yodevMailEvents.eventId })
    if (inserted.length === 0) return { duplicate: true, orphan: false }

    const delivery = await db.query.transactionalEmailDeliveries.findFirst({
      where: eq(transactionalEmailDeliveries.providerMessageId, event.data.message_id),
    })
    if (!delivery) {
      await db.insert(jobs).values(operationsAlertJob({
        kind: 'job_dead_letter',
        sourceId: event.id,
        title: 'Événement YoDevMail orphelin',
        description: `Le message ${event.data.message_id} ne correspond à aucune livraison YoDevAds.`,
      })).onConflictDoNothing({ target: jobs.deduplicationKey })
      return { duplicate: false, orphan: true }
    }

    const events = await db.query.yodevMailEvents.findMany({
      where: eq(yodevMailEvents.messageId, event.data.message_id),
      orderBy: [desc(yodevMailEvents.occurredAt)],
    })
    const types = new Set(events.map((item) => item.type))
    const status = types.has('email.complained') ? 'complained'
      : types.has('email.hard_bounced') ? 'hard_bounced'
        : types.has('email.suppressed') ? 'suppressed'
          : types.has('email.delivered') ? 'delivered'
            : types.has('email.failed') || types.has('email.soft_bounced') ? 'failed'
              : types.has('email.sent') ? 'sent'
                : 'accepted'
    const lastEventAt = events[0]?.occurredAt ?? event.created_at
    const determiningTypes = status === 'complained' ? ['email.complained']
      : status === 'hard_bounced' ? ['email.hard_bounced']
        : status === 'suppressed' ? ['email.suppressed']
          : status === 'delivered' ? ['email.delivered']
            : status === 'failed' ? ['email.failed', 'email.soft_bounced']
              : status === 'sent' ? ['email.sent']
                : ['email.queued']
    const determiningEvent = events.find((item) => determiningTypes.includes(item.type))
    const determiningEventAt = determiningEvent?.occurredAt ?? lastEventAt
    const deliveredAt = status === 'delivered'
      ? events.find((item) => item.type === 'email.delivered')?.occurredAt ?? lastEventAt
      : delivery.deliveredAt
    const terminal = ['delivered', 'failed', 'suppressed', 'hard_bounced', 'complained'].includes(status)
    await db.update(transactionalEmailDeliveries).set({
      status,
      deliveredAt,
      terminalAt: terminal ? determiningEventAt : null,
      lastEventAt,
      lastError: ['failed', 'suppressed', 'hard_bounced', 'complained'].includes(status) ? determiningEvent?.type ?? event.type : null,
      updatedAt: new Date(),
    }).where(eq(transactionalEmailDeliveries.id, delivery.id))

    if (['failed', 'hard_bounced', 'complained'].includes(status)) {
      await db.insert(jobs).values(operationsAlertJob({
        kind: 'job_dead_letter',
        sourceId: event.id,
        title: `Livraison YoDevMail ${status}`,
        description: `La livraison ${delivery.id} (${delivery.category}) nécessite une inspection.`,
      })).onConflictDoNothing({ target: jobs.deduplicationKey })
    }
    return { duplicate: false, orphan: false, status }
  })
}
