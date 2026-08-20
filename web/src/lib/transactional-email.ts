import 'server-only'

import { createHash, createHmac } from 'node:crypto'
import { z } from 'zod'
import { NonRetryableJobError } from '@/lib/jobs'
import {
  claimTransactionalEmailDelivery,
  markTransactionalEmailAccepted,
  markTransactionalEmailFailure,
} from '@/lib/transactional-email-deliveries'
import { currentTransactionalEmailRetryGeneration } from '@/lib/transactional-email-context'

export type TransactionalEmailInput = {
  from: string
  to: string | string[]
  subject: string
  html: string
  text?: string
  idempotencyKey: string
  category: string
  workspaceId?: string | null
  referenceId?: string
}

const acceptedResponseSchema = z.object({
  data: z.object({
    id: z.string().uuid(),
    status: z.enum(['simulated', 'queued', 'sending', 'sent', 'delivered', 'soft_bounced', 'hard_bounced', 'complained', 'suppressed', 'failed', 'unknown']),
  }).strict(),
}).strict()

export class YodevMailAmbiguousError extends Error {
  constructor() {
    super('Résultat YoDevMail ambigu ; réessayer uniquement avec la même clé d’idempotence.')
    this.name = 'YodevMailAmbiguousError'
  }
}

export function hasTransactionalEmailTransport() {
  return Boolean(process.env.YODEV_MAIL_API_KEY)
}

export function plainTextFromHtml(html: string) {
  return html
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|h[1-6]|li)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replaceAll('&nbsp;', ' ')
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#039;', "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function normalizedRecipients(recipients: string | string[]) {
  const values = [...new Set((Array.isArray(recipients) ? recipients : [recipients])
    .map((recipient) => recipient.trim().toLowerCase())
    .filter(Boolean))]
  if (values.length === 0) throw new NonRetryableJobError('Email recipient is required')
  return values
}

function mailbox(value: string) {
  const match = value.trim().match(/^(.*?)\s*<([^<>]+)>$/)
  if (match) return { name: match[1].trim().replace(/^"|"$/g, '') || undefined, email: match[2].trim().toLowerCase() }
  return { email: value.trim().toLowerCase() }
}

function normalizedCategory(value: string) {
  const category = value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '_').slice(0, 64)
  if (!/^[a-z][a-z0-9_]{1,63}$/.test(category)) throw new NonRetryableJobError('Transactional email category is invalid')
  return category
}

function recipientHash(recipient: string) {
  const secret = process.env.YODEV_MAIL_RECIPIENT_HASH_SECRET
  if (!secret && process.env.NODE_ENV === 'production') {
    throw new NonRetryableJobError('YODEV_MAIL_RECIPIENT_HASH_SECRET absent')
  }
  return secret
    ? createHmac('sha256', secret).update(recipient).digest('hex')
    : createHash('sha256').update(`test:${recipient}`).digest('hex')
}

function recipientBusinessKey(baseKey: string, recipient: string, multiple: boolean) {
  const suffix = createHash('sha256').update(recipient).digest('hex').slice(0, 16)
  const key = multiple ? `${baseKey}:${suffix}` : baseKey
  if (!key.trim()) throw new NonRetryableJobError('Transactional email idempotency key is invalid')
  return key.length <= 128 ? key : `yda:${createHash('sha256').update(key).digest('hex')}`
}

function referenceId(value: string) {
  return /^[A-Za-z0-9._:-]{1,128}$/.test(value)
    ? value
    : `yda:${createHash('sha256').update(value).digest('hex')}`
}

async function submitOne(input: TransactionalEmailInput, recipient: string, multiple: boolean) {
  const apiKey = process.env.YODEV_MAIL_API_KEY
  if (!apiKey) throw new NonRetryableJobError('YODEV_MAIL_API_KEY absent')
  const apiUrl = (process.env.YODEV_MAIL_API_URL ?? 'https://api.mail.yodev.fr').replace(/\/$/, '')
  const generation = currentTransactionalEmailRetryGeneration()
  const logicalKey = generation > 0 ? `${input.idempotencyKey}:manual-retry:${generation}` : input.idempotencyKey
  const businessKey = recipientBusinessKey(logicalKey, recipient, multiple)
  const category = normalizedCategory(input.category)
  const body = {
    from: mailbox(input.from),
    to: { email: recipient },
    category,
    content: {
      subject: input.subject,
      html: input.html,
      text: input.text ?? plainTextFromHtml(input.html),
    },
    metadata: {
      referenceId: referenceId(input.referenceId ?? input.idempotencyKey),
      ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
    },
  }
  const claim = await claimTransactionalEmailDelivery({
    workspaceId: input.workspaceId,
    category,
    businessKey,
    recipientHash: recipientHash(recipient),
    contentHash: createHash('sha256').update(JSON.stringify(body)).digest('hex'),
  })
  if (!claim.claimed) {
    return { provider: 'yodev_mail' as const, providerMessageId: claim.delivery.providerMessageId, status: claim.delivery.status }
  }

  let response: Response
  try {
    response = await fetch(`${apiUrl}/v1/emails`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
        'idempotency-key': businessKey,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    })
  } catch (error) {
    await markTransactionalEmailFailure(claim.delivery.id, 'ambiguous', error)
    throw new YodevMailAmbiguousError()
  }

  const rawPayload = await response.json().catch(() => null)
  if (response.status !== 202) {
    const payload = z.object({ error: z.object({ code: z.string().optional() }).optional() }).passthrough().safeParse(rawPayload)
    const reason = payload.success ? payload.data.error?.code ?? `http_${response.status}` : `http_${response.status}`
    if (response.status >= 200 && response.status < 300) {
      await markTransactionalEmailFailure(claim.delivery.id, 'ambiguous', reason)
      throw new YodevMailAmbiguousError()
    }
    const retryable = response.status === 429 || response.status >= 500
    await markTransactionalEmailFailure(claim.delivery.id, retryable ? 'pending' : 'failed', reason)
    if (retryable) throw new Error(`YoDevMail transient failure: ${reason}`)
    throw new NonRetryableJobError(`YoDevMail rejected the transactional email: ${reason}`)
  }

  const parsed = acceptedResponseSchema.safeParse(rawPayload)
  if (!parsed.success || (parsed.data.data.status === 'simulated' && process.env.NODE_ENV === 'production')) {
    await markTransactionalEmailFailure(claim.delivery.id, 'ambiguous', 'invalid_acceptance')
    throw new YodevMailAmbiguousError()
  }
  await markTransactionalEmailAccepted(claim.delivery.id, parsed.data.data.id, parsed.data.data.status)
  return { provider: 'yodev_mail' as const, providerMessageId: parsed.data.data.id, status: parsed.data.data.status }
}

export async function sendTransactionalEmail(input: TransactionalEmailInput) {
  const recipients = normalizedRecipients(input.to)
  const deliveries = []
  for (const recipient of recipients) deliveries.push(await submitOne(input, recipient, recipients.length > 1))
  return {
    provider: 'yodev_mail' as const,
    providerMessageId: deliveries.length === 1 ? deliveries[0].providerMessageId : null,
    providerMessageIds: deliveries.map((delivery) => delivery.providerMessageId).filter((id): id is string => Boolean(id)),
  }
}
