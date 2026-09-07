import 'server-only'

import { createHmac } from 'node:crypto'
import type Stripe from 'stripe'
import { and, eq, inArray, isNull, lte, sql } from 'drizzle-orm'
import { z } from 'zod'
import { del, BlobNotFoundError } from '@vercel/blob'
import {
  authOrganizations,
  deletionRequests,
  googleAdsConnections,
  jobs,
  workspaceDeletionTombstones,
  workspaceDomains,
  workspaces,
} from '@/db/schema'
import { withPurgeTransaction, withSystemTransaction, type DatabaseTransaction } from '@/db/transactions'
import { getStripe } from '@/lib/billing'
import { isControlledBrandLogoUrl } from '@/lib/branding-assets'
import { decryptSecret } from '@/lib/crypto'
import { revokeGoogleOAuthToken } from '@/lib/google-ads'
import { removeVercelProjectDomain } from '@/lib/vercel-domains'
import { NonRetryableJobError, type ClaimedJob } from '@/lib/jobs'

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

async function removeBlobIfPresent(url: string) {
  try {
    await del(url)
  } catch (error) {
    if (!(error instanceof BlobNotFoundError)) throw error
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

export const externalCleanupPayload = z.object({
  workspaceHash: z.string().regex(/^[a-f0-9]{64}$/),
  logoUrl: z.string().url().nullable(),
  hostnames: z.array(z.string().min(1).max(253)).max(100),
}).strict()
type ExternalCleanupInput = z.infer<typeof externalCleanupPayload>

async function requireCleanupClock(db: DatabaseTransaction, job: ClaimedJob) {
  const result = await db.execute<{ active: boolean }>(sql`select ${job.leaseExpiresAt?.toISOString() ?? null}::timestamptz > clock_timestamp() as active`)
  if (!result.rows[0]?.active) throw new Error('External cleanup job lease lost')
}

async function cleanupContext(db: DatabaseTransaction, input: ExternalCleanupInput, job: ClaimedJob) {
  const [current] = await db.select().from(jobs).where(and(
    eq(jobs.id, job.id), isNull(jobs.workspaceId), eq(jobs.type, 'workspace.external_cleanup'),
    eq(jobs.status, 'running'), eq(jobs.leaseOwner, job.leaseOwner!), eq(jobs.attemptCount, job.attemptCount),
    eq(jobs.deduplicationKey, `workspace.external_cleanup:${input.workspaceHash}`),
  )).limit(1).for('update')
  if (!current) throw new Error('External cleanup job lease lost')
  const payload = externalCleanupPayload.safeParse(current.payload)
  if (!payload.success || JSON.stringify(payload.data) !== JSON.stringify(input)) throw new NonRetryableJobError('External cleanup job payload mismatch')
  const [tombstone] = await db.select().from(workspaceDeletionTombstones)
    .where(eq(workspaceDeletionTombstones.workspaceHash, input.workspaceHash)).limit(1).for('update')
  if (!tombstone) throw new NonRetryableJobError('External cleanup tombstone missing')
  // Check the SQL clock after both locks. A waiter must not use a pre-lock expiry decision.
  await requireCleanupClock(db, current)
  if (tombstone.externalCleanupStatus === 'completed' && !tombstone.externalCleanupCompletedAt) throw new NonRetryableJobError('External cleanup completion receipt missing')
  return { current, tombstone }
}

export async function runWorkspaceExternalCleanup(input: ExternalCleanupInput, job: ClaimedJob) {
  input = externalCleanupPayload.parse(input)
  if (job.workspaceId !== null || job.type !== 'workspace.external_cleanup' || !job.leaseOwner) throw new NonRetryableJobError('External cleanup requires its claimed global job')
  const prepared = await withSystemTransaction(async (db) => {
    const context = await cleanupContext(db, input, job)
    if (context.tombstone.externalCleanupStatus === 'completed') return context.tombstone.externalCleanupCompletedAt!
    await db.update(workspaceDeletionTombstones).set({
      externalCleanupStatus: 'running', externalCleanupError: null, externalCleanupCompletedAt: null,
    }).where(eq(workspaceDeletionTombstones.id, context.tombstone.id))
    await requireCleanupClock(db, context.current)
    return null
  })
  if (prepared) return { completedAt: prepared, skipped: 'already_completed' as const }
  const admit = () => withSystemTransaction(async (db) => {
    const { tombstone } = await cleanupContext(db, input, job)
    if (tombstone.externalCleanupStatus !== 'running') throw new Error('External cleanup is no longer running')
  })
  try {
    if (input.logoUrl) { await admit(); await removeBlobIfPresent(input.logoUrl) }
    for (const hostname of input.hostnames) await removeVercelProjectDomain(hostname, admit)
    return await withSystemTransaction(async (db) => {
      const { current, tombstone } = await cleanupContext(db, input, job)
      if (tombstone.externalCleanupStatus !== 'running') throw new Error('External cleanup is no longer running')
      const completedAt = new Date()
      await db.update(workspaceDeletionTombstones).set({
        externalCleanupStatus: 'completed', externalCleanupError: null, externalCleanupCompletedAt: completedAt,
      }).where(eq(workspaceDeletionTombstones.id, tombstone.id))
      await requireCleanupClock(db, current)
      return { completedAt, deletedLogo: Boolean(input.logoUrl), removedDomains: input.hostnames.length }
    })
  } catch (error) {
    try {
      await withSystemTransaction(async (db) => {
        const { current, tombstone } = await cleanupContext(db, input, job)
        if (tombstone.externalCleanupStatus !== 'running') return
        await db.update(workspaceDeletionTombstones).set({
          externalCleanupStatus: 'failed', externalCleanupCompletedAt: null,
          externalCleanupError: 'External cleanup could not be confirmed. Retry or contact support.',
        }).where(eq(workspaceDeletionTombstones.id, tombstone.id))
        await requireCleanupClock(db, current)
      })
    } catch {
      // A lost attempt cannot change its successor's receipt or failure state.
    }
    throw error
  }
}
