import 'server-only'

import { sql } from 'drizzle-orm'
import type { DatabaseTransaction } from '@/db/transactions'
import { entitlementContext, isPlan, isWorkspaceAccessState, type Capability } from '@/lib/entitlements'
import { authRoleToWorkspaceRole, type Permission } from '@/lib/permissions'
import { workspaceDecision } from '@/lib/workspace-decision'

/** Keeps lifecycle, ownership and membership stable until the tenant mutation commits. */
export async function lockWorkspaceActor(db: DatabaseTransaction, input: {
  workspaceId: string; actorUserId: string; permission: Permission; capability?: Capability
}) {
  // The function reveals only the current context's authorization, without granting access to global auth tables.
  const { rows: [current] } = await db.execute<{ state: string; plan: string; member_role: string; is_owner: boolean; trial_expired: boolean }>(
    sql`select * from public.lock_workspace_actor(${input.workspaceId}::uuid, ${input.actorUserId})`,
  )
  if (!current || !isWorkspaceAccessState(current.state) || !isPlan(current.plan)) throw new Error('Action non autorisée pour cet espace.')
  const state = current.trial_expired ? 'suspended' : current.state
  const entitlements = entitlementContext(state, current.plan)
  const role = authRoleToWorkspaceRole(current.member_role, current.is_owner)
  if (!workspaceDecision({ role, state, entitlements, permission: input.permission, capability: input.capability }).allowed) throw new Error('Action non autorisée pour cet espace.')
  return { role, entitlements }
}
