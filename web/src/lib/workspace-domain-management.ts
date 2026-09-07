import 'server-only'

import { and, eq, isNull, sql } from 'drizzle-orm'
import { auditEvents, secretRevelations, workspaceDomains } from '@/db/schema'
import { withTenantTransaction, type DatabaseTransaction } from '@/db/transactions'
import { encryptSecret } from '@/lib/crypto'
import { hashToken } from '@/lib/tokens'
import {
  addOrVerifyVercelProjectDomain,
  domainDnsRecord,
  domainReachesApplication,
  removeVercelProjectDomain,
  verifyDomainDnsOwnership,
} from '@/lib/vercel-domains'
import { lockWorkspaceAccessBoundary } from '@/lib/workspace-transaction-guard'
import { withWorkspaceActorTransaction } from '@/lib/workspace-actor-guard'

type ActorContext = { workspaceId: string; actorUserId: string }

export function createWorkspaceCustomDomain(input: ActorContext & {
  hostname: string
  token: string
  now?: Date
}) {
  const now = input.now ?? new Date()
  const dns = domainDnsRecord(input.hostname, input.token)
  return withWorkspaceActorTransaction({ ...input, permission: 'workspace:admin', capability: 'custom_domain' }, async (db) => {
    await db.execute(sql`select pg_advisory_xact_lock(hashtext(${`${input.workspaceId}:domains`}))`)
    const existing = await db.query.workspaceDomains.findFirst({
      where: and(eq(workspaceDomains.workspaceId, input.workspaceId), isNull(workspaceDomains.revokedAt)),
    })
    if (existing) throw new Error('Révoquez le domaine existant avant d’en configurer un autre.')
    const [domain] = await db.insert(workspaceDomains).values({
      workspaceId: input.workspaceId,
      hostname: input.hostname,
      dnsTokenHash: hashToken(input.token),
    }).returning({ id: workspaceDomains.id })
    if (!domain) throw new Error('La création du domaine a échoué.')
    const [revelation] = await db.insert(secretRevelations).values({
      workspaceId: input.workspaceId,
      userId: input.actorUserId,
      kind: 'domain_dns',
      encryptedSecret: encryptSecret(JSON.stringify(dns)),
      expiresAt: new Date(now.getTime() + 10 * 60_000),
    }).returning({ id: secretRevelations.id })
    if (!revelation) throw new Error('La révélation one-shot du challenge DNS a échoué.')
    await db.insert(auditEvents).values({
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      action: 'workspace_domain.created',
      entityType: 'workspace_domain',
      entityId: domain.id,
      metadata: { hostname: input.hostname },
    })
    return revelation
  }).catch((error: unknown) => {
    const cause = error instanceof Error ? error.cause : undefined
    if (cause && typeof cause === 'object' && 'constraint' in cause && cause.constraint === 'domain_cleanup_reservation_active') {
      throw new Error('Ce domaine reste réservé pendant son nettoyage. Contactez le support.')
    }
    throw error
  })
}

async function lockedDomain(db: DatabaseTransaction, input: ActorContext & { domainId: string }, expectedRevision?: string) {
  // xmin preserves the full row revision across provider waits, including changes within one millisecond.
  const { rows: [current] } = await db.execute<{ revision: string }>(sql`select xmin::text as revision from ${workspaceDomains}
    where ${workspaceDomains.id} = ${input.domainId} and ${workspaceDomains.workspaceId} = ${input.workspaceId}
    and ${workspaceDomains.revokedAt} is null for update`)
  if (!current) throw new Error('Domaine introuvable.')
  if (expectedRevision !== undefined && current.revision !== expectedRevision) throw new Error('Le domaine a changé. Actualisez la page avant de réessayer.')
  const domain = await db.query.workspaceDomains.findFirst({ where: and(eq(workspaceDomains.id, input.domainId), eq(workspaceDomains.workspaceId, input.workspaceId), isNull(workspaceDomains.revokedAt)) })
  if (!domain) throw new Error('Domaine introuvable.')
  return { ...domain, revision: current.revision }
}

function findActiveDomain(input: ActorContext & { domainId: string }, customDomain: boolean, expectedRevision?: string) {
  return withWorkspaceActorTransaction({ ...input, permission: 'workspace:admin', ...(customDomain ? { capability: 'custom_domain' as const } : {}) },
    (db) => lockedDomain(db, input, expectedRevision))
}

