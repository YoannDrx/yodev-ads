import 'server-only'

import { and, eq } from 'drizzle-orm'
import { approvalRequests, clients, googleAdsConnections, mutationExecutions } from '@/db/schema'
import type { DatabaseTransaction } from '@/db/transactions'
import { lockAccountManagement } from '@/lib/account-selection'
import { requireCapability } from '@/lib/entitlements'

/** Final admission before the submitted marker; shares selection/billing locks. */
export async function admitGoogleMutation(db: DatabaseTransaction, workspaceId: string, executionId: string) {
  const { entitlements } = await lockAccountManagement(db, workspaceId)
  const [context] = await db.select({ kind: approvalRequests.kind }).from(mutationExecutions)
    .innerJoin(approvalRequests, and(eq(approvalRequests.id, mutationExecutions.approvalId), eq(approvalRequests.workspaceId, mutationExecutions.workspaceId)))
    .innerJoin(clients, and(eq(clients.id, approvalRequests.clientId), eq(clients.workspaceId, approvalRequests.workspaceId)))
    .innerJoin(googleAdsConnections, eq(googleAdsConnections.workspaceId, clients.workspaceId))
    .where(and(eq(mutationExecutions.id, executionId), eq(mutationExecutions.workspaceId, workspaceId), eq(mutationExecutions.state, 'claimed'),
      eq(approvalRequests.status, 'executing'), eq(clients.active, true), eq(clients.isManager, false), eq(googleAdsConnections.status, 'active'))).limit(1)
  if (!context) throw new Error('Le compte ou la tentative de mutation n’est plus disponible.')
  requireCapability(entitlements, ['campaign_status', 'campaign_budget'].includes(context.kind) ? 'google.mutate.basic' : 'google.mutate.advanced')
  if (['budget_reallocation', 'atomic_change_batch'].includes(context.kind) && !['agency', 'internal'].includes(entitlements.plan)) throw new Error('Le forfait ne permet plus ce changement groupé.')
}
