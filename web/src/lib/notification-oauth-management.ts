import 'server-only'

import { and, count, eq, sql } from 'drizzle-orm'
import { auditEvents, notificationChannels, notificationOAuthSessions } from '@/db/schema'
import type { DatabaseTransaction } from '@/db/transactions'
import { decryptSecret, encryptSecret } from '@/lib/crypto'
import {
  requireQuota,
  type EntitlementContext,
} from '@/lib/entitlements'
import { refreshTeamsAccessToken, serializeTeamsDestination } from '@/lib/teams-oauth'
import { withWorkspaceActorTransaction } from '@/lib/workspace-actor-guard'

type OAuthActorContext = { workspaceId: string; actorUserId: string }

function withTeamsActor<T>(input: OAuthActorContext, operation: Parameters<typeof withWorkspaceActorTransaction<T>>[1]) {
  return withWorkspaceActorTransaction({ workspaceId: input.workspaceId, actorUserId: input.actorUserId, permission: 'workspace:admin', capability: 'notifications.webhook' }, operation)
}

async function assertSessionWindow(db: DatabaseTransaction, expiresAt: Date) {
  if (!Number.isFinite(expiresAt.getTime())) throw new Error('La session OAuth Teams a expiré. Relancez la connexion.')
  const { rows: [clock] } = await db.execute<{ valid: boolean }>(sql`select ${expiresAt.toISOString()}::timestamptz > clock_timestamp() as valid`)
  if (!clock?.valid) throw new Error('La session OAuth Teams a expiré. Relancez la connexion.')
}

// Encrypted like other session contents so ordinary key rotation still applies.
const pendingAuthorization = 'yodev:teams:authorization-pending'

export function beginTeamsOAuthSession(input: OAuthActorContext) {
  return withTeamsActor(input, async (db) => {
    await db.delete(notificationOAuthSessions).where(and(
      eq(notificationOAuthSessions.workspaceId, input.workspaceId),
      eq(notificationOAuthSessions.userId, input.actorUserId),
      eq(notificationOAuthSessions.provider, 'teams'),
    ))
    const [session] = await db.insert(notificationOAuthSessions).values({
      workspaceId: input.workspaceId, userId: input.actorUserId, provider: 'teams',
      encryptedRefreshToken: encryptSecret(pendingAuthorization), scopes: [],
      expiresAt: sql`clock_timestamp() + interval '10 minutes'`,
    }).returning({ id: notificationOAuthSessions.id, expiresAt: notificationOAuthSessions.expiresAt })
    if (!session) throw new Error('La session OAuth Teams n’a pas pu être créée.')
    await assertSessionWindow(db, session.expiresAt)
    return session
  })
}

export function createTeamsOAuthSession(input: OAuthActorContext & {
  authorizationId: string
  refreshToken: string
  scopes: string[]
  authorizationExpiresAt: Date
}) {
  return withTeamsActor(input, async (db) => {
    await assertSessionWindow(db, input.authorizationExpiresAt)
    const pending = await teamsSession(db, { ...input, sessionId: input.authorizationId }, true)
    const [session] = await db.update(notificationOAuthSessions).set({
      encryptedRefreshToken: encryptSecret(input.refreshToken), scopes: input.scopes,
      expiresAt: sql`clock_timestamp() + interval '15 minutes'`, updatedAt: new Date(),
    }).where(and(eq(notificationOAuthSessions.id, pending.id), eq(notificationOAuthSessions.workspaceId, input.workspaceId)))
      .returning({ id: notificationOAuthSessions.id, expiresAt: notificationOAuthSessions.expiresAt })
    if (!session) throw new Error('La session OAuth Teams n’a pas pu être créée.')
    await db.insert(auditEvents).values({
      workspaceId: input.workspaceId, actorUserId: input.actorUserId,
      action: 'notification_channel.teams_oauth_authorized', entityType: 'notification_oauth_session', entityId: session.id,
      metadata: { scopes: input.scopes },
    })
    await assertSessionWindow(db, pending.expiresAt)
    await assertSessionWindow(db, input.authorizationExpiresAt)
    return session
  })
}

