import 'server-only'

import { and, count, eq, isNull, sql } from 'drizzle-orm'
import { apiKeys, auditEvents, clients, jobs, notificationChannels, safetyPolicies, secretRevelations, workspaces } from '@/db/schema'
import { withWorkspaceActorTransaction } from '@/lib/workspace-actor-guard'
import { encryptSecret } from '@/lib/crypto'
import { requireQuota, type EntitlementContext } from '@/lib/entitlements'
import { hashToken } from '@/lib/tokens'
import { assertSafetyPolicyScope } from '@/lib/safety-policy-scope'
import { privateApiWorkspaceAllowed } from '@/lib/feature-flags'

type ActorContext = { workspaceId: string; actorUserId: string }

export function notificationDestinationHint(kind: string, destination: string) {
  if (kind === 'email') {
    const [local, domain] = destination.split('@')
    return `${local.slice(0, 2)}•••@${domain}`
  }
  const url = new URL(destination)
  return `${url.hostname}/••••`
}

export function createWorkspaceApiKey(input: ActorContext & {
  name: string
  token: string
  scopes: string[]
  entitlements: EntitlementContext
  now?: Date
}) {
  const allowedScopes = new Set(['portfolio:read', 'performance:read', 'alerts:read', 'approvals:read', 'approvals:propose', 'reports:read', 'reports:write'])
  if (!input.scopes.length || input.scopes.some((scope) => !allowedScopes.has(scope))) throw new Error('Périmètre de clé API invalide.')
  const capability = input.scopes.some((scope) => scope === 'approvals:propose' || scope === 'reports:write') ? 'api.propose' : 'api.read'
  return withWorkspaceActorTransaction({ ...input, permission: 'api_keys:manage', capability }, async (transaction, { entitlements }) => {
    if (!privateApiWorkspaceAllowed(input.workspaceId, entitlements.state)) throw new Error('La bêta privée de l’API n’est pas activée pour cet espace.')
    await transaction.execute(sql`select pg_advisory_xact_lock(hashtext(${`${input.workspaceId}:apiKeys`}))`)
    const [usage] = await transaction
      .select({ count: count() })
      .from(apiKeys)
      .where(and(eq(apiKeys.workspaceId, input.workspaceId), isNull(apiKeys.revokedAt)))
    requireQuota(entitlements, 'apiKeys', usage.count)
    const now = input.now ?? new Date()
    const expiresAt = new Date(now.getTime() + 90 * 24 * 60 * 60_000)
    const [key] = await transaction.insert(apiKeys).values({
      workspaceId: input.workspaceId,
      createdBy: input.actorUserId,
      name: input.name,
      tokenHash: hashToken(input.token),
      tokenPrefix: input.token.slice(0, 16),
      scopes: input.scopes,
      expiresAt,
    }).returning({ id: apiKeys.id })
    if (!key) throw new Error('La création de la clé API a échoué.')
    const [revelation] = await transaction.insert(secretRevelations).values({
      workspaceId: input.workspaceId,
      userId: input.actorUserId,
      kind: 'api_key',
      encryptedSecret: encryptSecret(input.token),
      expiresAt: new Date(now.getTime() + 5 * 60_000),
    }).returning({ id: secretRevelations.id })
    if (!revelation) throw new Error('La révélation one-shot de la clé API a échoué.')
    await transaction.insert(auditEvents).values({
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      action: 'api_key.created',
      entityType: 'api_key',
      entityId: key.id,
      metadata: { scopes: input.scopes, expiresAt: expiresAt.toISOString() },
    })
    return revelation
  })
}

export function revokeWorkspaceApiKey(input: ActorContext & { keyId: string; now?: Date }) {
  const now = input.now ?? new Date()
  return withWorkspaceActorTransaction({ ...input, permission: 'api_keys:manage' }, async (db) => {
    const [key] = await db
      .update(apiKeys)
      .set({ revokedAt: now, updatedAt: now })
      .where(and(eq(apiKeys.id, input.keyId), eq(apiKeys.workspaceId, input.workspaceId), isNull(apiKeys.revokedAt)))
      .returning({ id: apiKeys.id })
    if (!key) throw new Error('Clé API introuvable.')
    await db.insert(auditEvents).values({
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      action: 'api_key.revoked',
      entityType: 'api_key',
      entityId: key.id,
      metadata: {},
    })
    return key
  })
}

