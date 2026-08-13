import 'server-only'

import { and, count, eq, inArray } from 'drizzle-orm'
import {
  approvalComments,
  approvalRequests,
  approvalVotes,
  auditEvents,
  clients,
  googleAdsConnections,
  mutationExecutions,
} from '@/db/schema'
import { withTenantTransaction } from '@/db/transactions'
import { stateHash } from '@/lib/approval-state'
import { scheduleMutationObservationWithDatabase } from '@/lib/mutation-observations'

export type GoogleApprovalRecord = typeof approvalRequests.$inferSelect
export type GoogleApprovalClient = typeof clients.$inferSelect

type ApprovalActorContext = { workspaceId: string; actorUserId: string }
type ApprovalDraft = Pick<typeof approvalRequests.$inferInsert,
  | 'clientId'
  | 'kind'
  | 'title'
  | 'payload'
  | 'resourceName'
  | 'expectedState'
  | 'proposedState'
  | 'impactPreview'
  | 'observationWindowDays'
  | 'requiredApprovals'
  | 'validationRequestId'
>

export function createGoogleApprovalRequest(input: ApprovalActorContext & ApprovalDraft & { now?: Date }) {
  const now = input.now ?? new Date()
  return withTenantTransaction({ workspaceId: input.workspaceId, userId: input.actorUserId }, async (db) => {
    const [approval] = await db.insert(approvalRequests).values({
      workspaceId: input.workspaceId,
      clientId: input.clientId,
      requestedBy: input.actorUserId,
      kind: input.kind,
      title: input.title,
      payload: input.payload,
      resourceName: input.resourceName,
      expectedState: input.expectedState,
      proposedState: input.proposedState,
      impactPreview: input.impactPreview,
      observationWindowDays: input.observationWindowDays,
      expectedStateHash: stateHash(input.expectedState ?? {}),
      requiredApprovals: input.requiredApprovals,
      validationRequestId: input.validationRequestId,
      expiresAt: new Date(now.getTime() + 24 * 60 * 60_000),
    }).returning()
    if (!approval) throw new Error('La création de la demande d’approbation a échoué.')
    await db.insert(auditEvents).values({
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      action: 'approval.requested',
      entityType: 'approval_request',
      entityId: approval.id,
      metadata: { kind: input.kind, clientId: input.clientId, validationRequestId: input.validationRequestId },
    })
    return approval
  })
}

export function loadAtomicGoogleApprovalSources(input: ApprovalActorContext & { approvalIds: string[]; now?: Date }) {
  const now = input.now ?? new Date()
  return withTenantTransaction({ workspaceId: input.workspaceId, userId: input.actorUserId }, async (db) => {
    const requests = await db.select().from(approvalRequests).where(and(
      eq(approvalRequests.workspaceId, input.workspaceId),
      eq(approvalRequests.status, 'pending'),
      inArray(approvalRequests.id, input.approvalIds),
    ))
    const votes = await db.select({ id: approvalVotes.id }).from(approvalVotes).where(and(
      eq(approvalVotes.workspaceId, input.workspaceId),
      inArray(approvalVotes.approvalId, input.approvalIds),
    )).limit(1)
    if (requests.length !== input.approvalIds.length) throw new Error('Une proposition sélectionnée est introuvable ou n’est plus en attente.')
    if (votes.length > 0) throw new Error('Une proposition ayant déjà reçu un vote ne peut pas être regroupée.')
    if (new Set(requests.map((request) => request.clientId)).size !== 1) throw new Error('Toutes les propositions du batch doivent concerner le même client.')
    if (requests.some((request) => request.expiresAt <= now)) throw new Error('Une proposition sélectionnée a expiré.')
    return requests.sort((left, right) => left.id.localeCompare(right.id))
  })
}

