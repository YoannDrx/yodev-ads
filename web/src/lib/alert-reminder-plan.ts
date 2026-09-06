type ReminderIncident = {
  status: string
  createdAt: Date
  lastNotifiedAt: Date | null
  snoozedUntil: Date | null
}

/** Durations use elapsed hours, including across DST changes. */
export function alertReminderDueAt(incident: ReminderIncident, intervalHours: number | null): Date | null {
  if (!intervalHours || intervalHours <= 0 || !['open', 'reopened', 'snoozed'].includes(incident.status)) return null
  if (incident.status === 'snoozed' && !incident.snoozedUntil) return null
  const baseline = incident.lastNotifiedAt ?? incident.createdAt
  const due = baseline.getTime() + intervalHours * 3_600_000
  return new Date(incident.status === 'snoozed' ? Math.max(due, incident.snoozedUntil!.getTime()) : due)
}

export function alertReminderEventKey(incidentId: string, dueAt: Date) {
  // No fingerprint in the key: the schema allows 180 characters and an incident
  // fingerprint alone can already occupy 128 of those characters.
  return `alert-reminder:${incidentId}:${dueAt.toISOString()}`
}

/** Recheck a queued transport, including remaining channels of an accepted occurrence. */
export function reminderDeliveryIsCurrent(input: {
  incident: ReminderIncident
  intervalHours: number | null
  expectedDueAt: string
  acceptedOccurrenceAt?: Date | null
}, now = new Date()) {
  const { incident, intervalHours } = input
  const due = alertReminderDueAt(incident, intervalHours)
  const expected = new Date(input.expectedDueAt).getTime()
  if (!due || !Number.isFinite(expected) || expected > now.getTime()) return false
  if (incident.status === 'snoozed' && (!incident.snoozedUntil || incident.snoozedUntil > now)) return false
  if (due.getTime() === expected) return true
  // Acceptance on the first channel advances the incident clock. Other channels
  // of the same occurrence remain eligible until the next reminder interval,
  // unless another notification has since advanced that clock again.
  return Boolean(input.acceptedOccurrenceAt && incident.lastNotifiedAt &&
    input.acceptedOccurrenceAt.getTime() === incident.lastNotifiedAt.getTime() &&
    now.getTime() < expected + intervalHours! * 3_600_000)
}
