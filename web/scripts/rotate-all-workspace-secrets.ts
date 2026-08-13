import { notInArray } from 'drizzle-orm'
import {
  googleAdsConnections,
  memberNotificationPreferences,
  notificationChannels,
  notificationOAuthSessions,
  reportSchedules,
  secretRevelations,
  workspaces,
} from '../src/db/schema'
import { withSystemTransaction } from '../src/db/transactions'
import { currentEncryptionKeyId, secretEnvelopeKeyId } from '../src/lib/crypto'
import { rotateWorkspaceSecrets } from '../src/lib/secret-rotation'

type EncryptedRow = { workspaceId: string; encryptedValue: string }

async function main() {
  const currentKid = currentEncryptionKeyId()
  if (!currentKid) throw new Error('APP_ENCRYPTION_CURRENT_KID is required')

  const workspaceRows = await withSystemTransaction((db) => db
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(notInArray(workspaces.accessState, ['deleted', 'deletion_pending'])))

  let rotated = 0
  for (const workspace of workspaceRows) {
    const result = await rotateWorkspaceSecrets(workspace.id)
    rotated += result.rotated
  }

  const encryptedRows = await withSystemTransaction(async (db) => {
    const groups: EncryptedRow[][] = await Promise.all([
      db.select({ workspaceId: googleAdsConnections.workspaceId, encryptedValue: googleAdsConnections.encryptedRefreshToken }).from(googleAdsConnections),
      db.select({ workspaceId: memberNotificationPreferences.workspaceId, encryptedValue: memberNotificationPreferences.encryptedEmail }).from(memberNotificationPreferences),
      db.select({ workspaceId: notificationChannels.workspaceId, encryptedValue: notificationChannels.encryptedDestination }).from(notificationChannels),
      db.select({ workspaceId: notificationOAuthSessions.workspaceId, encryptedValue: notificationOAuthSessions.encryptedRefreshToken }).from(notificationOAuthSessions),
      db.select({ workspaceId: reportSchedules.workspaceId, encryptedValue: reportSchedules.encryptedReportToken }).from(reportSchedules),
      db.select({ workspaceId: secretRevelations.workspaceId, encryptedValue: secretRevelations.encryptedSecret }).from(secretRevelations),
    ])
    return groups.flat()
  })

  const pending = encryptedRows.filter((row) => secretEnvelopeKeyId(row.encryptedValue) !== currentKid)
  if (pending.length > 0) {
    const workspaceIds = Array.from(new Set(pending.map((row) => row.workspaceId)))
    throw new Error(`${pending.length} secret envelope(s) still use an old key across ${workspaceIds.length} workspace(s)`)
  }

  process.stdout.write(`${JSON.stringify({ ok: true, currentKid, workspaces: workspaceRows.length, envelopes: encryptedRows.length, rotated })}\n`)
}

void main()
