import 'server-only'

import { and, eq, inArray, isNull, lte, or, sql } from 'drizzle-orm'
import { notificationChannels, notificationDeliveries, performanceSnapshots, workspaces } from '@/db/schema'
import { withSystemTransaction } from '@/db/transactions'
import { decryptSecret, encryptSecret } from '@/lib/crypto'
import { featureEnabled } from '@/lib/feature-flags'
import { enqueueJob, jobRetryDelay } from '@/lib/jobs'
import { postSafeWebhook } from '@/lib/webhook-security'
import { entitlementContext, isPlan, isWorkspaceAccessState } from '@/lib/entitlements'
import { sendTransactionalEmail } from '@/lib/transactional-email'
import {
  parseTeamsDestination,
  postTeamsChannelMessage,
  refreshTeamsAccessToken,
  serializeTeamsDestination,
} from '@/lib/teams-oauth'

export type NotificationPayload = {
  workspaceId: string
  incidentId?: string
  eventKey: string
  severity: 'warning' | 'critical'
  title: string
  description: string
  clientName: string
  eventType?: 'alert' | 'digest'
  locale?: 'fr' | 'en'
}

const severityRank = { warning: 1, critical: 2 } as const
const MAXIMUM_DELIVERY_ATTEMPTS = 5

type NotificationChannel = typeof notificationChannels.$inferSelect

export function channelsAllowedByWorkspace(
  workspace: { accessState: string; plan: string } | null | undefined,
  channels: NotificationChannel[],
) {
  if (!workspace || !isWorkspaceAccessState(workspace.accessState) || !isPlan(workspace.plan)) return []
  const entitlements = entitlementContext(workspace.accessState, workspace.plan)
  if (!entitlements.capabilities.has('monitoring')) return []
  const canUseWebhooks = entitlements.capabilities.has('notifications.webhook')
  const eligible = channels
    .filter((channel) => channel.kind === 'email' || canUseWebhooks)
    .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime() || left.id.localeCompare(right.id))
  const limit = entitlements.limits.notificationChannels
  return limit === null ? eligible : eligible.slice(0, limit)
}

function notificationCopy(payload: NotificationPayload) {
  if (payload.locale === 'en') {
    return {
      account: 'Account',
      alert: 'Alert',
      critical: 'Critical incident',
      criticalSubject: 'Critical',
      digest: 'Weekly digest',
      footer: 'Automatic, traceable notification sent by Ads by Yodev.',
    }
  }
  return {
    account: 'Compte',
    alert: 'Alerte',
    critical: 'Incident critique',
    criticalSubject: 'Critique',
    digest: 'Synthèse hebdomadaire',
    footer: 'Notification automatique et traçable envoyée par Ads by Yodev.',
  }
}

function notificationKind(payload: NotificationPayload) {
  const copy = notificationCopy(payload)
  return payload.eventType === 'digest' ? copy.digest : payload.severity === 'critical' ? copy.critical : copy.alert
}

export function webhookBody(payload: NotificationPayload) {
  return {
    text: `Ads by Yodev · ${notificationKind(payload)} · ${payload.clientName}`,
    title: payload.title,
    description: payload.description,
    severity: payload.severity,
    eventKey: payload.eventKey,
  }
}

export function alertEmailHtml(payload: NotificationPayload) {
  const copy = notificationCopy(payload)
  const escaped = [payload.clientName, payload.title, payload.description].map((value) =>
    value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[character]!),
  )
  return `<div style="font-family:Arial,sans-serif;max-width:620px;margin:auto;padding:32px;color:#12202b"><p style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#19A58F">Ads by Yodev · ${notificationKind(payload)}</p><h1 style="font-size:24px">${escaped[1]}</h1><p style="color:#52626f">${copy.account}: <strong>${escaped[0]}</strong></p><p style="line-height:1.65">${escaped[2]}</p><p style="margin-top:32px;font-size:12px;color:#80909b">${copy.footer}</p></div>`
}

export function teamsMessageHtml(payload: NotificationPayload) {
  const copy = notificationCopy(payload)
  const escaped = [notificationKind(payload), payload.clientName, payload.title, payload.description].map((value) =>
    value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[character]!),
  )
  return `<h2>Ads by Yodev · ${escaped[0]}</h2><p><strong>${escaped[2]}</strong></p><p>${copy.account}: <strong>${escaped[1]}</strong></p><p>${escaped[3]}</p>`
}

