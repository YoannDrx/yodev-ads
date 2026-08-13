export const OPERATIONS_ALERT_KINDS = ['job_dead_letter', 'stripe_webhook_failed', 'mutation_ambiguous'] as const
export type OperationsAlertKind = (typeof OPERATIONS_ALERT_KINDS)[number]

export function operationsAlertLabel(kind: OperationsAlertKind) {
  return kind === 'job_dead_letter'
    ? 'Job critique en dead-letter'
    : kind === 'stripe_webhook_failed'
      ? 'Webhook Stripe en échec'
      : 'Mutation Google Ads ambiguë'
}

export function operationsAlertJob(input: {
  kind: OperationsAlertKind
  sourceId: string
  title: string
  description: string
}) {
  return {
    workspaceId: null,
    type: 'operations.alert' as const,
    payload: input,
    priority: 1,
    deduplicationKey: `operations.alert:${input.kind}:${input.sourceId}`,
  }
}

export function operationsAlertJobForDeadLetter(input: { jobId: string; jobType: string; description: string }) {
  if (input.jobType === 'operations.alert') return null
  return operationsAlertJob({
    kind: 'job_dead_letter',
    sourceId: input.jobId,
    title: input.jobType,
    description: input.description,
  })
}

function escapeHtml(value: string) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;')
}

export function operationsAlertEmail(input: {
  kind: OperationsAlertKind
  sourceId: string
  title: string
  description: string
  operationsUrl: string
}) {
  const label = operationsAlertLabel(input.kind)
  return {
    subject: `[Ads by Yodev] ${label} · ${input.title}`,
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;color:#0d1722"><p style="color:#b42318;font-weight:700">Alerte d’exploitation</p><h1 style="font-size:24px">${escapeHtml(label)}</h1><p><strong>${escapeHtml(input.title)}</strong></p><p style="line-height:1.6">${escapeHtml(input.description)}</p><p style="color:#5e6971">Source : ${escapeHtml(input.sourceId)}</p><p style="margin-top:28px"><a href="${escapeHtml(input.operationsUrl)}" style="background:#0d1722;color:white;padding:12px 18px;border-radius:8px;text-decoration:none">Ouvrir Operations</a></p></div>`,
  }
}
