import 'server-only'

import { and, eq, gt, inArray, isNull, sql } from 'drizzle-orm'
import {
  apiKeys,
  auditEvents,
  deletionRequests,
  exportJobs,
  googleAdsConnections,
  jobs,
  memberNotificationPreferences,
  notificationChannels,
  notificationOAuthSessions,
  reportSchedules,
  shareLinks,
  workspaces,
} from '@/db/schema'
import { withSystemTransaction, withTenantTransaction } from '@/db/transactions'
import { encryptSecret } from '@/lib/crypto'
import type { WorkspaceAccessState } from '@/lib/entitlements'
import { lockWorkspaceAccessBoundary } from '@/lib/workspace-transaction-guard'

type ActorContext = { workspaceId: string; actorUserId: string }

export function createWorkspaceExportRequest(input: ActorContext) {
  return withTenantTransaction({ workspaceId: input.workspaceId, userId: input.actorUserId }, async (db) => {
    await db.execute(sql`select pg_advisory_xact_lock(hashtext(${`${input.workspaceId}:export`}))`)
    const existing = await db.query.exportJobs.findFirst({
      where: and(eq(exportJobs.workspaceId, input.workspaceId), sql`${exportJobs.status} in ('queued', 'processing')`),
      columns: { id: true },
    })
    if (existing) throw new Error('Un export est déjà en cours pour cet espace.')
    const [created] = await db.insert(exportJobs).values({
      workspaceId: input.workspaceId,
      requestedBy: input.actorUserId,
    }).returning({ id: exportJobs.id })
    if (!created) throw new Error('La création de l’export a échoué.')
    await db.insert(auditEvents).values({
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      action: 'workspace.export_requested',
      entityType: 'export_job',
      entityId: created.id,
      metadata: { retentionDays: 7 },
    })
    return created
  })
}

export function markWorkspaceDeletionPending(input: ActorContext & {
  previousAccessState: WorkspaceAccessState
  googleRevocationConfirmed: boolean
  stripeCancellationQueued: boolean
  googleRevocationState?: 'not_required' | 'pending' | 'confirmed'
  stripeCancellationState?: 'not_required' | 'pending' | 'confirmed'
  stripeSubscriptionId?: string | null
  now?: Date
}) {
  const now = input.now ?? new Date()
  const purgeAt = new Date(now.getTime() + 30 * 24 * 60 * 60_000)
  const googleRevocationState = input.googleRevocationState
    ?? (input.googleRevocationConfirmed ? 'confirmed' : 'pending')
  const stripeCancellationState = input.stripeCancellationState
    ?? (input.stripeCancellationQueued ? 'pending' : 'not_required')
  return withTenantTransaction({ workspaceId: input.workspaceId, userId: input.actorUserId }, async (transaction) => {
    await lockWorkspaceAccessBoundary(transaction, input.workspaceId)
    await transaction.execute(sql`select pg_advisory_xact_lock(hashtext(${`${input.workspaceId}:deletion`}))`)
    const [claimed] = await transaction.update(workspaces).set({
      accessState: 'deletion_pending',
      mutationsEnabled: false,
      deletionRequestedAt: now,
      purgeAt,
      updatedAt: now,
    }).where(and(
      eq(workspaces.id, input.workspaceId),
      eq(workspaces.accessState, input.previousAccessState),
    )).returning({ id: workspaces.id })
    if (!claimed) throw new Error('L’état de l’espace a changé. Rechargez la page avant de demander sa suppression.')
    await transaction.update(apiKeys).set({ revokedAt: now, updatedAt: now }).where(and(
      eq(apiKeys.workspaceId, input.workspaceId), isNull(apiKeys.revokedAt),
    ))
    await transaction.update(shareLinks).set({ active: false, expiresAt: now, updatedAt: now }).where(eq(shareLinks.workspaceId, input.workspaceId))
    await transaction.update(notificationChannels).set({
      enabled: false,
      encryptedDestination: encryptSecret('revoked'),
      destinationHint: 'revoked',
      updatedAt: now,
    }).where(eq(notificationChannels.workspaceId, input.workspaceId))
    await transaction.update(reportSchedules).set({ enabled: false, updatedAt: now }).where(eq(reportSchedules.workspaceId, input.workspaceId))
    await transaction.update(memberNotificationPreferences).set({
      mentionNotifications: false, digestCadence: 'none', updatedAt: now,
    }).where(eq(memberNotificationPreferences.workspaceId, input.workspaceId))
    await transaction.update(jobs).set({
      status: 'cancelled', leaseOwner: null, leaseExpiresAt: null, updatedAt: now,
    }).where(and(eq(jobs.workspaceId, input.workspaceId), inArray(jobs.status, ['queued', 'retrying', 'running'])))
    if (googleRevocationState !== 'pending') {
      await transaction.delete(googleAdsConnections).where(eq(googleAdsConnections.workspaceId, input.workspaceId))
    }
    await transaction.insert(deletionRequests).values({
      workspaceId: input.workspaceId,
      requestedBy: input.actorUserId,
      previousAccessState: input.previousAccessState,
      status: 'pending',
      requestedAt: now,
      purgeAt,
      stripeSubscriptionId: input.stripeSubscriptionId ?? null,
      stripeCancellationState,
      stripeCancellationConfirmedAt: stripeCancellationState === 'confirmed' ? now : null,
      stripeCancellationError: null,
      googleRevocationState,
      googleRevocationConfirmedAt: googleRevocationState === 'confirmed' ? now : null,
      googleRevocationError: null,
    }).onConflictDoUpdate({
      target: deletionRequests.workspaceId,
      set: {
        requestedBy: input.actorUserId,
        previousAccessState: input.previousAccessState,
        status: 'pending',
        requestedAt: now,
        purgeAt,
        cancelledAt: null,
        completedAt: null,
        stripeSubscriptionId: input.stripeSubscriptionId ?? null,
        stripeCancellationState,
        stripeCancellationConfirmedAt: stripeCancellationState === 'confirmed' ? now : null,
        stripeCancellationError: null,
        googleRevocationState,
        googleRevocationConfirmedAt: googleRevocationState === 'confirmed' ? now : null,
        googleRevocationError: null,
      },
    })
    await transaction.insert(auditEvents).values({
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      action: 'workspace.deletion_requested',
      entityType: 'workspace',
      entityId: input.workspaceId,
      metadata: {
        purgeAt: purgeAt.toISOString(),
        googleRevocationConfirmed: input.googleRevocationConfirmed,
        googleRevocationState,
        stripeCancellationQueued: input.stripeCancellationQueued,
        stripeCancellationState,
        stripeSubscriptionId: input.stripeSubscriptionId ?? null,
      },
    })
    return { purgeAt, requestedAt: now }
  }).then(async (result) => {
    await withSystemTransaction((db) => db.delete(notificationOAuthSessions).where(
      eq(notificationOAuthSessions.workspaceId, input.workspaceId),
    ))
    return result
  })
}

