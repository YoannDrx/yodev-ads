import 'server-only'

import { NonRetryableJobError } from '@/lib/jobs'
import { operationsAlertLabel, type OperationsAlertKind } from '@/lib/operations-alert-model'

export class YodevMailAmbiguousError extends Error {
  constructor() {
    super('Résultat Mail by Yodev ambigu ; réessayer uniquement avec la même clé d’idempotence.')
    this.name = 'YodevMailAmbiguousError'
  }
}

export async function sendOperationsAlertWithYodevMail(input: {
  kind: OperationsAlertKind
  sourceId: string
  title: string
  description: string
  recipient: string
  operationsUrl: string
}) {
  const apiKey = process.env.YODEV_MAIL_API_KEY
  const templateId = process.env.YODEV_MAIL_OPERATIONS_TEMPLATE_ID
  if (!apiKey || !templateId) throw new NonRetryableJobError('Configuration Mail by Yodev incomplète.')
  const apiUrl = (process.env.YODEV_MAIL_API_URL ?? 'https://api.mail.yodev.fr').replace(/\/$/, '')
  const idempotencyKey = `operations-alert:${input.kind}:${input.sourceId}`
  let response: Response
  try {
    response = await fetch(`${apiUrl}/v1/emails`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
        'idempotency-key': idempotencyKey,
      },
      body: JSON.stringify({
        from: { email: 'ads@yodev.fr', name: 'Ads by Yodev' },
        to: { email: input.recipient },
        category: 'operations_alert',
        content: {
          templateId,
          variables: {
            label: operationsAlertLabel(input.kind),
            title: input.title,
            description: input.description,
            sourceId: input.sourceId,
            operationsUrl: input.operationsUrl,
          },
        },
        metadata: { referenceId: input.sourceId },
      }),
      signal: AbortSignal.timeout(15_000),
    })
  } catch {
    throw new YodevMailAmbiguousError()
  }

  const payload = await response.json().catch(() => null) as { data?: { id?: string; status?: string }; error?: { code?: string } } | null
  if (!response.ok) {
    const code = payload?.error?.code ?? `http_${response.status}`
    if (response.status === 429 || response.status >= 500) throw new Error(`Mail by Yodev transitoire: ${code}`)
    throw new NonRetryableJobError(`Mail by Yodev a rejeté la requête: ${code}`)
  }
  if (!payload?.data?.id || !['queued', 'simulated'].includes(payload.data.status ?? '')) throw new YodevMailAmbiguousError()
  console.info(JSON.stringify({
    level: 'info',
    message: 'operations_alert.accepted',
    provider: 'yodev_mail',
    kind: input.kind,
    sourceId: input.sourceId,
    yodevMessageId: payload.data.id,
    status: payload.data.status,
  }))
  return { delivered: true, providerMessageId: payload.data.id, status: payload.data.status }
}