export function createAtomicGoogleApprovalBatch(input: ApprovalActorContext & ApprovalDraft & {
  sourceApprovalIds: string[]
  operationCount: number
  now?: Date
}) {
  const now = input.now ?? new Date()
  return withTenantTransaction({ workspaceId: input.workspaceId, userId: input.actorUserId }, async (db) => {
    const [approval] = await db.insert(approvalRequests).values({
      workspaceId: input.workspaceId,
      clientId: input.clientId,
      requestedBy: input.actorUserId,
      kind: input.kind,
      title: input.title,
      payload: input.payload,
      resourceName: input.resourceName,
      expectedState: input.expectedState,
      proposedState: input.proposedState,
      expectedStateHash: stateHash(input.expectedState ?? {}),
      impactPreview: input.impactPreview,
      observationWindowDays: input.observationWindowDays,
      requiredApprovals: input.requiredApprovals,
      validationRequestId: input.validationRequestId,
      expiresAt: new Date(now.getTime() + 24 * 60 * 60_000),
    }).returning()
    if (!approval) throw new Error('La création du batch d’approbation a échoué.')
    const batched = await db.update(approvalRequests).set({
      status: 'batched',
      executionState: 'batched',
      errorMessage: `Regroupée dans le batch ${approval.id}`,
      updatedAt: now,
    }).where(and(
      eq(approvalRequests.workspaceId, input.workspaceId),
      eq(approvalRequests.status, 'pending'),
      inArray(approvalRequests.id, input.sourceApprovalIds),
    )).returning({ id: approvalRequests.id })
    if (batched.length !== input.sourceApprovalIds.length) throw new Error('Une proposition a changé pendant la création du batch.')
    await db.insert(auditEvents).values({
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      action: 'approval.atomic_batch_requested',
      entityType: 'approval_request',
      entityId: approval.id,
      metadata: {
        sourceApprovalIds: input.sourceApprovalIds,
        operationCount: input.operationCount,
        validationRequestId: input.validationRequestId,
      },
    })
    return approval
  })
}

export function voteAndClaimGoogleApproval(input: ApprovalActorContext & {
  approvalId: string
  allowSelfApproval: boolean
  assertKindAllowed: (kind: string) => void
  now?: Date
}) {
  const now = input.now ?? new Date()
  return withTenantTransaction({ workspaceId: input.workspaceId, userId: input.actorUserId }, async (db) => {
    const [pending] = await db.select().from(approvalRequests).where(and(
      eq(approvalRequests.id, input.approvalId),
      eq(approvalRequests.workspaceId, input.workspaceId),
      eq(approvalRequests.status, 'pending'),
    )).limit(1).for('update')
    if (!pending) throw new Error('Cette demande a déjà été traitée.')
    input.assertKindAllowed(pending.kind)
    if (pending.expiresAt < now) {
      await db.update(approvalRequests).set({ status: 'expired', executionState: 'failed', updatedAt: now })
        .where(eq(approvalRequests.id, pending.id))
      return { outcome: 'expired' as const }
    }
    if (!input.allowSelfApproval && pending.requestedBy === input.actorUserId) {
      throw new Error('L’auto-approbation est désactivée pour cet espace.')
    }
    const [vote] = await db.insert(approvalVotes).values({
      workspaceId: input.workspaceId,
      approvalId: pending.id,
      approverUserId: input.actorUserId,
      decision: 'approved',
    }).onConflictDoNothing().returning({ id: approvalVotes.id })
    if (!vote) throw new Error('Vous avez déjà voté sur cette demande.')
    const [votes] = await db.select({ count: count() }).from(approvalVotes).where(and(
      eq(approvalVotes.approvalId, pending.id),
      eq(approvalVotes.decision, 'approved'),
    ))
    if (votes.count < pending.requiredApprovals) {
      await db.insert(auditEvents).values({
        workspaceId: input.workspaceId,
        actorUserId: input.actorUserId,
        action: 'approval.vote_recorded',
        entityType: 'approval_request',
        entityId: pending.id,
        metadata: { approvals: votes.count, requiredApprovals: pending.requiredApprovals },
      })
      return { outcome: 'waiting' as const, message: `Approbation enregistrée (${votes.count}/${pending.requiredApprovals}).` }
    }
    const [claimed] = await db.update(approvalRequests).set({
      status: 'executing',
      executionState: 'claimed',
      approvedBy: input.actorUserId,
      updatedAt: now,
    }).where(and(
      eq(approvalRequests.id, input.approvalId),
      eq(approvalRequests.workspaceId, input.workspaceId),
      eq(approvalRequests.status, 'pending'),
    )).returning()
    if (!claimed) throw new Error('Cette demande a déjà été traitée.')
    return { outcome: 'claimed' as const, claimed }
  })
}

