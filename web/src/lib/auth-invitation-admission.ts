import 'server-only'

import { eq, sql } from 'drizzle-orm'
import { authMembers, workspaces } from '@/db/schema'
import { withSystemTransaction } from '@/db/transactions'
import { entitlementContext, isPlan, isWorkspaceAccessState } from '@/lib/entitlements'

// Called only after Better Auth authenticates and validates the recipient.
// This explains predictable refusals; migration 0055 remains authoritative for
// changes occurring between this read and the eventual membership insertion.
export async function invitationWorkspaceAdmission(organizationId: string): Promise<'available' | 'unavailable' | 'full'> {
  return withSystemTransaction(async (db) => {
    const workspace = await db.query.workspaces.findFirst({
      where: eq(workspaces.authOrganizationId, organizationId),
      columns: { accessState: true, plan: true, trialEndsAt: true },
    })
    if (!workspace || !isWorkspaceAccessState(workspace.accessState) || !isPlan(workspace.plan)
      || (workspace.accessState === 'trial' && workspace.trialEndsAt && workspace.trialEndsAt <= new Date())) return 'unavailable'
    const entitlements = entitlementContext(workspace.accessState, workspace.plan)
    if (!entitlements.capabilities.has('collaboration')) return 'unavailable'
    const limit = entitlements.limits.members
    if (limit === null) return 'available'
    const [row] = await db.select({ count: sql<number>`count(*)::int` }).from(authMembers)
      .where(eq(authMembers.organizationId, organizationId))
    return (row?.count ?? 0) >= limit ? 'full' : 'available'
  })
}
