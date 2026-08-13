import 'server-only'

import { and, eq } from 'drizzle-orm'
import {
  auditEvents,
  googleAdsConnections,
  memberNotificationPreferences,
  notificationChannels,
  notificationOAuthSessions,
  reportSchedules,
  secretRevelations,
  workspaces,
} from '@/db/schema'
import { withSystemTransaction } from '@/db/transactions'
import { currentEncryptionKeyId, rewrapSecret, secretEnvelopeKeyId } from '@/lib/crypto'

type RotationCandidate = { id: string; encryptedValue: string }

function candidates<T extends { id: string }>(
  rows: T[],
  encryptedValue: (row: T) => string,
  currentKid: string,
): RotationCandidate[] {
  return rows
    .map((row) => ({ id: row.id, encryptedValue: encryptedValue(row) }))
    .filter((row) => secretEnvelopeKeyId(row.encryptedValue) !== currentKid)
}

export async function rotateWorkspaceSecrets(workspaceId: string) {
  const currentKid = currentEncryptionKeyId()
  if (!currentKid) throw new Error('APP_ENCRYPTION_CURRENT_KID is required for secret rotation')

  return withSystemTransaction(async (db) => {
    const workspace = await db.query.workspaces.findFirst({
      where: eq(workspaces.id, workspaceId),
      columns: { id: true },
    })
    if (!workspace) return { workspaceId, currentKid, rotated: 0, skipped: true }

    const connections = await db.query.googleAdsConnections.findMany({ where: eq(googleAdsConnections.workspaceId, workspaceId) })
    const preferences = await db.query.memberNotificationPreferences.findMany({ where: eq(memberNotificationPreferences.workspaceId, workspaceId) })
    const revelations = await db.query.secretRevelations.findMany({ where: eq(secretRevelations.workspaceId, workspaceId) })
    const channels = await db.query.notificationChannels.findMany({ where: eq(notificationChannels.workspaceId, workspaceId) })
    const oauthSessions = await db.query.notificationOAuthSessions.findMany({ where: eq(notificationOAuthSessions.workspaceId, workspaceId) })
    const schedules = await db.query.reportSchedules.findMany({ where: eq(reportSchedules.workspaceId, workspaceId) })

    const pending = {
      googleAdsConnections: candidates(connections, (row) => row.encryptedRefreshToken, currentKid),
      memberNotificationPreferences: candidates(preferences, (row) => row.encryptedEmail, currentKid),
      secretRevelations: candidates(revelations, (row) => row.encryptedSecret, currentKid),
      notificationChannels: candidates(channels, (row) => row.encryptedDestination, currentKid),
      notificationOAuthSessions: candidates(oauthSessions, (row) => row.encryptedRefreshToken, currentKid),
      reportSchedules: candidates(schedules, (row) => row.encryptedReportToken, currentKid),
    }

    const counts = {
      googleAdsConnections: 0,
      memberNotificationPreferences: 0,
      secretRevelations: 0,
      notificationChannels: 0,
      notificationOAuthSessions: 0,
      reportSchedules: 0,
    }

    for (const row of pending.googleAdsConnections) {
      const updated = await db.update(googleAdsConnections)
        .set({ encryptedRefreshToken: rewrapSecret(row.encryptedValue), updatedAt: new Date() })
        .where(and(eq(googleAdsConnections.id, row.id), eq(googleAdsConnections.workspaceId, workspaceId), eq(googleAdsConnections.encryptedRefreshToken, row.encryptedValue)))
        .returning({ id: googleAdsConnections.id })
      counts.googleAdsConnections += updated.length
    }
    for (const row of pending.memberNotificationPreferences) {
      const updated = await db.update(memberNotificationPreferences)
        .set({ encryptedEmail: rewrapSecret(row.encryptedValue), updatedAt: new Date() })
        .where(and(eq(memberNotificationPreferences.id, row.id), eq(memberNotificationPreferences.workspaceId, workspaceId), eq(memberNotificationPreferences.encryptedEmail, row.encryptedValue)))
        .returning({ id: memberNotificationPreferences.id })
      counts.memberNotificationPreferences += updated.length
    }
    for (const row of pending.secretRevelations) {
      const updated = await db.update(secretRevelations)
        .set({ encryptedSecret: rewrapSecret(row.encryptedValue) })
        .where(and(eq(secretRevelations.id, row.id), eq(secretRevelations.workspaceId, workspaceId), eq(secretRevelations.encryptedSecret, row.encryptedValue)))
        .returning({ id: secretRevelations.id })
      counts.secretRevelations += updated.length
    }
    for (const row of pending.notificationChannels) {
      const updated = await db.update(notificationChannels)
        .set({ encryptedDestination: rewrapSecret(row.encryptedValue), updatedAt: new Date() })
        .where(and(eq(notificationChannels.id, row.id), eq(notificationChannels.workspaceId, workspaceId), eq(notificationChannels.encryptedDestination, row.encryptedValue)))
        .returning({ id: notificationChannels.id })
      counts.notificationChannels += updated.length
    }
    for (const row of pending.notificationOAuthSessions) {
      const updated = await db.update(notificationOAuthSessions)
        .set({ encryptedRefreshToken: rewrapSecret(row.encryptedValue), updatedAt: new Date() })
        .where(and(eq(notificationOAuthSessions.id, row.id), eq(notificationOAuthSessions.workspaceId, workspaceId), eq(notificationOAuthSessions.encryptedRefreshToken, row.encryptedValue)))
        .returning({ id: notificationOAuthSessions.id })
      counts.notificationOAuthSessions += updated.length
    }
    for (const row of pending.reportSchedules) {
      const updated = await db.update(reportSchedules)
        .set({ encryptedReportToken: rewrapSecret(row.encryptedValue), updatedAt: new Date() })
        .where(and(eq(reportSchedules.id, row.id), eq(reportSchedules.workspaceId, workspaceId), eq(reportSchedules.encryptedReportToken, row.encryptedValue)))
        .returning({ id: reportSchedules.id })
      counts.reportSchedules += updated.length
    }

    const rotated = Object.values(counts).reduce((sum, count) => sum + count, 0)
    if (rotated > 0) {
      await db.insert(auditEvents).values({
        workspaceId,
        actorUserId: 'system:secret-rotation',
        action: 'workspace.secrets_rotated',
        entityType: 'workspace',
        entityId: workspaceId,
        metadata: { currentKid, counts, rotated },
      })
    }
    return { workspaceId, currentKid, counts, rotated, skipped: false }
  })
}