async function recordDomainFailure(input: ActorContext & { domainId: string; revision: string; customDomain: boolean }) {
  try {
    await withWorkspaceActorTransaction({ ...input, permission: 'workspace:admin', ...(input.customDomain ? { capability: 'custom_domain' as const } : {}) }, async (db) => {
      await lockedDomain(db, input, input.revision)
      await db
      .update(workspaceDomains)
      .set({ lastError: 'Opération du domaine non finalisée. Réessayez ou contactez le support.', updatedAt: new Date() })
      .where(and(
        eq(workspaceDomains.id, input.domainId),
        eq(workspaceDomains.workspaceId, input.workspaceId),
        isNull(workspaceDomains.revokedAt),
      ))
    })
  } catch {
    // The provider or verification error remains the primary failure.
  }
}

export async function verifyWorkspaceCustomDomain(input: ActorContext & { domainId: string; now?: Date }) {
  const domain = await findActiveDomain(input, true)
  try {
    if (!(await verifyDomainDnsOwnership(domain.hostname, domain.dnsTokenHash))) {
      throw new Error(`Le TXT _yodev-ads.${domain.hostname} est absent ou incorrect.`)
    }
    const beforeRequest = async () => { await findActiveDomain(input, true, domain.revision) }
    const vercel = await addOrVerifyVercelProjectDomain(domain.hostname, domain.vercelStatus !== 'not_submitted', beforeRequest)
    const configured = vercel.verified === true && vercel.configuration?.misconfigured === false
    const reachable = configured ? await domainReachesApplication(domain.hostname) : false
    const active = configured && reachable
    const updated = await withWorkspaceActorTransaction({ ...input, permission: 'workspace:admin', capability: 'custom_domain' }, async (db) => {
      await lockedDomain(db, input, domain.revision)
      const now = input.now ?? new Date()
      const [row] = await db.update(workspaceDomains).set({
        verificationStatus: active ? 'active' : 'dns_verified',
        vercelStatus: active ? 'active' : vercel.verified ? 'configuration_pending' : 'ownership_pending',
        vercelConfiguration: vercel as unknown as Record<string, unknown>,
        verifiedAt: now,
        activatedAt: active ? now : null,
        lastError: null,
        updatedAt: now,
      }).where(and(
        eq(workspaceDomains.id, domain.id),
        eq(workspaceDomains.workspaceId, input.workspaceId),
        isNull(workspaceDomains.revokedAt),
      )).returning({ id: workspaceDomains.id })
      if (!row) throw new Error('Le domaine a été révoqué pendant sa vérification.')
      await db.insert(auditEvents).values({
        workspaceId: input.workspaceId,
        actorUserId: input.actorUserId,
        action: active ? 'workspace_domain.activated' : 'workspace_domain.verification_progressed',
        entityType: 'workspace_domain',
        entityId: domain.id,
        metadata: { hostname: domain.hostname, vercelVerified: vercel.verified, configured, reachable },
      })
      return row
    })
    return { domain: updated, active, configured, reachable }
  } catch (error) {
    await recordDomainFailure({ ...input, revision: domain.revision, customDomain: true })
    throw error
  }
}

export async function revokeWorkspaceCustomDomain(input: ActorContext & { domainId: string; now?: Date }) {
  // Removal remains available after a plan downgrade; it requires the current administrator, not the old capability.
  const domain = await findActiveDomain(input, false)
  try {
    await removeVercelProjectDomain(domain.hostname)
  } catch (error) {
    await recordDomainFailure({ ...input, revision: domain.revision, customDomain: false })
    throw error
  }
  return withTenantTransaction({ workspaceId: input.workspaceId, userId: input.actorUserId }, async (db) => {
    // Record an already-admitted external removal even if the actor subsequently loses access.
    // This receipt must not reactivate anything or overwrite a different domain revision.
    await lockWorkspaceAccessBoundary(db, input.workspaceId)
    await lockedDomain(db, input, domain.revision)
    const now = input.now ?? new Date()
    const [revoked] = await db.update(workspaceDomains).set({
      verificationStatus: 'revoked',
      vercelStatus: 'removed',
      revokedAt: now,
      activatedAt: null,
      lastError: null,
      updatedAt: now,
    }).where(and(
      eq(workspaceDomains.id, domain.id),
      eq(workspaceDomains.workspaceId, input.workspaceId),
      isNull(workspaceDomains.revokedAt),
    )).returning({ id: workspaceDomains.id })
    if (!revoked) throw new Error('Le domaine a déjà été révoqué.')
    await db.insert(auditEvents).values({
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      action: 'workspace_domain.revoked',
      entityType: 'workspace_domain',
      entityId: domain.id,
      metadata: { hostname: domain.hostname },
    })
    return revoked
  })
}
