import 'server-only'

import { and, eq, isNull, sql } from 'drizzle-orm'
import { auditEvents, secretRevelations, workspaceDomains } from '@/db/schema'
import { withTenantTransaction } from '@/db/transactions'
import { encryptSecret } from '@/lib/crypto'
import { hashToken } from '@/lib/tokens'
import {
  addOrVerifyVercelProjectDomain,
  domainDnsRecord,
  domainReachesApplication,
  removeVercelProjectDomain,
  verifyDomainDnsOwnership,
} from '@/lib/vercel-domains'
import { lockWorkspaceEntitlements } from '@/lib/workspace-transaction-guard'

type ActorContext = { workspaceId: string; actorUserId: string }

export function createWorkspaceCustomDomain(input: ActorContext & {
  hostname: string
  token: string
  now?: Date
}) {
  const now = input.now ?? new Date()
  const dns = domainDnsRecord(input.hostname, input.token)
  return withTenantTransaction({ workspaceId: input.workspaceId, userId: input.actorUserId }, async (db) => {
    await lockWorkspaceEntitlements(db, input.workspaceId, 'custom_domain')
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
  })
}

async function findActiveDomain(input: ActorContext & { domainId: string }) {
  const domain = await withTenantTransaction(
    { workspaceId: input.workspaceId, userId: input.actorUserId },
    (db) => db.query.workspaceDomains.findFirst({
      where: and(
        eq(workspaceDomains.id, input.domainId),
        eq(workspaceDomains.workspaceId, input.workspaceId),
        isNull(workspaceDomains.revokedAt),
      ),
    }),
  )
  if (!domain) throw new Error('Domaine introuvable.')
  return domain
}

async function recordDomainFailure(input: ActorContext & { domainId: string; error: unknown; now: Date }) {
  try {
    await withTenantTransaction({ workspaceId: input.workspaceId, userId: input.actorUserId }, (db) => db
      .update(workspaceDomains)
      .set({ lastError: (input.error instanceof Error ? input.error.message : String(input.error)).slice(0, 2000), updatedAt: input.now })
      .where(and(
        eq(workspaceDomains.id, input.domainId),
        eq(workspaceDomains.workspaceId, input.workspaceId),
        isNull(workspaceDomains.revokedAt),
      )))
  } catch {
    // The provider or verification error remains the primary failure.
  }
}

export async function verifyWorkspaceCustomDomain(input: ActorContext & { domainId: string; now?: Date }) {
  const now = input.now ?? new Date()
  try {
    const domain = await findActiveDomain(input)
    if (!(await verifyDomainDnsOwnership(domain.hostname, domain.dnsTokenHash))) {
      throw new Error(`Le TXT _yodev-ads.${domain.hostname} est absent ou incorrect.`)
    }
    const vercel = await addOrVerifyVercelProjectDomain(domain.hostname, domain.vercelStatus !== 'not_submitted')
    const configured = vercel.verified === true && vercel.configuration?.misconfigured === false
    const reachable = configured ? await domainReachesApplication(domain.hostname) : false
    const active = configured && reachable
    const updated = await withTenantTransaction({ workspaceId: input.workspaceId, userId: input.actorUserId }, async (db) => {
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
    await recordDomainFailure({ ...input, error, now })
    throw error
  }
}

export async function revokeWorkspaceCustomDomain(input: ActorContext & { domainId: string; now?: Date }) {
  const now = input.now ?? new Date()
  const domain = await findActiveDomain(input)
  try {
    await removeVercelProjectDomain(domain.hostname)
  } catch (error) {
    if (!(error instanceof Error) || !/not found|404/i.test(error.message)) {
      await recordDomainFailure({ ...input, error, now })
      throw error
    }
  }
  return withTenantTransaction({ workspaceId: input.workspaceId, userId: input.actorUserId }, async (db) => {
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
