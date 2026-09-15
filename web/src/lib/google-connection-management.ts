import 'server-only'

import { createHash } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import { auditEvents, clients, googleAdsConnections } from '@/db/schema'
import type { DatabaseTransaction } from '@/db/transactions'
import { withWorkspaceActorTransaction } from '@/lib/workspace-actor-guard'
import { insertActivationMilestone } from '@/lib/activation'

type ConnectionIdentity = Pick<typeof googleAdsConnections.$inferSelect, 'id' | 'status' | 'managerCustomerId' | 'encryptedRefreshToken' | 'scopes'>

/** Ignore usage timestamps; changing credentials, MCC, scopes, status or identity invalidates a pending authorization. */
export function googleConnectionVersion(connection: ConnectionIdentity | null | undefined) {
  return connection ? createHash('sha256').update(JSON.stringify([connection.id, connection.status, connection.managerCustomerId, connection.encryptedRefreshToken, [...connection.scopes].sort()])).digest('hex') : 'none'
}

async function assertOAuthWindow(db: DatabaseTransaction, expiresAt: Date) {
  if (!Number.isFinite(expiresAt.getTime())) throw new Error('La session OAuth a expiré. Relancez la connexion.')
  const { rows: [clock] } = await db.execute<{ valid: boolean }>(sql`select ${expiresAt.toISOString()}::timestamptz > clock_timestamp() as valid`)
  if (!clock?.valid) throw new Error('La session OAuth a expiré. Relancez la connexion.')
}

export function saveWorkspaceGoogleConnection(input: {
  workspaceId: string
  userId: string
  managerCustomerId: string
  googleEmail: string | null
  encryptedRefreshToken: string
  scopes: string[]
  expectedConnectionVersion: string
  authorizationExpiresAt: Date
}) {
  return withWorkspaceActorTransaction({ workspaceId: input.workspaceId, actorUserId: input.userId, permission: 'google:connect', capability: 'google.read' }, async (db) => {
    await assertOAuthWindow(db, input.authorizationExpiresAt)
    const [current] = await db.select().from(googleAdsConnections).where(eq(googleAdsConnections.workspaceId, input.workspaceId)).limit(1).for('update')
    if (googleConnectionVersion(current) !== input.expectedConnectionVersion) throw new Error('La connexion Google a changé. Relancez la connexion.')
    const insertion = db
      .insert(googleAdsConnections)
      .values({
        workspaceId: input.workspaceId,
        managerCustomerId: input.managerCustomerId,
        googleEmail: input.googleEmail,
        encryptedRefreshToken: input.encryptedRefreshToken,
        scopes: input.scopes,
        connectedBy: input.userId,
      })
    const [connection] = await (current ? insertion.onConflictDoUpdate({
        target: googleAdsConnections.workspaceId,
        set: {
          managerCustomerId: input.managerCustomerId,
          googleEmail: input.googleEmail,
          encryptedRefreshToken: input.encryptedRefreshToken,
          scopes: input.scopes,
          connectedBy: input.userId,
          status: 'active',
          lastSuccessfulUseAt: null,
          updatedAt: new Date(),
        },
      }) : insertion.onConflictDoNothing({ target: googleAdsConnections.workspaceId })).returning()
    if (!connection) throw new Error('La connexion Google a changé. Relancez la connexion.')
    // New credentials must establish a fresh inventory before any client resumes.
    // Keep the agency's selection and all historical rows for reactivation.
    await db.update(clients).set({ active: false, googleAccessible: false, inventoryObservedAt: null, updatedAt: new Date() }).where(eq(clients.workspaceId, input.workspaceId))
    await db.insert(auditEvents).values({
      workspaceId: input.workspaceId,
      actorUserId: input.userId,
      action: 'google_ads.connected',
      entityType: 'google_ads_connection',
      entityId: connection.id,
      metadata: { managerCustomerId: input.managerCustomerId, googleEmail: input.googleEmail },
    })
    await insertActivationMilestone(db, {
      workspaceId: input.workspaceId,
      milestone: 'google_connected',
      actorUserId: input.userId,
      sourceEntityId: connection.id,
    })
    await assertOAuthWindow(db, input.authorizationExpiresAt)
    return connection
  })
}
