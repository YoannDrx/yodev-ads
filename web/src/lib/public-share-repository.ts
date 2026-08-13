import 'server-only'

import { and, eq, isNull } from 'drizzle-orm'
import {
  clients,
  googleAdsConnections,
  shareLinks,
  workspaceDomains,
  workspaces,
} from '@/db/schema'
import { withSystemTransaction } from '@/db/transactions'
import { workspaceHasCapability } from '@/lib/entitlements'
import { hashToken } from '@/lib/tokens'
import { workspaceCanCallGoogle } from '@/lib/workspace-access'

export async function publicHostBelongsToWorkspace(host: string, workspaceId: string) {
  const normalizedHost = host.split(',')[0].trim().toLocaleLowerCase('en-US').split(':')[0]
  const applicationHost = new URL(process.env.NEXT_PUBLIC_APP_URL ?? 'https://ads.yodev.fr').hostname
  if (normalizedHost === applicationHost) return true
  return withSystemTransaction(async (db) => {
    const workspace = await db.query.workspaces.findFirst({
      where: eq(workspaces.id, workspaceId),
      columns: { accessState: true, plan: true },
    })
    if (!workspace || !workspaceHasCapability(workspace.accessState, workspace.plan, 'custom_domain')) return false
    return Boolean(await db.query.workspaceDomains.findFirst({
      where: and(
        eq(workspaceDomains.workspaceId, workspaceId),
        eq(workspaceDomains.hostname, normalizedHost),
        eq(workspaceDomains.verificationStatus, 'active'),
        isNull(workspaceDomains.revokedAt),
      ),
      columns: { id: true },
    }))
  })
}

export async function getPublicShare(token: string, host?: string | null) {
  const [result] = await withSystemTransaction((db) => db
    .select({ share: shareLinks, client: clients, connection: googleAdsConnections, workspace: workspaces })
    .from(shareLinks)
    .innerJoin(clients, eq(clients.id, shareLinks.clientId))
    .innerJoin(googleAdsConnections, eq(googleAdsConnections.workspaceId, shareLinks.workspaceId))
    .innerJoin(workspaces, eq(workspaces.id, shareLinks.workspaceId))
    .where(and(eq(shareLinks.tokenHash, hashToken(token)), eq(shareLinks.active, true)))
    .limit(1))
  if (!result || (result.share.expiresAt && result.share.expiresAt < new Date())) return undefined
  if (!workspaceCanCallGoogle(result.workspace.accessState)) return undefined
  if (host && !(await publicHostBelongsToWorkspace(host, result.share.workspaceId))) return undefined
  return result
}
