import 'server-only'

import { and, eq, isNull, sql } from 'drizzle-orm'
import { z } from 'zod'
import { apiKeys, clients, reportEditions, secretRevelations, shareLinks, workspaceDomains } from '@/db/schema'
import { withTenantTransaction, type DatabaseTransaction } from '@/db/transactions'
import { decryptSecret } from '@/lib/crypto'
import { hashToken } from '@/lib/tokens'
import { lockWorkspaceActor } from '@/lib/workspace-actor-guard'
import { requireCapability, type Capability } from '@/lib/entitlements'
import { privateApiWorkspaceAllowed } from '@/lib/feature-flags'
import type { Permission } from '@/lib/permissions'

const unavailable = () => new Error('Révélation indisponible.')
const policies: Record<string, { permission: Permission; capability: Capability }> = {
  api_key: { permission: 'api_keys:manage', capability: 'api.read' },
  report_url: { permission: 'reports:manage', capability: 'monitoring' },
  domain_dns: { permission: 'workspace:admin', capability: 'custom_domain' },
}

/** Bind existing encrypted revelations to their current resource without duplicating secrets or changing the schema. */
async function lockResource(db: DatabaseTransaction, workspaceId: string, kind: string, secret: string, entitlements: Awaited<ReturnType<typeof lockWorkspaceActor>>['entitlements']) {
  const expirations: Date[] = []
  if (kind === 'api_key') {
    if (!privateApiWorkspaceAllowed(workspaceId, entitlements.state)) throw unavailable()
    const [key] = await db.select().from(apiKeys).where(and(eq(apiKeys.workspaceId, workspaceId), eq(apiKeys.tokenHash, hashToken(secret)), isNull(apiKeys.revokedAt))).limit(1).for('share')
    if (!key) throw unavailable()
    if (key.scopes.some((scope) => scope === 'approvals:propose' || scope === 'reports:write')) requireCapability(entitlements, 'api.propose')
    if (key.expiresAt) expirations.push(key.expiresAt)
  } else if (kind === 'report_url') {
    const url = new URL(secret), token = /^\/r\/([A-Za-z0-9_-]{20,})$/.exec(url.pathname)?.[1]
    if (!token || !['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw unavailable()
    const [context] = await db.select({ share: shareLinks }).from(shareLinks)
      .innerJoin(clients, and(eq(clients.id, shareLinks.clientId), eq(clients.workspaceId, shareLinks.workspaceId)))
      .where(and(eq(shareLinks.workspaceId, workspaceId), eq(shareLinks.tokenHash, hashToken(token)), eq(shareLinks.active, true), eq(clients.active, true), eq(clients.isManager, false))).limit(1).for('share', { of: [shareLinks, clients] })
    if (!context) throw unavailable()
    if (context.share.expiresAt) expirations.push(context.share.expiresAt)
    if (url.searchParams.has('edition')) {
      const id = z.uuid().parse(url.searchParams.get('edition'))
      // Editions are immutable and the app role intentionally has no UPDATE
      // grant (which even FOR SHARE would require). Retention removes expired
      // editions; their deadline is checked again after consumption below.
      const [edition] = await db.select({ expiresAt: reportEditions.expiresAt }).from(reportEditions).where(and(eq(reportEditions.id, id), eq(reportEditions.workspaceId, workspaceId), eq(reportEditions.shareId, context.share.id))).limit(1)
      if (!edition) throw unavailable()
      expirations.push(edition.expiresAt)
    }
    if (url.origin !== new URL(process.env.NEXT_PUBLIC_APP_URL ?? 'https://ads.yodev.fr').origin) {
      requireCapability(entitlements, 'custom_domain')
      const [domain] = await db.select({ id: workspaceDomains.id }).from(workspaceDomains).where(and(eq(workspaceDomains.workspaceId, workspaceId), eq(workspaceDomains.hostname, url.hostname), eq(workspaceDomains.verificationStatus, 'active'), isNull(workspaceDomains.revokedAt))).limit(1).for('share')
      if (!domain || url.protocol !== 'https:' || url.port) throw unavailable()
    }
  } else {
    const dns = z.object({ type: z.literal('TXT'), name: z.string().startsWith('_yodev-ads.'), value: z.string().startsWith('yodev-domain-verification=') }).parse(JSON.parse(secret))
    const [domain] = await db.select({ id: workspaceDomains.id }).from(workspaceDomains).where(and(eq(workspaceDomains.workspaceId, workspaceId), eq(workspaceDomains.hostname, dns.name.slice('_yodev-ads.'.length)), eq(workspaceDomains.dnsTokenHash, hashToken(dns.value.slice('yodev-domain-verification='.length))), isNull(workspaceDomains.revokedAt))).limit(1).for('share')
    if (!domain) throw unavailable()
  }
  return expirations
}

export function consumeWorkspaceSecretRevelation(workspaceId: string, userId: string, revelationId: string, expectedKind?: 'api_key' | 'report_url' | 'domain_dns') {
  return withTenantTransaction({ workspaceId, userId }, async (db) => {
    const actor = { workspaceId, actorUserId: userId }
    // Always take the workspace/actor boundary before a resource row; creators
    // and revocations use that same order. The locked kind chooses the stronger permission.
    await lockWorkspaceActor(db, { ...actor, permission: 'workspace:read' })
    const [revelation] = await db.select().from(secretRevelations).where(and(eq(secretRevelations.id, revelationId), eq(secretRevelations.workspaceId, workspaceId), eq(secretRevelations.userId, userId), isNull(secretRevelations.revealedAt))).limit(1).for('update')
    const policy = revelation && Object.hasOwn(policies, revelation.kind) ? policies[revelation.kind] : undefined
    if (!revelation || !policy || (expectedKind && revelation.kind !== expectedKind)) throw unavailable()
    const access = await lockWorkspaceActor(db, { ...actor, ...policy })
    const expirations = await lockResource(db, workspaceId, revelation.kind, decryptSecret(revelation.encryptedSecret), access.entitlements)
    const [consumed] = await db.update(secretRevelations).set({ revealedAt: sql`clock_timestamp()` })
      .where(and(eq(secretRevelations.id, revelation.id), sql`${secretRevelations.expiresAt} > clock_timestamp()`)).returning({ encryptedSecret: secretRevelations.encryptedSecret })
    if (!consumed) throw unavailable()
    await lockWorkspaceActor(db, { ...actor, ...policy })
    // Mutable resource rows remain locked; immutable edition deadlines are included too.
    const { rows: [clock] } = await db.execute<{ now_ms: string }>(sql`select extract(epoch from clock_timestamp()) * 1000 as now_ms`)
    const now = Number(clock?.now_ms)
    if (!Number.isFinite(now) || [revelation.expiresAt, ...expirations].some((expiration) => expiration.getTime() <= now)) throw unavailable()
    return consumed
  })
}
