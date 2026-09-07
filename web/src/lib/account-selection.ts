import 'server-only'

import { createHash } from 'node:crypto'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { auditEvents, clients, workspaces } from '@/db/schema'
import { type DatabaseTransaction, withTenantTransaction } from '@/db/transactions'
import { entitlementContext, isPlan, isWorkspaceAccessState, requireCapability } from '@/lib/entitlements'
import { withWorkspaceActorTransaction } from '@/lib/workspace-actor-guard'
import { lockWorkspaceAccessBoundary } from '@/lib/workspace-transaction-guard'
import { selectedAccountsWithinLimit, type AccountSelection } from '@/lib/account-selection-model'
import { insertActivationMilestone } from '@/lib/activation'

export async function lockAccountManagement(db: DatabaseTransaction, workspaceId: string) {
  await lockWorkspaceAccessBoundary(db, workspaceId)
  // Billing updates hold this row too. Read the current quota only after the lock.
  const [workspace] = await db.select({ plan: workspaces.plan, accessState: workspaces.accessState }).from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1).for('update')
  if (!workspace || !isPlan(workspace.plan) || !isWorkspaceAccessState(workspace.accessState)) throw new Error('Account management unavailable')
  const entitlements = entitlementContext(workspace.accessState, workspace.plan)
  requireCapability(entitlements, 'google.read')
  return { workspace, entitlements }
}

export function accountSelectionVersion(accounts: AccountSelection[], plan: string) {
  return createHash('sha256').update(JSON.stringify({ plan, accounts: [...accounts].sort((a, b) => a.id.localeCompare(b.id)).map((account) => [account.id, account.isManager, account.managedSelected, account.managementPriority, account.googleAccessible, account.active]) })).digest('hex')
}

export function getWorkspaceAccountSelection(workspaceId: string) {
  return withTenantTransaction({ workspaceId, userId: 'repository:account-selection' }, async (db) => {
    const workspace = await db.query.workspaces.findFirst({ where: eq(workspaces.id, workspaceId), columns: { plan: true, accessState: true } })
    if (!workspace || !isPlan(workspace.plan) || !isWorkspaceAccessState(workspace.accessState)) throw new Error('Account selection unavailable')
    const accounts = await db.query.clients.findMany({ where: eq(clients.workspaceId, workspaceId), columns: {
      id: true, googleCustomerId: true, name: true, currencyCode: true, timezone: true, isManager: true,
      googleAccessible: true, managedSelected: true, managementPriority: true, active: true, inventoryObservedAt: true,
    } })
    return { accounts: accounts.map((account) => ({ ...account, inventoryObservedAt: account.inventoryObservedAt?.toISOString() ?? null })),
      version: accountSelectionVersion(accounts, workspace.plan), limit: entitlementContext(workspace.accessState, workspace.plan).limits.advertiserAccounts }
  })
}

/** Caller must serialize through the workspace row before applying a quota. */
export async function reconcileManagedAccountSelection(db: DatabaseTransaction, workspaceId: string, limit: number | null) {
  const accounts = await db.query.clients.findMany({ where: eq(clients.workspaceId, workspaceId) })
  const selection = selectedAccountsWithinLimit(accounts, limit)
  const activeIds = new Set(selection.included.map((account) => account.id))
  const activate = accounts.filter((account) => !account.active && activeIds.has(account.id)).map((account) => account.id)
  const deactivate = accounts.filter((account) => account.active && !activeIds.has(account.id)).map((account) => account.id)
  if (deactivate.length) await db.update(clients).set({ active: false, updatedAt: new Date() }).where(and(eq(clients.workspaceId, workspaceId), inArray(clients.id, deactivate)))
  if (activate.length) await db.update(clients).set({ active: true, updatedAt: new Date() }).where(and(eq(clients.workspaceId, workspaceId), inArray(clients.id, activate)))
  return { ...selection, changed: activate.length + deactivate.length, activatedIds: activate, deactivatedIds: deactivate }
}

export function saveManagedAccountSelection(input: { workspaceId: string; actorUserId: string; clientIds: string[]; version: string; priorityOnly?: boolean }) {
  return withWorkspaceActorTransaction({ ...input, permission: 'google:connect', capability: 'google.read' }, async (db) => {
    const { workspace, entitlements } = await lockAccountManagement(db, input.workspaceId)
    const accounts = await db.query.clients.findMany({ where: eq(clients.workspaceId, input.workspaceId) })
    if (accountSelectionVersion(accounts, workspace.plan) !== input.version) throw new Error('Account selection changed. Reload before saving.')
    if (new Set(input.clientIds).size !== input.clientIds.length) throw new Error('Invalid account selection')
    const byId = new Map(accounts.map((account) => [account.id, account]))
    for (const id of input.clientIds) {
      const account = byId.get(id)
      if (!account || account.isManager || (!account.googleAccessible && !account.managedSelected)) throw new Error('Invalid account selection')
    }
    const limit = entitlements.limits.advertiserAccounts
    const previousIds = accounts.filter((account) => account.managedSelected && !account.isManager).map((account) => account.id)
    if (input.priorityOnly) {
      if (input.clientIds.length !== previousIds.length || previousIds.some((id) => !input.clientIds.includes(id))) throw new Error('Priority changes must preserve the selected accounts')
    } else if (limit !== null && input.clientIds.length > limit) throw new Error(`Account selection exceeds the plan limit (${limit})`)
    // A saved selection is explicit, including deselected and inaccessible accounts.
    await db.update(clients).set({ managedSelected: false, updatedAt: new Date() }).where(eq(clients.workspaceId, input.workspaceId))
    if (input.clientIds.length) await db.execute(sql`
      update clients set managed_selected = true, management_priority = selection.ordinality - 1, updated_at = now()
      from jsonb_array_elements_text(${JSON.stringify(input.clientIds)}::jsonb) with ordinality as selection(id, ordinality)
      where clients.workspace_id = ${input.workspaceId} and clients.id = selection.id::uuid
    `)
    const result = await reconcileManagedAccountSelection(db, input.workspaceId, limit)
    if (result.includedAdvertisers.length > 0) await insertActivationMilestone(db, { workspaceId: input.workspaceId, actorUserId: input.actorUserId, milestone: 'accounts_selected', sourceEntityId: result.includedAdvertisers[0].id, metadata: { activeAdvertisers: result.includedAdvertisers.length } })
    await db.insert(auditEvents).values({ workspaceId: input.workspaceId, actorUserId: input.actorUserId, action: input.priorityOnly ? 'google_ads.account_priorities_saved' : 'google_ads.account_selection_saved', entityType: 'workspace', entityId: input.workspaceId,
      metadata: { clientIds: input.clientIds, limit, activeAdvertisers: result.includedAdvertisers.length, activatedIds: result.activatedIds, deactivatedIds: result.deactivatedIds } })
    return result
  })
}
