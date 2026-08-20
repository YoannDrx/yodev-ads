import 'server-only'

import { createHmac } from 'node:crypto'
import type Stripe from 'stripe'
import { and, eq, inArray, lte } from 'drizzle-orm'
import { del } from '@vercel/blob'
import {
  authOrganizations,
  deletionRequests,
  googleAdsConnections,
  jobs,
  workspaceDeletionTombstones,
  workspaceDomains,
  workspaces,
} from '@/db/schema'
import { withPurgeTransaction, withSystemTransaction } from '@/db/transactions'
import { getStripe } from '@/lib/billing'
import { isControlledBrandLogoUrl } from '@/lib/branding-assets'
import { decryptSecret } from '@/lib/crypto'
import { revokeGoogleOAuthToken } from '@/lib/google-ads'
import { removeVercelProjectDomain } from '@/lib/vercel-domains'

export function expectedWorkspaceDeletionConfirmation(locale: string) {
  return locale === 'en' ? 'DELETE' : 'SUPPRIMER'
}

export function workspaceDeletionConfirmationMatches(locale: string, value: unknown) {
  return value === expectedWorkspaceDeletionConfirmation(locale)
}

function tombstoneHash(workspaceId: string) {
  const key = process.env.DELETION_TOMBSTONE_KEY ?? process.env.APP_ENCRYPTION_KEY
  if (!key) throw new Error('DELETION_TOMBSTONE_KEY is not configured')
  return createHmac('sha256', key).update(workspaceId).digest('hex')
}

function safeCleanupError(error: unknown) {
  return (error instanceof Error ? error.message : String(error)).slice(0, 2000)
}

async function ignoreMissing(operation: Promise<unknown>) {
  try {
    await operation
  } catch (error) {
    if (!(error instanceof Error) || !/not found|404|does not exist/i.test(error.message)) throw error
  }
}

type StripeForDeletion = Pick<Stripe, 'subscriptions'>

export async function recordWorkspaceDeletionStripeCancellation(input: {
  workspaceId: string
  subscriptionId: string
  state: 'confirmed' | 'failed'
  error?: unknown
  now?: Date
}) {
  const now = input.now ?? new Date()
  return withSystemTransaction((db) => db.update(deletionRequests).set({
    stripeCancellationState: input.state,
    stripeCancellationConfirmedAt: input.state === 'confirmed' ? now : null,
    stripeCancellationError: input.state === 'failed' ? safeCleanupError(input.error) : null,
  }).where(and(
    eq(deletionRequests.workspaceId, input.workspaceId),
    eq(deletionRequests.status, 'pending'),
    eq(deletionRequests.stripeSubscriptionId, input.subscriptionId),
  )))
}

export async function revokeWorkspaceGoogleConnection(workspaceId: string, now = new Date()) {
  const context = await withSystemTransaction(async (db) => {
    const request = await db.query.deletionRequests.findFirst({
      where: and(eq(deletionRequests.workspaceId, workspaceId), eq(deletionRequests.status, 'pending')),
    })
    const connection = await db.query.googleAdsConnections.findFirst({
      where: eq(googleAdsConnections.workspaceId, workspaceId),
    })
    return { request, connection }
  })
  if (!context.request) return { skipped: 'deletion_not_pending' as const }
  if (!context.connection) {
    await withSystemTransaction((db) => db.update(deletionRequests).set({
      googleRevocationState: 'confirmed',
      googleRevocationConfirmedAt: now,
      googleRevocationError: null,
    }).where(and(eq(deletionRequests.id, context.request!.id), eq(deletionRequests.status, 'pending'))))
    return { revoked: true, connectionMissing: true }
  }
  try {
    const response = await revokeGoogleOAuthToken(decryptSecret(context.connection.encryptedRefreshToken))
    if (!response.ok && response.status !== 400) throw new Error(`Google OAuth revocation failed with HTTP ${response.status}`)
    await withSystemTransaction(async (db) => {
      const [confirmed] = await db.update(deletionRequests).set({
        googleRevocationState: 'confirmed',
        googleRevocationConfirmedAt: now,
        googleRevocationError: null,
      }).where(and(eq(deletionRequests.id, context.request!.id), eq(deletionRequests.status, 'pending'))).returning({ id: deletionRequests.id })
      if (confirmed) {
        await db.delete(googleAdsConnections).where(and(
          eq(googleAdsConnections.id, context.connection!.id),
          eq(googleAdsConnections.workspaceId, workspaceId),
        ))
      }
    })
    return { revoked: true, connectionMissing: false }
  } catch (error) {
    await withSystemTransaction((db) => db.update(deletionRequests).set({
      googleRevocationState: 'failed',
      googleRevocationError: safeCleanupError(error),
    }).where(and(eq(deletionRequests.id, context.request!.id), eq(deletionRequests.status, 'pending'))))
    throw error
  }
}

