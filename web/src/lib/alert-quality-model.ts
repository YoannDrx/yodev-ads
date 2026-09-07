import { z } from 'zod'

export const ALERT_QUALITY_LABELS = ['useful', 'noise', 'false_positive'] as const
export type AlertQualityLabel = (typeof ALERT_QUALITY_LABELS)[number]

export const alertQualityReviewSchema = z.object({
  incidentId: z.string().uuid(),
  label: z.enum([...ALERT_QUALITY_LABELS, 'unreviewed']),
  expectedOccurrence: z.coerce.number().int().positive().max(2_147_483_647),
  expectedVersion: z.coerce.number().int().nonnegative().max(2_147_483_646),
})

export function alertQualityLabel(label: string | null, english = false) {
  if (!ALERT_QUALITY_LABELS.includes(label as AlertQualityLabel)) return english ? 'Not reviewed' : 'Non évaluée'
  return ({ useful: english ? 'Useful' : 'Utile', noise: english ? 'Noise' : 'Bruit', false_positive: english ? 'False positive' : 'Faux positif' })[label as AlertQualityLabel] ?? (english ? 'Not reviewed' : 'Non évaluée')
}

export function alertQualityState(incident: { qualityLabel: string | null; qualityOccurrence: number | null; occurrenceCount: number }) {
  if (!ALERT_QUALITY_LABELS.includes(incident.qualityLabel as AlertQualityLabel)) return 'unreviewed'
  return incident.qualityOccurrence === incident.occurrenceCount ? 'current' : 'stale'
}

export class AlertQualityConflict extends Error {
  constructor() { super('Alert quality observation or review changed'); this.name = 'AlertQualityConflict' }
}
