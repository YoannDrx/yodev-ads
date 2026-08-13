import 'server-only'

import { and, desc, eq } from 'drizzle-orm'
import { z } from 'zod'
import {
  approvalRequests,
  approvalVotes,
  auditEvents,
  clients,
  googleAdsConnections,
  mutationExecutions,
} from '@/db/schema'
import { withSystemTransaction } from '@/db/transactions'
import { stateHash } from '@/lib/approval-state'
import { atomicBudgetState } from '@/lib/budget-reallocation'
import { atomicChangeBatchState } from '@/lib/atomic-change-batch'
import { currentAtomicBatchSource, storedAtomicBatchSourceSchema } from '@/lib/atomic-change-batch-server'
import { GoogleAdsGateway } from '@/lib/google-ads'
import { currentKeywordCreationContext, keywordCreationPayloadSchema } from '@/lib/keyword-creation'
import { scheduleMutationObservationWithDatabase } from '@/lib/mutation-observations'

type ReconciliationResult = 'confirmed' | 'not_applied' | 'already_reconciled'

export async function reconcileGoogleMutation(approvalId: string): Promise<ReconciliationResult> {
  const context = await withSystemTransaction(async (db) => {
    const [approval] = await db
      .select()
      .from(approvalRequests)
      .where(and(eq(approvalRequests.id, approvalId), eq(approvalRequests.status, 'ambiguous')))
      .limit(1)
    if (!approval) return null
    const [client] = await db.select().from(clients).where(and(eq(clients.id, approval.clientId), eq(clients.workspaceId, approval.workspaceId))).limit(1)
    const [connection] = await db.select().from(googleAdsConnections).where(eq(googleAdsConnections.workspaceId, approval.workspaceId)).limit(1)
    const [execution] = await db
      .select()
      .from(mutationExecutions)
      .where(and(eq(mutationExecutions.approvalId, approval.id), eq(mutationExecutions.state, 'ambiguous')))
      .orderBy(desc(mutationExecutions.attempt))
      .limit(1)
    if (!client || !connection || !execution) throw new Error('Ambiguous mutation context is incomplete')
    return { approval, client, connection, execution }
  })
  if (!context) return 'already_reconciled'

  const campaignId = String(context.approval.payload.campaignId ?? '')
  if (!campaignId) throw new Error('Ambiguous mutation has no campaign ID')
  const gateway = new GoogleAdsGateway(context.connection)
  let currentState: Record<string, unknown>
  if (context.approval.kind === 'campaign_status' || context.approval.kind === 'campaign_budget') {
    const current = await gateway.campaignMutationState(context.client.googleCustomerId, campaignId)
    currentState = context.approval.kind === 'campaign_status'
      ? { resourceName: current.campaignResourceName, status: current.status }
      : {
          resourceName: current.budgetResourceName,
          amountMicros: current.budgetMicros,
          explicitlyShared: current.budgetExplicitlyShared,
          referenceCount: current.budgetReferenceCount,
        }
  } else if (context.approval.kind === 'budget_reallocation') {
    const changes = Array.isArray(context.approval.payload.changes)
      ? context.approval.payload.changes as Array<Record<string, unknown>>
      : []
    if (changes.length < 2 || changes.length > 50) throw new Error('Ambiguous budget batch has invalid size')
    const states = await Promise.all(changes.map((change) => {
      const itemCampaignId = String(change.campaignId ?? '')
      if (!itemCampaignId) throw new Error('Ambiguous budget batch has incomplete context')
      return gateway.campaignMutationState(context.client.googleCustomerId, itemCampaignId)
    }))
    currentState = atomicBudgetState(states)
  } else if (context.approval.kind === 'atomic_change_batch') {
    const payload = z.object({ sources: z.array(storedAtomicBatchSourceSchema).min(2).max(20) }).parse(context.approval.payload)
    const sources = await Promise.all(payload.sources.map((source) => currentAtomicBatchSource(
      gateway,
      context.client.googleCustomerId,
      source,
    )))
    currentState = atomicChangeBatchState(sources, 'expectedState')
  } else if (context.approval.kind === 'keyword_create_negative' || context.approval.kind === 'keyword_create_positive') {
    const payload = keywordCreationPayloadSchema.parse(context.approval.payload)
    currentState = (await currentKeywordCreationContext(gateway, context.client.googleCustomerId, payload)).approvalState
  } else if (context.approval.kind === 'keyword_status') {
    const adGroupId = String(context.approval.payload.adGroupId ?? '')
    const criterionId = String(context.approval.payload.criterionId ?? '')
    if (!adGroupId || !criterionId) throw new Error('Ambiguous keyword update has incomplete context')
    currentState = await gateway.keywordCriterionState(context.client.googleCustomerId, adGroupId, criterionId)
  } else if (context.approval.kind === 'ad_status') {
    const adGroupId = String(context.approval.payload.adGroupId ?? '')
    const adId = String(context.approval.payload.adId ?? '')
    if (!adGroupId || !adId) throw new Error('Ambiguous ad update has incomplete context')
    currentState = await gateway.adGroupAdMutationState(context.client.googleCustomerId, adGroupId, adId)
  } else if (context.approval.kind === 'rsa_create_draft') {
    const adGroupId = String(context.approval.payload.adGroupId ?? '')
    const headlines = Array.isArray(context.approval.payload.headlines) ? context.approval.payload.headlines.map(String) : []
    const descriptions = Array.isArray(context.approval.payload.descriptions) ? context.approval.payload.descriptions.map(String) : []
    const finalUrl = String(context.approval.payload.finalUrl ?? '')
    if (!adGroupId || !headlines.length || !descriptions.length || !finalUrl) throw new Error('Ambiguous RSA creation has incomplete context')
    currentState = await gateway.rsaDraftState(context.client.googleCustomerId, adGroupId, {
      headlines,
      descriptions,
      finalUrls: [finalUrl],
    })
  } else {
    throw new Error(`Unsupported ambiguous mutation kind: ${context.approval.kind}`)
  }
  const currentHash = stateHash(currentState)
  const proposedHash = context.approval.proposedState ? stateHash(context.approval.proposedState) : null
  const expectedHash = context.approval.expectedStateHash

  if (proposedHash && currentHash === proposedHash) {
    await withSystemTransaction(async (db) => {
      const now = new Date()
      const [updated] = await db
        .update(approvalRequests)
        .set({
          status: 'executed',
          executionState: 'confirmed',
          reconciliationState: 'confirmed',
          executedAt: now,
          errorMessage: null,
          updatedAt: now,
        })
        .where(and(eq(approvalRequests.id, context.approval.id), eq(approvalRequests.status, 'ambiguous')))
        .returning({ id: approvalRequests.id })
      if (!updated) return
      await db
        .update(mutationExecutions)
        .set({ state: 'confirmed', result: { reconciledState: currentState }, confirmedAt: now, updatedAt: now })
        .where(eq(mutationExecutions.id, context.execution.id))
      await db.insert(auditEvents).values({
        workspaceId: context.approval.workspaceId,
        actorUserId: 'system:mutation-reconciler',
        action: 'approval.reconciliation_confirmed',
        entityType: 'approval_request',
        entityId: context.approval.id,
        metadata: { executionId: context.execution.id },
      })
      await scheduleMutationObservationWithDatabase(db, {
        approval: context.approval,
        client: context.client,
        executedAt: context.execution.submittedAt ?? now,
      })
    })
    return 'confirmed'
  }

  if (expectedHash && currentHash === expectedHash) {
    await withSystemTransaction(async (db) => {
      const now = new Date()
      const [updated] = await db
        .update(approvalRequests)
        .set({
          status: 'pending',
          executionState: 'pending',
          reconciliationState: 'not_applied',
          approvedBy: null,
          errorMessage: null,
          updatedAt: now,
        })
        .where(and(eq(approvalRequests.id, context.approval.id), eq(approvalRequests.status, 'ambiguous')))
        .returning({ id: approvalRequests.id })
      if (!updated) return
      await db.delete(approvalVotes).where(eq(approvalVotes.approvalId, context.approval.id))
      await db
        .update(mutationExecutions)
        .set({ state: 'failed', result: { reconciledState: currentState, provenNotApplied: true }, updatedAt: now })
        .where(eq(mutationExecutions.id, context.execution.id))
      await db.insert(auditEvents).values({
        workspaceId: context.approval.workspaceId,
        actorUserId: 'system:mutation-reconciler',
        action: 'approval.reconciliation_not_applied',
        entityType: 'approval_request',
        entityId: context.approval.id,
        metadata: { executionId: context.execution.id, requiresFreshApproval: true },
      })
    })
    return 'not_applied'
  }

  throw new Error('Google Ads state matches neither the expected nor proposed mutation state')
}