export function claimWorkspaceDeletionCancellation(input: ActorContext & { now?: Date }) {
  const now = input.now ?? new Date()
  return withTenantTransaction({ workspaceId: input.workspaceId, userId: input.actorUserId }, async (db) => {
    const [claimed] = await db.update(deletionRequests).set({ status: 'cancelling' }).where(and(
      eq(deletionRequests.workspaceId, input.workspaceId),
      eq(deletionRequests.status, 'pending'),
      gt(deletionRequests.purgeAt, now),
    )).returning()
    if (claimed) return claimed
    const retry = await db.query.deletionRequests.findFirst({
      where: and(
        eq(deletionRequests.workspaceId, input.workspaceId),
        eq(deletionRequests.status, 'cancelling'),
        gt(deletionRequests.purgeAt, now),
      ),
    })
    if (!retry) throw new Error('La demande de suppression ne peut plus être annulée.')
    return retry
  })
}

export function finalizeWorkspaceDeletionCancellation(input: ActorContext & {
  requestId: string
  previousAccessState: WorkspaceAccessState
  now?: Date
}) {
  const now = input.now ?? new Date()
  return withTenantTransaction({ workspaceId: input.workspaceId, userId: input.actorUserId }, async (transaction) => {
    const [restored] = await transaction.update(workspaces).set({
      accessState: input.previousAccessState,
      deletionRequestedAt: null,
      purgeAt: null,
      updatedAt: now,
    }).where(and(
      eq(workspaces.id, input.workspaceId),
      eq(workspaces.accessState, 'deletion_pending'),
    )).returning({ id: workspaces.id })
    if (!restored) throw new Error('L’espace ne peut plus être restauré.')
    const [cancelled] = await transaction.update(deletionRequests).set({
      status: 'cancelled', cancelledAt: now,
    }).where(and(
      eq(deletionRequests.id, input.requestId),
      eq(deletionRequests.workspaceId, input.workspaceId),
      eq(deletionRequests.status, 'cancelling'),
    )).returning({ id: deletionRequests.id })
    if (!cancelled) throw new Error('La demande de suppression n’est plus en cours d’annulation.')
    await transaction.insert(auditEvents).values({
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      action: 'workspace.deletion_cancelled',
      entityType: 'workspace',
      entityId: input.workspaceId,
      metadata: { googleReconnectRequired: true, apiKeysRemainRevoked: true },
    })
    return cancelled
  })
}
