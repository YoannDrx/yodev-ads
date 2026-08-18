import 'server-only'

import { createHash } from 'node:crypto'
import { z } from 'zod'
import { authEmail, type AuthEmailKind } from '@/lib/auth-email-model'
import { decryptSecret, encryptSecret } from '@/lib/crypto'
import { enqueueJob, NonRetryableJobError } from '@/lib/jobs'
import { sendTransactionalEmail } from '@/lib/transactional-email'

const authEmailDeliverySchema = z.object({
  to: z.string().email().max(320),
  kind: z.enum(['email_verification', 'magic_link', 'password_reset', 'organization_invitation']),
  actionUrl: z.string().url().max(8_000),
  locale: z.string().max(10),
  organizationName: z.string().max(200).optional(),
  idempotencyKey: z.string().min(1).max(128),
}).strict()

export type AuthEmailInput = {
  to: string
  kind: AuthEmailKind
  actionUrl: string
  locale?: string
  organizationName?: string
  idempotencyKey?: string
}

function normalizedAuthEmail(input: AuthEmailInput) {
  const recipient = input.to.trim().toLowerCase()
  const requestFingerprint = createHash('sha256')
    .update(`${recipient}\n${input.actionUrl}`)
    .digest('hex')
  return authEmailDeliverySchema.parse({
    to: recipient,
    kind: input.kind,
    actionUrl: input.actionUrl,
    locale: input.locale ?? 'fr',
    organizationName: input.organizationName,
    idempotencyKey: input.idempotencyKey ?? `auth:${input.kind}:${requestFingerprint}`,
  })
}

async function deliverNormalizedAuthEmail(input: z.infer<typeof authEmailDeliverySchema>) {
  const rendered = authEmail({
    kind: input.kind,
    locale: input.locale,
    actionUrl: input.actionUrl,
    organizationName: input.organizationName,
  })
  const from = process.env.AUTH_FROM_EMAIL ?? process.env.LIFECYCLE_FROM_EMAIL ?? 'Ads by Yodev <ads@yodev.fr>'
  const result = await sendTransactionalEmail({
    from,
    to: input.to,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    idempotencyKey: input.idempotencyKey,
    category: `auth_${input.kind}`,
    referenceId: input.idempotencyKey,
  })
  return { providerMessageId: result.providerMessageId }
}

export async function deliverQueuedAuthEmail(payload: { envelope: string }) {
  try {
    const decrypted = decryptSecret(payload.envelope)
    return await deliverNormalizedAuthEmail(authEmailDeliverySchema.parse(JSON.parse(decrypted)))
  } catch (error) {
    if (error instanceof NonRetryableJobError) throw error
    if (error instanceof SyntaxError || error instanceof z.ZodError) {
      throw new NonRetryableJobError('Le payload chiffré de l’email d’authentification est invalide.')
    }
    throw error
  }
}

export async function sendAuthEmail(input: AuthEmailInput) {
  const normalized = normalizedAuthEmail(input)
  const queueKey = createHash('sha256').update(normalized.idempotencyKey).digest('hex')
  await enqueueJob({
    type: 'auth.email_deliver',
    deduplicationKey: `auth-email:${queueKey}`,
    payload: { envelope: encryptSecret(JSON.stringify(normalized)) },
    priority: 20,
    maximumAttempts: 5,
  })

  try {
    return await deliverNormalizedAuthEmail(normalized)
  } catch {
    // The encrypted durable job remains authoritative. Authentication endpoints
    // must not expose provider failures or account existence to callers.
    return { providerMessageId: null, queued: true as const }
  }
}