async function teamsSession(db: DatabaseTransaction, input: OAuthActorContext & { sessionId: string }, pending = false) {
  const [session] = await db.select().from(notificationOAuthSessions).where(and(
    eq(notificationOAuthSessions.id, input.sessionId),
    eq(notificationOAuthSessions.workspaceId, input.workspaceId),
    eq(notificationOAuthSessions.userId, input.actorUserId),
    eq(notificationOAuthSessions.provider, 'teams'),
  )).limit(1).for('update')
  if (!session) throw new Error('La session OAuth Teams a expiré. Relancez la connexion.')
  await assertSessionWindow(db, session.expiresAt)
  if ((decryptSecret(session.encryptedRefreshToken) === pendingAuthorization) !== pending) throw new Error('La session OAuth Teams a changé. Relancez la connexion.')
  return session
}

export async function accessTeamsOAuthSession(input: OAuthActorContext & { sessionId: string }) {
  const session = await withTeamsActor(input, (db) => teamsSession(db, input))
  const previousRefreshToken = decryptSecret(session.encryptedRefreshToken)
  // No database lock is held across the provider request. Reauthorize and compare
  // the current encrypted credential before returning any refreshed access token.
  const tokens = await refreshTeamsAccessToken(previousRefreshToken)
  return withTeamsActor(input, async (db) => {
    const current = await teamsSession(db, input)
    if (current.encryptedRefreshToken !== session.encryptedRefreshToken) throw new Error('La session OAuth Teams a été utilisée simultanément. Rechargez la page.')
    if (tokens.refreshToken !== previousRefreshToken) {
      await db.update(notificationOAuthSessions).set({
        encryptedRefreshToken: encryptSecret(tokens.refreshToken),
        scopes: tokens.scopes,
        updatedAt: new Date(),
      }).where(and(eq(notificationOAuthSessions.id, current.id), eq(notificationOAuthSessions.workspaceId, input.workspaceId)))
    }
    await assertSessionWindow(db, current.expiresAt)
    return { accessToken: tokens.accessToken, expiresAt: current.expiresAt }
  })
}

export function completeTeamsOAuthSession(input: OAuthActorContext & {
  sessionId: string
  teamId: string
  teamName: string
  channelId: string
  channelName: string
  entitlements: EntitlementContext
}) {
  return withTeamsActor(input, async (db, { entitlements }) => {
    await db.execute(sql`select pg_advisory_xact_lock(hashtext(${`${input.workspaceId}:notificationChannels`}))`)
    const session = await teamsSession(db, input)
    const [usage] = await db.select({ count: count() }).from(notificationChannels).where(and(
      eq(notificationChannels.workspaceId, input.workspaceId),
      eq(notificationChannels.enabled, true),
    ))
    requireQuota(entitlements, 'notificationChannels', usage.count)
    const destination = serializeTeamsDestination({
      v: 1,
      provider: 'teams_graph',
      teamId: input.teamId,
      teamName: input.teamName,
      channelId: input.channelId,
      channelName: input.channelName,
      refreshToken: decryptSecret(session.encryptedRefreshToken),
    })
    const [channel] = await db.insert(notificationChannels).values({
      workspaceId: input.workspaceId,
      createdBy: input.actorUserId,
      kind: 'teams',
      label: `Teams · ${input.teamName} · ${input.channelName}`.slice(0, 120),
      encryptedDestination: encryptSecret(destination),
      destinationHint: `${input.teamName}/${input.channelName}`.slice(0, 120),
      minimumSeverity: 'warning',
    }).returning({ id: notificationChannels.id })
    if (!channel) throw new Error('La création du canal Teams a échoué.')
    await db.delete(notificationOAuthSessions).where(and(
      eq(notificationOAuthSessions.id, session.id),
      eq(notificationOAuthSessions.workspaceId, input.workspaceId),
    ))
    await db.insert(auditEvents).values({
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      action: 'notification_channel.created',
      entityType: 'notification_channel',
      entityId: channel.id,
      metadata: { kind: 'teams', provider: 'microsoft_graph', teamId: input.teamId, channelId: input.channelId },
    })
    await assertSessionWindow(db, session.expiresAt)
    return channel
  })
}