export function createWorkspaceNotificationChannel(input: ActorContext & {
  kind: 'email' | 'slack' | 'teams' | 'webhook'
  label: string
  destination: string
  minimumSeverity: 'warning' | 'critical'
  entitlements: EntitlementContext
}) {
  return withWorkspaceActorTransaction({ ...input, permission: 'workspace:admin', capability: input.kind === 'email' ? 'monitoring' : 'notifications.webhook' }, async (transaction, { entitlements }) => {
    await transaction.execute(sql`select pg_advisory_xact_lock(hashtext(${`${input.workspaceId}:notificationChannels`}))`)
    const [usage] = await transaction
      .select({ count: count() })
      .from(notificationChannels)
      .where(and(eq(notificationChannels.workspaceId, input.workspaceId), eq(notificationChannels.enabled, true)))
    requireQuota(entitlements, 'notificationChannels', usage.count)
    const [channel] = await transaction.insert(notificationChannels).values({
      workspaceId: input.workspaceId,
      createdBy: input.actorUserId,
      kind: input.kind,
      label: input.label,
      encryptedDestination: encryptSecret(input.destination),
      destinationHint: notificationDestinationHint(input.kind, input.destination),
      minimumSeverity: input.minimumSeverity,
    }).returning({ id: notificationChannels.id })
    if (!channel) throw new Error('La création du canal a échoué.')
    await transaction.insert(auditEvents).values({
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      action: 'notification_channel.created',
      entityType: 'notification_channel',
      entityId: channel.id,
      metadata: { kind: input.kind, minimumSeverity: input.minimumSeverity },
    })
    return channel
  })
}

export function disableWorkspaceNotificationChannel(input: ActorContext & { channelId: string; now?: Date }) {
  const now = input.now ?? new Date()
  return withWorkspaceActorTransaction({ ...input, permission: 'workspace:admin' }, async (db) => {
    const [channel] = await db
      .update(notificationChannels)
      .set({
        enabled: false,
        encryptedDestination: encryptSecret('revoked'),
        destinationHint: 'revoked',
        updatedAt: now,
      })
      .where(and(
        eq(notificationChannels.id, input.channelId),
        eq(notificationChannels.workspaceId, input.workspaceId),
        eq(notificationChannels.enabled, true),
      ))
      .returning({ id: notificationChannels.id })
    if (!channel) throw new Error('Canal introuvable.')
    await db.insert(auditEvents).values({
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      action: 'notification_channel.disabled',
      entityType: 'notification_channel',
      entityId: channel.id,
      metadata: { credentialsDestroyed: true },
    })
    return channel
  })
}

export function retryWorkspaceDeadLetterJob(input: ActorContext & { jobId: string; now?: Date }) {
  const now = input.now ?? new Date()
  return withWorkspaceActorTransaction({ ...input, permission: 'workspace:admin' }, async (db) => {
    const [job] = await db
      .update(jobs)
      .set({
        status: 'queued',
        payload: sql`coalesce(${jobs.payload}, '{}'::jsonb) || jsonb_build_object(
          'manualRetryGeneration',
          coalesce((${jobs.payload}->>'manualRetryGeneration')::int, 0) + 1
        )`,
        availableAt: now,
        maximumAttempts: sql`${jobs.attemptCount} + 5`,
        leaseOwner: null,
        leaseExpiresAt: null,
        deadLetteredAt: null,
        lastError: null,
        updatedAt: now,
      })
      .where(and(eq(jobs.id, input.jobId), eq(jobs.workspaceId, input.workspaceId), eq(jobs.status, 'dead_letter')))
      .returning({ id: jobs.id, type: jobs.type, payload: jobs.payload })
    if (!job) throw new Error('Job en dead-letter introuvable.')
    await db.insert(auditEvents).values({
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      action: 'job.manual_retry_requested',
      entityType: 'job',
      entityId: job.id,
      metadata: {
        type: job.type,
        manualRetryGeneration: job.payload && typeof job.payload === 'object' && 'manualRetryGeneration' in job.payload
          ? job.payload.manualRetryGeneration
          : null,
      },
    })
    return job
  })
}

