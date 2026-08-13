import 'server-only'

import { randomUUID } from 'node:crypto'
import { authEmail, type AuthEmailKind } from '@/lib/auth-email-model'
import { sendTransactionalEmail } from '@/lib/transactional-email'

export async function sendAuthEmail(input: {
  to: string
  kind: AuthEmailKind
  actionUrl: string
  locale?: string
  organizationName?: string
  idempotencyKey?: string
}) {
  const rendered = authEmail({
    kind: input.kind,
    locale: input.locale ?? 'fr',
    actionUrl: input.actionUrl,
    organizationName: input.organizationName,
  })
  const idempotencyKey = input.idempotencyKey ?? `auth:${input.kind}:${randomUUID()}`
  const from = process.env.AUTH_FROM_EMAIL ?? process.env.LIFECYCLE_FROM_EMAIL ?? 'Ads by Yodev <ads@yodev.fr>'
  const result = await sendTransactionalEmail({
    from,
    to: input.to.trim().toLowerCase(),
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    idempotencyKey,
    tag: input.kind,
  })
  return { providerMessageId: result.providerMessageId }
}