export function markGoogleApprovalDrifted(input: ApprovalActorContext & { approvalId: string; now?: Date }) {
  const now = input.now ?? new Date()
  return withTenantTransaction({ workspaceId: input.workspaceId, userId: input.actorUserId }, async (db) => {
    const [drifted] = await db.update(approvalRequests)
      .set({ status: 'drifted', executionState: 'failed', errorMessage: 'Google Ads state drift', updatedAt: now })
      .where(and(
        eq(approvalRequests.id, input.approvalId),
        eq(approvalRequests.workspaceId, input.workspaceId),
        eq(approvalRequests.status, 'executing'),
      ))
      .returning({ id: approvalRequests.id })
    if (!drifted) throw new Error('La demande ne peut plus être marquée comme ayant dérivé.')
    return drifted
  })
}

export function createGoogleMutationExecution(input: ApprovalActorContext & { approvalId: string }) {
  return withTenantTransaction({ workspaceId: input.workspaceId, userId: input.actorUserId }, async (db) => {
    const [executionCount] = await db.select({ count: count() }).from(mutationExecutions).where(and(
      eq(mutationExecutions.workspaceId, input.workspaceId),
      eq(mutationExecutions.approvalId, input.approvalId),
    ))
    const [execution] = await db.insert(mutationExecutions).values({
      workspaceId: input.workspaceId,
      approvalId: input.approvalId,
      attempt: executionCount.count + 1,
      state: 'claimed',
    }).returning({ id: mutationExecutions.id })
    if (!execution) throw new Error('La création de la tentative de mutation a échoué.')
    return execution
  })
}

export function markGoogleMutationSubmitted(input: ApprovalActorContext & {
  executionId: string
  validationRequestId: string | null
  now?: Date
}) {
  const now = input.now ?? new Date()
  return withTenantTransaction({ workspaceId: input.workspaceId, userId: input.actorUserId }, async (db) => {
    const [validated] = await db.update(mutationExecutions).set({
      state: 'validated', validationRequestId: input.validationRequestId, updatedAt: now,
    }).where(and(
      eq(mutationExecutions.id, input.executionId),
      eq(mutationExecutions.workspaceId, input.workspaceId),
      eq(mutationExecutions.state, 'claimed'),
    )).returning({ id: mutationExecutions.id })
    if (!validated) throw new Error('La tentative de mutation ne peut plus être validée.')
    const [submitted] = await db.update(mutationExecutions).set({
      state: 'submitted', submittedAt: now, updatedAt: now,
    }).where(and(
      eq(mutationExecutions.id, input.executionId),
      eq(mutationExecutions.workspaceId, input.workspaceId),
      eq(mutationExecutions.state, 'validated'),
    )).returning({ id: mutationExecutions.id })
    if (!submitted) throw new Error('La tentative de mutation ne peut plus être soumise.')
  })
}

export function completeGoogleMutationExecution(input: ApprovalActorContext & {
  approval: GoogleApprovalRecord
  client: GoogleApprovalClient
  executionId: string
  confirmed: boolean
  reconciledState: Record<string, unknown>
  executionRequestId: string | null
  executionValidationRequestId: string | null
  now?: Date
}) {
  const now = input.now ?? new Date()
  return withTenantTransaction({ workspaceId: input.workspaceId, userId: input.actorUserId }, async (db) => {
    const [approval] = await db.update(approvalRequests).set({
      status: input.confirmed ? 'executed' : 'ambiguous',
      executionState: input.confirmed ? 'confirmed' : 'ambiguous',
      reconciliationState: input.confirmed ? 'confirmed' : 'pending',
      executionRequestId: input.executionRequestId,
      executedAt: input.confirmed ? now : null,
      updatedAt: now,
    }).where(and(
      eq(approvalRequests.id, input.approval.id),
      eq(approvalRequests.workspaceId, input.workspaceId),
      eq(approvalRequests.status, 'executing'),
    )).returning({ id: approvalRequests.id })
    if (!approval) throw new Error('La demande d’approbation ne peut plus être finalisée.')
    const [execution] = await db.update(mutationExecutions).set({
      state: input.confirmed ? 'confirmed' : 'ambiguous',
      googleRequestId: input.executionRequestId,
      result: { reconciledState: input.reconciledState },
      confirmedAt: input.confirmed ? now : null,
      updatedAt: now,
    }).where(and(
      eq(mutationExecutions.id, input.executionId),
      eq(mutationExecutions.workspaceId, input.workspaceId),
      eq(mutationExecutions.state, 'submitted'),
    )).returning({ id: mutationExecutions.id })
    if (!execution) throw new Error('La tentative de mutation ne peut plus être finalisée.')
    await db.insert(auditEvents).values({
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      action: input.confirmed ? 'approval.executed' : 'approval.execution_ambiguous',
      entityType: 'approval_request',
      entityId: input.approval.id,
      metadata: {
        kind: input.approval.kind,
        executionValidationRequestId: input.executionValidationRequestId,
        executionRequestId: input.executionRequestId,
      },
    })
    if (input.confirmed) await scheduleMutationObservationWithDatabase(db, {
      approval: input.approval,
      client: input.client,
      executedAt: now,
    })
  })
}