async function deliverChannel(
  channel: typeof notificationChannels.$inferSelect,
  payload: NotificationPayload,
): Promise<string | undefined> {
  const destination = decryptSecret(channel.encryptedDestination)
  if (channel.kind === 'email') {
    const copy = notificationCopy(payload)
    const result = await sendTransactionalEmail({
      from: process.env.NOTIFICATION_FROM_EMAIL ?? 'Ads by Yodev <ads@yodev.fr>',
      to: destination,
      subject: payload.eventType === 'digest' ? payload.title : `[${payload.severity === 'critical' ? copy.criticalSubject : copy.alert}] ${payload.title}`,
      html: alertEmailHtml(payload),
      idempotencyKey: payload.eventKey,
      tag: payload.eventType === 'digest' ? 'weekly_digest' : `alert_${payload.severity}`,
      resendIdempotency: false,
    })
    return result.providerMessageId ?? undefined
  }
  if (channel.kind === 'teams') {
    const managed = parseTeamsDestination(destination)
    if (managed.success) {
      const tokens = await refreshTeamsAccessToken(managed.data.refreshToken)
      if (tokens.refreshToken !== managed.data.refreshToken) {
        const encryptedDestination = encryptSecret(serializeTeamsDestination({
          ...managed.data,
          refreshToken: tokens.refreshToken,
        }))
        const [rotated] = await withSystemTransaction((db) => db.update(notificationChannels).set({
          encryptedDestination,
          updatedAt: new Date(),
        }).where(and(
          eq(notificationChannels.id, channel.id),
          eq(notificationChannels.encryptedDestination, channel.encryptedDestination),
        )).returning({ id: notificationChannels.id }))
        if (!rotated) throw new Error('Le jeton Microsoft Teams a été renouvelé simultanément ; la livraison sera retentée.')
      }
      return postTeamsChannelMessage({
        accessToken: tokens.accessToken,
        teamId: managed.data.teamId,
        channelId: managed.data.channelId,
        html: teamsMessageHtml(payload),
      })
    }
  }
  await postSafeWebhook(destination, webhookBody(payload))
}

export async function retryNotificationDelivery(deliveryId: string) {
  const claimResult = await withSystemTransaction(async (db) => {
    const [claimed] = await db
      .update(notificationDeliveries)
      .set({
        status: 'sending',
        attemptCount: sql`${notificationDeliveries.attemptCount} + 1`,
        nextAttemptAt: null,
      })
      .where(
        and(
          eq(notificationDeliveries.id, deliveryId),
          inArray(notificationDeliveries.status, ['queued', 'retrying']),
          or(isNull(notificationDeliveries.nextAttemptAt), lte(notificationDeliveries.nextAttemptAt, new Date())),
        ),
      )
      .returning()
    if (!claimed) {
      const existing = await db.query.notificationDeliveries.findFirst({
        where: eq(notificationDeliveries.id, deliveryId),
        columns: { status: true },
      })
      return { claimed: null, channel: null, existingStatus: existing?.status }
    }
    const workspace = await db.query.workspaces.findFirst({
      where: eq(workspaces.id, claimed.workspaceId),
      columns: { accessState: true, plan: true },
    })
    const channels = await db.query.notificationChannels.findMany({
      where: and(eq(notificationChannels.workspaceId, claimed.workspaceId), eq(notificationChannels.enabled, true)),
    })
    const channel = channelsAllowedByWorkspace(workspace, channels).find((candidate) => candidate.id === claimed.channelId)
    return { claimed, channel: channel ?? null, existingStatus: undefined }
  })
  const { claimed, channel } = claimResult
  if (!claimed) {
    if (claimResult.existingStatus === 'delivered') return 'delivered' as const
    if (claimResult.existingStatus === 'dead_letter') return 'dead_letter' as const
    return 'not_available' as const
  }
  if (!channel) {
    await withSystemTransaction((db) => db
      .update(notificationDeliveries)
      .set({ status: 'dead_letter', terminalAt: new Date(), errorMessage: 'Notification channel missing or disabled' })
      .where(eq(notificationDeliveries.id, deliveryId)))
    return 'dead_letter' as const
  }
  const payload = claimed.payload as NotificationPayload
  try {
    const providerMessageId = await deliverChannel(channel, payload)
    const now = new Date()
    await withSystemTransaction(async (db) => {
      await db
        .update(notificationDeliveries)
        .set({ status: 'delivered', providerMessageId, errorMessage: null, terminalAt: now })
        .where(eq(notificationDeliveries.id, deliveryId))
      await db
        .update(notificationChannels)
        .set({ lastDeliveredAt: now, lastError: null, updatedAt: now })
        .where(eq(notificationChannels.id, channel.id))
    })
    return 'delivered' as const
  } catch (error) {
    const now = new Date()
    const errorMessage = error instanceof Error ? error.message : 'Erreur de notification'
    const terminal = claimed.attemptCount >= MAXIMUM_DELIVERY_ATTEMPTS
    await withSystemTransaction(async (db) => {
      await db
        .update(notificationDeliveries)
        .set({
          status: terminal ? 'dead_letter' : 'retrying',
          errorMessage: errorMessage.slice(0, 2000),
          nextAttemptAt: terminal ? null : new Date(now.getTime() + jobRetryDelay(claimed.attemptCount)),
          terminalAt: terminal ? now : null,
        })
        .where(eq(notificationDeliveries.id, deliveryId))
      await db
        .update(notificationChannels)
        .set({ lastError: errorMessage.slice(0, 1000), updatedAt: now })
        .where(eq(notificationChannels.id, channel.id))
    })
    return terminal ? 'dead_letter' as const : 'retrying' as const
  }
}

