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
