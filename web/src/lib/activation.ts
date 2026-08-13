import 'server-only'

import { activationMilestones } from '@/db/schema'
import { withTenantTransaction, type DatabaseTransaction } from '@/db/transactions'

export const ACTIVATION_MILESTONES = [
  'google_connected',
  'accounts_synced',
  'first_analysis',
  'first_monitor',
  'first_report',
  'legal_accepted',
  'paid_conversion',
] as const

export type ActivationMilestone = (typeof ACTIVATION_MILESTONES)[number]

export function insertActivationMilestone(db: DatabaseTransaction, input: {
  workspaceId: string
  milestone: ActivationMilestone
  actorUserId: string
  sourceEntityId?: string | null
  metadata?: Record<string, unknown>
}) {
  return db.insert(activationMilestones).values({
    workspaceId: input.workspaceId,
    milestone: input.milestone,
    actorUserId: input.actorUserId,
    sourceEntityId: input.sourceEntityId ?? null,
    metadata: input.metadata ?? {},
  }).onConflictDoNothing({ target: [activationMilestones.workspaceId, activationMilestones.milestone] })
}

export function recordActivationMilestone(input: {
  workspaceId: string
  milestone: ActivationMilestone
  actorUserId: string
  sourceEntityId?: string | null
  metadata?: Record<string, unknown>
}) {
  return withTenantTransaction(
    { workspaceId: input.workspaceId, userId: input.actorUserId },
    (db) => insertActivationMilestone(db, input),
  )
}
