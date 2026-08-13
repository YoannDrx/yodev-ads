import 'server-only'

import { and, count, eq, gt, sql } from 'drizzle-orm'
import { auditEvents, notificationChannels, notificationOAuthSessions } from '@/db/schema'
import { withTenantTransaction } from '@/db/transactions'
import { decryptSecret, encryptSecret } from '@/lib/crypto'
import {
  requireQuota,
  type EntitlementContext,
} from '@/lib/entitlements'
import { refreshTeamsAccessToken, serializeTeamsDestination } from '@/lib/teams-oauth'
import { lockWorkspaceEntitlements } from '@/lib/workspace-transaction-guard'

type OAuthActorContext = { workspaceId: string; actorUserId: string }

export function createTeamsOAuthSession(input: OAuthActorContext & {
  refreshToken: string
  scopes: string[]
  now?: Date
}) {
  const now = input.now ?? new Date()
  const expiresAt = new Date(now.getTime() + 15 * 60_000)
  return withTenantTransaction({ workspaceId: input.workspaceId, userId: input.actorUserId }, async (db) => {
    await lockWorkspaceEntitlements(db, input.workspaceId, 'notifications.webhook')
    await db.execute(sql`select pg_advisory_xact_lock(hashtext(${`${input.workspaceId}:${input.actorUserId}:teams-oauth`}))`)
    await db.delete(notificationOAuthSessions).where(and(
      eq(notificationOAuthSessions.workspaceId, input.workspaceId),
      eq(notificationOAuthSessions.userId, input.actorUserId),
      eq(notificationOAuthSessions.provider, 'teams'),
    ))
    const [session] = await db.insert(notificationOAuthSessions).values({
      workspaceId: input.workspaceId,
      userId: input.actorUserId,
      provider: 'teams',
      encryptedRefreshToken: encryptSecret(input.refreshToken),
      scopes: input.scopes,
      expiresAt,
    }).returning({ id: notificationOAuthSessions.id, expiresAt: notificationOAuthSessions.expiresAt })
    if (!session) throw new Error('La session OAuth Teams n’a pas pu être créée.')
    await db.insert(auditEvents).values({
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      action: 'notification_channel.teams_oauth_authorized',
      entityType: 'notification_oauth_session',
      entityId: session.id,
      metadata: { scopes: input.scopes },
    })
    return session
  })
}

async function teamsSession(input: OAuthActorContext & { sessionId: string; now?: Date }) {
  const now = input.now ?? new Date()
  const session = await withTenantTransaction({ workspaceId: input.workspaceId, userId: input.actorUserId }, (db) => db
    .query.notificationOAuthSessions.findFirst({
      where: and(
        eq(notificationOAuthSessions.id, input.sessionId),
        eq(notificationOAuthSessions.workspaceId, input.workspaceId),
        eq(notificationOAuthSessions.userId, input.actorUserId),
        eq(notificationOAuthSessions.provider, 'teams'),
        gt(notificationOAuthSessions.expiresAt, now),
      ),
    }))
  if (!session) throw new Error('La session OAuth Teams a expiré. Relancez la connexion.')
  return session
}

export async function accessTeamsOAuthSession(input: OAuthActorContext & { sessionId: string; now?: Date }) {
  const session = await teamsSession(input)
  const previousRefreshToken = decryptSecret(session.encryptedRefreshToken)
  const tokens = await refreshTeamsAccessToken(previousRefreshToken)
  if (tokens.refreshToken !== previousRefreshToken) {
    const encryptedRefreshToken = encryptSecret(tokens.refreshToken)
    await withTenantTransaction({ workspaceId: input.workspaceId, userId: input.actorUserId }, async (db) => {
      const [rotated] = await db.update(notificationOAuthSessions).set({
        encryptedRefreshToken,
        scopes: tokens.scopes,
        updatedAt: new Date(),
      }).where(and(
        eq(notificationOAuthSessions.id, input.sessionId),
        eq(notificationOAuthSessions.workspaceId, input.workspaceId),
        eq(notificationOAuthSessions.userId, input.actorUserId),
        eq(notificationOAuthSessions.encryptedRefreshToken, session.encryptedRefreshToken),
      )).returning({ id: notificationOAuthSessions.id })
      if (!rotated) throw new Error('La session OAuth Teams a été utilisée simultanément. Rechargez la page.')
    })
  }
  return { accessToken: tokens.accessToken, expiresAt: session.expiresAt }
}

export function completeTeamsOAuthSession(input: OAuthActorContext & {
  sessionId: string
  teamId: string
  teamName: string
  channelId: string
  channelName: string
  entitlements: EntitlementContext
  now?: Date
}) {
  const now = input.now ?? new Date()
  return withTenantTransaction({ workspaceId: input.workspaceId, userId: input.actorUserId }, async (db) => {
    await lockWorkspaceEntitlements(db, input.workspaceId, 'notifications.webhook')
    await db.execute(sql`select pg_advisory_xact_lock(hashtext(${`${input.workspaceId}:notificationChannels`}))`)
    const session = await db.query.notificationOAuthSessions.findFirst({
      where: and(
        eq(notificationOAuthSessions.id, input.sessionId),
        eq(notificationOAuthSessions.workspaceId, input.workspaceId),
        eq(notificationOAuthSessions.userId, input.actorUserId),
        eq(notificationOAuthSessions.provider, 'teams'),
        gt(notificationOAuthSessions.expiresAt, now),
      ),
    })
    if (!session) throw new Error('La session OAuth Teams a expiré. Relancez la connexion.')
    const [usage] = await db.select({ count: count() }).from(notificationChannels).where(and(
      eq(notificationChannels.workspaceId, input.workspaceId),
      eq(notificationChannels.enabled, true),
    ))
    requireQuota(input.entitlements, 'notificationChannels', usage.count)
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
    return channel
  })
}