function monetaryMicros(value: number | '') {
  return value === '' ? null : String(Math.round(value * 1_000_000))
}

export function saveWorkspaceSafetyPolicy(input: ActorContext & {
  scope: 'workspace' | 'client' | 'campaign'
  clientId: string | null
  campaignId: string | null
  currencyCode: string
  maximumDailyBudget: number | ''
  maximumMonthlySpend: number | ''
  maximumVariationPercent: number | ''
  notificationEmail: string
  now?: Date
}) {
  const now = input.now ?? new Date()
  const maximumDailyBudgetMicros = monetaryMicros(input.maximumDailyBudget)
  const maximumMonthlySpendMicros = monetaryMicros(input.maximumMonthlySpend)
  return withWorkspaceActorTransaction({ ...input, permission: 'workspace:admin' }, async (transaction, { entitlements }) => {
    assertSafetyPolicyScope(entitlements.plan, input.scope)
    if ((input.scope === 'workspace' && (input.clientId || input.campaignId))
      || (input.scope !== 'workspace' && !input.clientId)
      || (input.scope === 'client' && input.campaignId)
      || (input.scope === 'campaign' && !input.campaignId)) throw new Error('Périmètre de règle de sécurité invalide.')
    if (input.clientId) {
      const [client] = await transaction.select({ currencyCode: clients.currencyCode, isManager: clients.isManager }).from(clients)
        .where(and(eq(clients.id, input.clientId), eq(clients.workspaceId, input.workspaceId))).limit(1).for('share')
      if (!client || client.isManager) throw new Error('Compte client introuvable.')
      if (client.currencyCode !== input.currencyCode) throw new Error(`La devise de la règle doit être ${client.currencyCode} pour ce client.`)
    }
    await transaction.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`safety:${input.workspaceId}:${input.clientId ?? 'workspace'}:${input.campaignId ?? 'all'}`}, 0))`)
    await transaction.update(workspaces).set({
      ...(input.scope === 'workspace' ? { maximumDailyBudgetMicros, maximumMonthlySpendMicros } : {}),
      notificationEmail: input.notificationEmail || null,
      updatedAt: now,
    }).where(eq(workspaces.id, input.workspaceId))
    await transaction.delete(safetyPolicies).where(and(
      eq(safetyPolicies.workspaceId, input.workspaceId),
      input.clientId ? eq(safetyPolicies.clientId, input.clientId) : isNull(safetyPolicies.clientId),
      input.campaignId ? eq(safetyPolicies.campaignId, input.campaignId) : isNull(safetyPolicies.campaignId),
    ))
    if (maximumDailyBudgetMicros || maximumMonthlySpendMicros || input.maximumVariationPercent !== '') {
      await transaction.insert(safetyPolicies).values({
        workspaceId: input.workspaceId,
        clientId: input.clientId,
        campaignId: input.campaignId,
        currencyCode: input.currencyCode,
        maximumDailyBudgetMicros,
        maximumMonthlySpendMicros,
        maximumVariationPercent: input.maximumVariationPercent === '' ? null : String(input.maximumVariationPercent),
      })
    }
    await transaction.insert(auditEvents).values({
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      action: 'workspace.safety_policy_updated',
      entityType: 'safety_policy',
      entityId: input.campaignId ?? input.clientId ?? input.workspaceId,
      metadata: {
        scope: input.scope,
        clientId: input.clientId,
        campaignId: input.campaignId,
        currencyCode: input.currencyCode,
        maximumDailyBudget: input.maximumDailyBudget || null,
        maximumMonthlySpend: input.maximumMonthlySpend || null,
        maximumVariationPercent: input.maximumVariationPercent || null,
      },
    })
  })
}
