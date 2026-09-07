import 'server-only'

import { and, eq } from 'drizzle-orm'
import { alertIncidents, auditEvents } from '@/db/schema'
import { withTenantTransaction } from '@/db/transactions'
import { lockWorkspaceActor } from '@/lib/workspace-actor-guard'
import { alertQualityReviewSchema, AlertQualityConflict } from '@/lib/alert-quality-model'

export function reviewAlertQuality(input: {
  workspaceId: string; actorUserId: string; incidentId: string; label: string; expectedOccurrence: number; expectedVersion: number
}) {
  const review = alertQualityReviewSchema.parse(input)
  return withTenantTransaction({ workspaceId: input.workspaceId, userId: input.actorUserId }, async (db) => {
    await lockWorkspaceActor(db, { ...input, permission: 'alerts:manage' })
    const [current] = await db.select({ label: alertIncidents.qualityLabel, version: alertIncidents.qualityVersion, reviewedOccurrence: alertIncidents.qualityOccurrence, occurrence: alertIncidents.occurrenceCount })
      .from(alertIncidents).where(and(eq(alertIncidents.workspaceId, input.workspaceId), eq(alertIncidents.id, review.incidentId))).limit(1).for('update')
    if (!current || current.version !== review.expectedVersion || current.occurrence !== review.expectedOccurrence) throw new AlertQualityConflict()
    const label = review.label === 'unreviewed' ? null : review.label
    if (current.label === label && (label === null || current.reviewedOccurrence === current.occurrence)) return { changed: false }
    const version = current.version + 1
    await db.update(alertIncidents).set({ qualityLabel: label, qualityVersion: version,
      qualityOccurrence: label ? current.occurrence : null, qualityReviewedAt: label ? new Date() : null,
      qualityReviewedBy: label ? input.actorUserId : null,
    }).where(and(eq(alertIncidents.workspaceId, input.workspaceId), eq(alertIncidents.id, review.incidentId)))
    await db.insert(auditEvents).values({ workspaceId: input.workspaceId, actorUserId: input.actorUserId,
      action: 'monitoring.alert_quality_reviewed', entityType: 'alert_incident', entityId: review.incidentId,
      metadata: { before: current.label, after: label, observedOccurrence: current.occurrence, previousReviewedOccurrence: current.reviewedOccurrence, version },
    })
    return { changed: true }
  })
}
