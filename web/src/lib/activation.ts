import 'server-only'

import { activationMilestones } from '@/db/schema'
import { withTenantTransaction, type DatabaseTransaction } from '@/db/transactions'

import { ACTIVATION_STAGES } from '@/lib/activation-stages'

export const ACTIVATION_MILESTONES = ACTIVATION_STAGES.map((stage) => stage.milestone)

export type ActivationMilestone = (typeof ACTIVATION_MILESTONES)[number]

export function insertActivationMilestone(db: DatabaseTransaction, input: {
  workspaceId: string
  milestone: ActivationMilestone
  actorUserId: string
  sourceEntityId?: string | null
  metadata?: Record<string, unknown>
  occurredAt?: Date
}) {
  return db.insert(activationMilestones).values({
    workspaceId: input.workspaceId,
    milestone: input.milestone,
    actorUserId: input.actorUserId,
    sourceEntityId: input.sourceEntityId ?? null,
    metadata: input.metadata ?? {},
    occurredAt: input.occurredAt,
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
