import 'server-only'

import { eq, sql } from 'drizzle-orm'
import { workspaces } from '@/db/schema'
import type { DatabaseTransaction } from '@/db/transactions'
import {
  entitlementContext,
  isPlan,
  isWorkspaceAccessState,
  requireCapability,
  type Capability,
} from '@/lib/entitlements'

export function lockWorkspaceAccessBoundary(db: DatabaseTransaction, workspaceId: string) {
  return db.execute(sql`select pg_advisory_xact_lock(hashtext(${`${workspaceId}:workspace-access`}))`)
}

export async function lockWorkspaceEntitlements(
  db: DatabaseTransaction,
  workspaceId: string,
  capability?: Capability,
) {
  await lockWorkspaceAccessBoundary(db, workspaceId)
  const workspace = await db.query.workspaces.findFirst({
    where: eq(workspaces.id, workspaceId),
    columns: { accessState: true, plan: true },
  })
  if (!workspace || !isWorkspaceAccessState(workspace.accessState) || !isPlan(workspace.plan)) {
    throw new Error('L’espace est indisponible.')
  }
  const entitlements = entitlementContext(workspace.accessState, workspace.plan)
  if (capability) requireCapability(entitlements, capability)
  return entitlements
}