export async function dispatchIncidentNotifications(payload: NotificationPayload) {
  if (!featureEnabled('notifications')) return { delivered: 0, failed: 0, skipped: true }
  const channels = await withSystemTransaction(async (db) => {
    const workspace = await db.query.workspaces.findFirst({
      where: eq(workspaces.id, payload.workspaceId),
      columns: { accessState: true, plan: true },
    })
    const candidates = await db.query.notificationChannels.findMany({
      where: and(eq(notificationChannels.workspaceId, payload.workspaceId), eq(notificationChannels.enabled, true)),
    })
    return channelsAllowedByWorkspace(workspace, candidates)
  })
  let delivered = 0
  let failed = 0
  for (const channel of channels) {
    if (severityRank[payload.severity] < severityRank[channel.minimumSeverity as keyof typeof severityRank]) continue
    const [claim] = await withSystemTransaction((db) => db
      .insert(notificationDeliveries)
      .values({
        workspaceId: payload.workspaceId,
        channelId: channel.id,
        incidentId: payload.incidentId,
        eventKey: payload.eventKey,
        payload: { ...payload },
        status: 'queued',
      })
      .onConflictDoNothing()
      .returning({ id: notificationDeliveries.id }))
    if (!claim) continue
    const result = await retryNotificationDelivery(claim.id)
    if (result === 'delivered') {
      delivered += 1
    } else {
      if (result === 'retrying') {
        const delivery = await withSystemTransaction((db) => db.query.notificationDeliveries.findFirst({
          where: eq(notificationDeliveries.id, claim.id),
          columns: { nextAttemptAt: true },
        }))
        await enqueueJob({
          workspaceId: payload.workspaceId,
          type: 'notification.deliver',
          payload: { deliveryId: claim.id },
          availableAt: delivery?.nextAttemptAt ?? new Date(Date.now() + jobRetryDelay(1)),
          priority: payload.severity === 'critical' ? 20 : 70,
          deduplicationKey: `notification.deliver:${claim.id}`,
          maximumAttempts: 4,
        })
      }
      failed += 1
    }
  }
  return { delivered, failed }
}

export async function dispatchWeeklyDigest(workspaceId: string, date = new Date()) {
  const snapshotDate = date.toISOString().slice(0, 10)
  const { workspace, snapshots } = await withSystemTransaction(async (db) => ({
    workspace: await db.query.workspaces.findFirst({ where: eq(workspaces.id, workspaceId) }),
    snapshots: await db.query.performanceSnapshots.findMany({
      where: and(
        eq(performanceSnapshots.workspaceId, workspaceId),
        eq(performanceSnapshots.snapshotDate, snapshotDate),
      ),
    }),
  }))
  if (!workspace || snapshots.length === 0) return { delivered: 0, failed: 0, skipped: true }
  const totals = snapshots.reduce(
    (sum, snapshot) => ({
      costMicros: sum.costMicros + Number(snapshot.costMicros),
      clicks: sum.clicks + Number(snapshot.clicks),
      conversions: sum.conversions + Number(snapshot.conversions),
    }),
    { costMicros: 0, clicks: 0, conversions: 0 },
  )
  const locale = workspace.locale === 'en' ? 'en' : 'fr'
  const numberLocale = locale === 'en' ? 'en-GB' : 'fr-FR'
  const accountCount = snapshots.length.toLocaleString(numberLocale)
  const result = await dispatchIncidentNotifications({
    workspaceId,
    eventKey: `weekly-digest:${workspaceId}:${snapshotDate}`,
    eventType: 'digest',
    severity: 'warning',
    locale,
    title: locale === 'en' ? `Weekly digest ${workspace.brandName}` : `Synthèse hebdomadaire ${workspace.brandName}`,
    clientName: locale === 'en' ? `${accountCount} account(s)` : `${accountCount} compte(s)`,
    description: locale === 'en'
      ? `30-day window: €${(totals.costMicros / 1_000_000).toLocaleString(numberLocale, { maximumFractionDigits: 2 })} spent, ${totals.clicks.toLocaleString(numberLocale)} clicks and ${totals.conversions.toLocaleString(numberLocale, { maximumFractionDigits: 1 })} conversions.`
      : `Fenêtre 30 jours : ${(totals.costMicros / 1_000_000).toLocaleString(numberLocale, { maximumFractionDigits: 2 })} € investis, ${totals.clicks.toLocaleString(numberLocale)} clics et ${totals.conversions.toLocaleString(numberLocale, { maximumFractionDigits: 1 })} conversions.`,
  })
  return { ...result, skipped: false }
}
