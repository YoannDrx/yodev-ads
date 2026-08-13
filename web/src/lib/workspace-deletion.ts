import 'server-only'

import { createHmac } from 'node:crypto'
import { and, eq, lte } from 'drizzle-orm'
import { del } from '@vercel/blob'
import { authOrganizations, deletionRequests, workspaceDeletionTombstones, workspaceDomains, workspaces } from '@/db/schema'
import { withPurgeTransaction } from '@/db/transactions'
import { isControlledBrandLogoUrl } from '@/lib/branding-assets'
import { removeVercelProjectDomain } from '@/lib/vercel-domains'

function tombstoneHash(workspaceId: string) {
  const key = process.env.DELETION_TOMBSTONE_KEY ?? process.env.APP_ENCRYPTION_KEY
  if (!key) throw new Error('DELETION_TOMBSTONE_KEY is not configured')
  return createHmac('sha256', key).update(workspaceId).digest('hex')
}

export async function purgeWorkspace(workspaceId: string, now = new Date()) {
  return withPurgeTransaction(async (db) => {
    const [request] = await db.update(deletionRequests).set({ status: 'purging' }).where(and(
      eq(deletionRequests.workspaceId, workspaceId),
      eq(deletionRequests.status, 'pending'),
      lte(deletionRequests.purgeAt, now),
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
    const ignoreMissing = async (operation: Promise<unknown>) => {
      try {
        await operation
      } catch (error) {
        if (!(error instanceof Error) || !/not found|404|does not exist/i.test(error.message)) throw error
      }
    }
    if (workspace.logoUrl && isControlledBrandLogoUrl(workspace.logoUrl)) {
      await ignoreMissing(del(workspace.logoUrl))
    }
    for (const domain of domains) await ignoreMissing(removeVercelProjectDomain(domain.hostname))
    if (workspace.authOrganizationId) {
      await db.delete(authOrganizations).where(eq(authOrganizations.id, workspace.authOrganizationId))
    }
    await db.insert(workspaceDeletionTombstones).values({
      workspaceHash: tombstoneHash(workspaceId),
      deletionRequestedAt: request.requestedAt,
      retainUntil: new Date(now.getTime() + 10 * 365 * 24 * 60 * 60_000),
    }).onConflictDoNothing()
    await db.delete(workspaces).where(eq(workspaces.id, workspaceId))
    return 'purged' as const
  })
}
