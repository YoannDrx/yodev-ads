import 'server-only'

import { NonRetryableJobError } from '@/lib/jobs'
import { operationsAlertEmail, type OperationsAlertKind } from '@/lib/operations-alert-model'
import { sendTransactionalEmail } from '@/lib/transactional-email'

export async function deliverOperationsAlert(input: {
  kind: OperationsAlertKind
  sourceId: string
  title: string
  description: string
}) {
  const recipient = process.env.OPERATIONS_ALERT_EMAIL?.trim().toLowerCase() || process.env.SUPPORT_EMAIL?.trim().toLowerCase()
  if (!recipient) throw new NonRetryableJobError('OPERATIONS_ALERT_EMAIL et SUPPORT_EMAIL absents.')
  const origin = process.env.NEXT_PUBLIC_APP_URL ?? 'https://ads.yodev.fr'
  const email = operationsAlertEmail({ ...input, operationsUrl: `${origin}/operations` })
  const idempotencyKey = `operations-alert:${input.kind}:${input.sourceId}`
  const result = await sendTransactionalEmail({
    from: process.env.SUPPORT_FROM_EMAIL ?? process.env.NOTIFICATION_FROM_EMAIL ?? 'Ads by Yodev <ads@yodev.fr>',
    to: recipient,
    subject: email.subject,
    html: email.html,
    idempotencyKey,
    category: `operations_${input.kind}`,
    referenceId: input.sourceId,
  })
  return { delivered: true, providerMessageId: result.providerMessageId }
}
