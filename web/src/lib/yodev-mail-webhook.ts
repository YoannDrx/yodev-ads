import 'server-only'

import { createHmac, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import { yodevMailEvents } from '@/db/schema'
import { withSystemTransaction } from '@/db/transactions'

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
    return { duplicate: inserted.length === 0 }
  })
}
