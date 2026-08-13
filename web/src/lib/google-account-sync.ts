import 'server-only'

import { and, eq } from 'drizzle-orm'
import { auditEvents, clients, googleAdsConnections } from '@/db/schema'
import { type DatabaseTransaction, withSystemTransaction, withTenantTransaction } from '@/db/transactions'
import { insertActivationMilestone } from '@/lib/activation'
import { accountsWithinLimit } from '@/lib/billing'
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
  advertiserLimit: number | null
  plan: string
  action: 'google_ads.accounts_synced' | 'google_ads.accounts_synced_after_plan_change'
  recordActivation: boolean
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
  const { included, excluded, limit } = accountsWithinLimit(input.managedCustomers, input.advertiserLimit)
  const includedIds = new Set(included.map((customer) => normalizeCustomerId(customer.customerId)))
  // The caller only invokes this after Google returned the complete inventory.
  // Keeping deactivation and upserts in one transaction prevents partial hiding.
  await db.update(clients)
    .set({ active: false, updatedAt: new Date() })
    .where(eq(clients.workspaceId, input.workspaceId))
  for (const customer of input.managedCustomers) {
    const customerId = normalizeCustomerId(customer.customerId)
    await db.insert(clients).values({
      workspaceId: input.workspaceId,
      googleCustomerId: customerId,
      name: customer.name,
      currencyCode: customer.currencyCode,
      timezone: customer.timezone,
      isManager: customer.isManager,
      active: includedIds.has(customerId),
    }).onConflictDoUpdate({
      target: [clients.workspaceId, clients.googleCustomerId],
      set: {
        name: customer.name,
        currencyCode: customer.currencyCode,
        timezone: customer.timezone,
        isManager: customer.isManager,
        active: includedIds.has(customerId),
        updatedAt: new Date(),
      },
    })
  }
  await db.insert(auditEvents).values({
    workspaceId: input.workspaceId,
    actorUserId: input.actorUserId,
    action: input.action,
    entityType: 'google_ads_connection',
    entityId: input.connectionId,
    metadata: {
      accessibleCount: input.managedCustomers.length,
      activeCount: included.length,
      excludedCount: excluded.length,
      advertiserLimit: limit,
      plan: input.plan,
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
  return { included, excluded, limit }
}
