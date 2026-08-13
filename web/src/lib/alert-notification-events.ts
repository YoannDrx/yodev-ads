export type AlertNotificationEvent = 'opened' | 'reopened' | 'severity_increased' | 'reminder'

type ExistingIncident = {
  status: string
  severity: string
  createdAt: Date
  lastNotifiedAt: Date | null
}

export function alertNotificationEvent(input: {
  existing: ExistingIncident | null | undefined
  nextSeverity: 'warning' | 'critical'
  reminderIntervalHours: number | null
  now: Date
}): AlertNotificationEvent | null {
  const { existing } = input
  if (!existing) return 'opened'
  if (existing.status === 'resolved') return 'reopened'
  if (existing.severity === 'warning' && input.nextSeverity === 'critical') return 'severity_increased'
  if (!input.reminderIntervalHours || !['open', 'reopened'].includes(existing.status)) return null
  const baseline = existing.lastNotifiedAt ?? existing.createdAt
  const reminderDueAt = baseline.getTime() + input.reminderIntervalHours * 60 * 60_000
  return input.now.getTime() >= reminderDueAt ? 'reminder' : null
}

export function alertNotificationEventKey(input: {
  fingerprint: string
  incidentId: string
  event: AlertNotificationEvent
  reminderIntervalHours: number | null
  now: Date
}) {
  if (input.event !== 'reminder') return `${input.fingerprint}:${input.event}:${input.incidentId}`
  if (!input.reminderIntervalHours) throw new Error('A reminder event requires an interval')
  const bucket = Math.floor(input.now.getTime() / (input.reminderIntervalHours * 60 * 60_000))
  return `${input.fingerprint}:reminder:${input.incidentId}:${bucket}`
}
