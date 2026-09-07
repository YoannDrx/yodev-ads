import 'server-only'

import { createHash } from 'node:crypto'
import { and, desc, eq, inArray } from 'drizzle-orm'
import { auditEvents, clients, googleAdsConnections } from '@/db/schema'
import { type DatabaseTransaction, withSystemTransaction, withTenantTransaction } from '@/db/transactions'
import { insertActivationMilestone } from '@/lib/activation'
import { lockAccountManagement, reconcileManagedAccountSelection } from '@/lib/account-selection'
import { normalizeCustomerId } from '@/lib/ids'

export type ManagedGoogleCustomer = {
  customerId: string
  name: string
  currencyCode: string
  timezone: string
  isManager: boolean
}

type InventoryInput = {
  workspaceId: string
  actorUserId: string
  connectionId: string
  managedCustomers: ManagedGoogleCustomer[]
  observedAt: Date
  connectionIdentity: string
  action: 'google_ads.accounts_synced' | 'google_ads.accounts_synced_after_plan_change'
  recordActivation: boolean
}

export function googleInventoryConnectionIdentity(connection: Pick<typeof googleAdsConnections.$inferSelect, 'managerCustomerId' | 'encryptedRefreshToken' | 'scopes'>) {
  return createHash('sha256').update(JSON.stringify([connection.managerCustomerId, connection.encryptedRefreshToken, [...connection.scopes].sort()])).digest('hex')
}

export function persistTenantGoogleAccountInventory(input: InventoryInput) {
  return withTenantTransaction(
    { workspaceId: input.workspaceId, userId: input.actorUserId },
    (db) => persistGoogleAccountInventory(db, input),
  )
}

export function persistSystemGoogleAccountInventory(input: InventoryInput) {
  return withSystemTransaction((db) => persistGoogleAccountInventory(db, input))
}

async function persistGoogleAccountInventory(db: DatabaseTransaction, input: InventoryInput) {
  const { workspace, entitlements } = await lockAccountManagement(db, input.workspaceId)
  const connection = await db.query.googleAdsConnections.findFirst({ where: and(eq(googleAdsConnections.id, input.connectionId), eq(googleAdsConnections.workspaceId, input.workspaceId), eq(googleAdsConnections.status, 'active')) })
  if (!connection || googleInventoryConnectionIdentity(connection) !== input.connectionIdentity) throw new Error('Google connection changed during inventory collection')
  if (!Number.isFinite(input.observedAt.getTime()) || input.observedAt.getTime() > Date.now() + 60_000) throw new Error('Invalid inventory observation date')
  const latest = await db.query.auditEvents.findFirst({
    where: and(eq(auditEvents.workspaceId, input.workspaceId), eq(auditEvents.entityId, input.connectionId), inArray(auditEvents.action, ['google_ads.accounts_synced', 'google_ads.accounts_synced_after_plan_change'])),
    orderBy: [desc(auditEvents.createdAt), desc(auditEvents.id)], columns: { metadata: true },
  })
  const previousObservedAt = latest?.metadata.observedAt
  if (typeof previousObservedAt === 'string' && new Date(previousObservedAt) >= input.observedAt) {
    return { ...await reconcileManagedAccountSelection(db, input.workspaceId, entitlements.limits.advertiserAccounts), skipped: true }
  }
  const inventory = new Map<string, ManagedGoogleCustomer>()
  for (const customer of input.managedCustomers) {
    const customerId = normalizeCustomerId(customer.customerId)
    if (!/^\d{10}$/.test(customerId)) throw new Error('Invalid Google customer identifier')
    const normalized = { ...customer, customerId }
    const previous = inventory.get(customerId)
    if (previous && JSON.stringify(previous) !== JSON.stringify(normalized)) throw new Error('Conflicting Google inventory entries')
    inventory.set(customerId, normalized)
  }
  // Only complete inventories enter this transaction. User preferences survive a
  // missing account, a new MCC discovery and any later quota change.
  await db.update(clients).set({ googleAccessible: false, inventoryObservedAt: input.observedAt, updatedAt: new Date() }).where(eq(clients.workspaceId, input.workspaceId))
  for (const customer of inventory.values()) {
    await db.insert(clients).values({
      workspaceId: input.workspaceId, googleCustomerId: customer.customerId,
      name: customer.name, currencyCode: customer.currencyCode, timezone: customer.timezone,
      isManager: customer.isManager, googleAccessible: true, inventoryObservedAt: input.observedAt,
      managedSelected: false, active: false,
    }).onConflictDoUpdate({
      target: [clients.workspaceId, clients.googleCustomerId],
      set: { name: customer.name, currencyCode: customer.currencyCode, timezone: customer.timezone,
        isManager: customer.isManager, googleAccessible: true, inventoryObservedAt: input.observedAt, updatedAt: new Date() },
    })
  }
  const { included, excluded, limit } = await reconcileManagedAccountSelection(db, input.workspaceId, entitlements.limits.advertiserAccounts)
  await db.insert(auditEvents).values({
    workspaceId: input.workspaceId,
    actorUserId: input.actorUserId,
    action: input.action,
    entityType: 'google_ads_connection',
    entityId: input.connectionId,
    metadata: {
      accessibleCount: inventory.size,
      activeCount: included.length,
      excludedCount: excluded.length,
      advertiserLimit: limit,
      plan: workspace.plan,
      observedAt: input.observedAt.toISOString(),
    },
  })
  if (input.recordActivation) {
    await insertActivationMilestone(db, {
      workspaceId: input.workspaceId,
      milestone: 'accounts_synced',
      actorUserId: input.actorUserId,
      sourceEntityId: input.connectionId,
      metadata: { activeCount: included.length },
    })
  }
  await db.update(googleAdsConnections)
    .set({ lastSuccessfulUseAt: new Date(), updatedAt: new Date() })
    .where(and(
      eq(googleAdsConnections.id, input.connectionId),
      eq(googleAdsConnections.workspaceId, input.workspaceId),
    ))
  return { included, excluded, limit, skipped: false }
}