async function deletionPreflight(workspaceId: string, now: Date, stripe?: StripeForDeletion) {
  const request = await withPurgeTransaction((db) => db.query.deletionRequests.findFirst({
    where: and(
      eq(deletionRequests.workspaceId, workspaceId),
      eq(deletionRequests.status, 'pending'),
      lte(deletionRequests.purgeAt, now),
    ),
  }))
  if (!request) return null
  if (request.googleRevocationState === 'pending' || request.googleRevocationState === 'failed') {
    throw new Error('Google OAuth revocation must be reconciled before workspace purge')
  }
  if (!request.stripeSubscriptionId) {
    if (!['not_required', 'confirmed'].includes(request.stripeCancellationState)) {
      throw new Error('Stripe cancellation must be reconciled before workspace purge')
    }
    return request
  }

  const subscription = await (stripe ?? getStripe()).subscriptions.retrieve(request.stripeSubscriptionId)
  if (subscription.status !== 'canceled' && !subscription.cancel_at_period_end) {
    throw new Error('Stripe subscription is still renewable; workspace purge is blocked')
  }
  await withPurgeTransaction((db) => db.update(deletionRequests).set({
    stripeCancellationState: 'confirmed',
    stripeCancellationConfirmedAt: now,
    stripeCancellationError: null,
  }).where(and(
    eq(deletionRequests.id, request.id),
    eq(deletionRequests.workspaceId, workspaceId),
    eq(deletionRequests.status, 'pending'),
  )))
  return { ...request, stripeCancellationState: 'confirmed' }
}

export async function purgeWorkspace(workspaceId: string, now = new Date(), stripe?: StripeForDeletion) {
  const preflight = await deletionPreflight(workspaceId, now, stripe)
  if (!preflight) return 'not_due' as const
  const workspaceHash = tombstoneHash(workspaceId)

  return withPurgeTransaction(async (db) => {
    const [request] = await db.update(deletionRequests).set({ status: 'purging' }).where(and(
      eq(deletionRequests.workspaceId, workspaceId),
      eq(deletionRequests.status, 'pending'),
      lte(deletionRequests.purgeAt, now),
      inArray(deletionRequests.stripeCancellationState, ['not_required', 'confirmed']),
      inArray(deletionRequests.googleRevocationState, ['not_required', 'confirmed']),
    )).returning()
    if (!request) return 'not_due' as const
    const workspace = await db.query.workspaces.findFirst({
      where: and(eq(workspaces.id, workspaceId), eq(workspaces.accessState, 'deletion_pending')),
    })
    if (!workspace) throw new Error('Deletion workspace state changed during purge claim')
    const domains = await db.query.workspaceDomains.findMany({
      where: eq(workspaceDomains.workspaceId, workspaceId),
      columns: { hostname: true },
    })
    const logoUrl = workspace.logoUrl && isControlledBrandLogoUrl(workspace.logoUrl) ? workspace.logoUrl : null
    const hostnames = domains.map((domain) => domain.hostname)
    const externalCleanupRequired = Boolean(logoUrl || hostnames.length > 0)

    if (workspace.authOrganizationId) {
      await db.delete(authOrganizations).where(eq(authOrganizations.id, workspace.authOrganizationId))
    }
    await db.insert(workspaceDeletionTombstones).values({
      workspaceHash,
      deletionRequestedAt: request.requestedAt,
      retainUntil: new Date(now.getTime() + 10 * 365 * 24 * 60 * 60_000),
      externalCleanupStatus: externalCleanupRequired ? 'pending' : 'completed',
      externalCleanupCompletedAt: externalCleanupRequired ? null : now,
    }).onConflictDoNothing()
    if (externalCleanupRequired) {
      await db.insert(jobs).values({
        workspaceId: null,
        type: 'workspace.external_cleanup',
        payload: { workspaceHash, logoUrl, hostnames },
        priority: 5,
        deduplicationKey: `workspace.external_cleanup:${workspaceHash}`,
      }).onConflictDoNothing({ target: jobs.deduplicationKey })
    }
    await db.delete(workspaces).where(eq(workspaces.id, workspaceId))
    return 'purged' as const
  })
}

export async function runWorkspaceExternalCleanup(input: {
  workspaceHash: string
  logoUrl: string | null
  hostnames: string[]
}) {
  await withSystemTransaction((db) => db.update(workspaceDeletionTombstones).set({
    externalCleanupStatus: 'running',
    externalCleanupError: null,
  }).where(eq(workspaceDeletionTombstones.workspaceHash, input.workspaceHash)))
  try {
    if (input.logoUrl) await ignoreMissing(del(input.logoUrl))
    for (const hostname of input.hostnames) await ignoreMissing(removeVercelProjectDomain(hostname))
  } catch (error) {
    await withSystemTransaction((db) => db.update(workspaceDeletionTombstones).set({
      externalCleanupStatus: 'failed',
      externalCleanupError: safeCleanupError(error),
    }).where(eq(workspaceDeletionTombstones.workspaceHash, input.workspaceHash)))
    throw error
  }
  const completedAt = new Date()
  await withSystemTransaction((db) => db.update(workspaceDeletionTombstones).set({
    externalCleanupStatus: 'completed',
    externalCleanupError: null,
    externalCleanupCompletedAt: completedAt,
  }).where(eq(workspaceDeletionTombstones.workspaceHash, input.workspaceHash)))
  return { completedAt, deletedLogo: Boolean(input.logoUrl), removedDomains: input.hostnames.length }
}