export function failGoogleMutationExecution(input: ApprovalActorContext & {
  approvalId?: string
  executionId?: string
  ambiguous: boolean
  errorMessage: string
  now?: Date
}) {
  const now = input.now ?? new Date()
  return withTenantTransaction({ workspaceId: input.workspaceId, userId: input.actorUserId }, async (db) => {
    if (input.executionId) await db.update(mutationExecutions).set({
      state: input.ambiguous ? 'ambiguous' : 'failed',
      errorMessage: input.errorMessage.slice(0, 2000),
      updatedAt: now,
    }).where(and(eq(mutationExecutions.id, input.executionId), eq(mutationExecutions.workspaceId, input.workspaceId)))
    if (input.approvalId) await db.update(approvalRequests).set({
      status: input.ambiguous ? 'ambiguous' : 'failed',
      executionState: input.ambiguous ? 'ambiguous' : 'failed',
      reconciliationState: input.ambiguous ? 'pending' : 'not_required',
      errorMessage: input.errorMessage.slice(0, 2000),
      updatedAt: now,
    }).where(and(
      eq(approvalRequests.id, input.approvalId),
      eq(approvalRequests.workspaceId, input.workspaceId),
      eq(approvalRequests.status, 'executing'),
    ))
  })
}

export function rejectGoogleApproval(input: ApprovalActorContext & { approvalId: string; now?: Date }) {
  const now = input.now ?? new Date()
  return withTenantTransaction({ workspaceId: input.workspaceId, userId: input.actorUserId }, async (db) => {
    const [rejected] = await db.update(approvalRequests).set({
      status: 'rejected', approvedBy: input.actorUserId, updatedAt: now,
    }).where(and(
      eq(approvalRequests.id, input.approvalId),
      eq(approvalRequests.workspaceId, input.workspaceId),
      eq(approvalRequests.status, 'pending'),
    )).returning()
    if (!rejected) throw new Error('Cette demande a déjà été traitée.')
    await db.insert(auditEvents).values({
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      action: 'approval.rejected',
      entityType: 'approval_request',
      entityId: rejected.id,
      metadata: {},
    })
    return rejected
  })
}

export function addGoogleApprovalComment(input: ApprovalActorContext & { approvalId: string; body: string }) {
  return withTenantTransaction({ workspaceId: input.workspaceId, userId: input.actorUserId }, async (db) => {
    const approval = await db.query.approvalRequests.findFirst({
      where: and(eq(approvalRequests.id, input.approvalId), eq(approvalRequests.workspaceId, input.workspaceId)),
      columns: { id: true },
    })
    if (!approval) throw new Error('Demande d’approbation introuvable.')
    await db.insert(approvalComments).values({
      workspaceId: input.workspaceId,
      approvalId: input.approvalId,
      authorUserId: input.actorUserId,
      body: input.body,
    })
    await db.insert(auditEvents).values({
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      action: 'approval.comment_added',
      entityType: 'approval_request',
      entityId: input.approvalId,
      metadata: {},
    })
  })
}

export function deleteWorkspaceGoogleConnection(input: ApprovalActorContext & {
  connectionId: string
  managerCustomerId: string
}) {
  return withTenantTransaction({ workspaceId: input.workspaceId, userId: input.actorUserId }, async (db) => {
    await db.delete(googleAdsConnections).where(and(
      eq(googleAdsConnections.id, input.connectionId),
      eq(googleAdsConnections.workspaceId, input.workspaceId),
    ))
    await db.insert(auditEvents).values({
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      action: 'google_ads.disconnected',
      entityType: 'google_ads_connection',
      entityId: input.connectionId,
      metadata: { managerCustomerId: input.managerCustomerId },
    })
  })
}
