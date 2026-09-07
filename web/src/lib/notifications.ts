import 'server-only'

import { and, desc, eq, gt, inArray, isNull, lte, or, sql } from 'drizzle-orm'
import { alertIncidents, clients, jobs, monitoringAgents, notificationChannels, notificationDeliveries, workspaces } from '@/db/schema'
import { getPortfolioSnapshot } from '@/lib/portfolio-data'
import { portfolioDigestDescription } from '@/lib/portfolio-digest'
import { withSystemTransaction, type DatabaseTransaction } from '@/db/transactions'
import { decryptSecret, encryptSecret } from '@/lib/crypto'
import { featureEnabled } from '@/lib/feature-flags'
import { jobRetryDelay, NonRetryableJobError } from '@/lib/jobs'
import { postSafeWebhook } from '@/lib/webhook-security'
import { entitlementContext, isPlan, isWorkspaceAccessState } from '@/lib/entitlements'
import { sendTransactionalEmail } from '@/lib/transactional-email'
import { reminderDeliveryIsCurrent } from '@/lib/alert-reminder-plan'
import { MAXIMUM_NOTIFICATION_DELIVERY_ATTEMPTS, NOTIFICATION_DELIVERY_LEASE_MS, notificationDeliveryKey } from '@/lib/notification-delivery-model'
import { operationsAlertJob } from '@/lib/operations-alert-model'
import { runWithTransactionalEmailRetryGeneration } from '@/lib/transactional-email-context'
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
  reminderDueAt?: string
  reminderIntervalHours?: number
  deliveryKey?: string
}

const severityRank = { warning: 1, critical: 2 } as const
class NotificationLeaseLostError extends Error {}

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
  beforeSend: () => Promise<void>,
): Promise<string | undefined> {
  const destination = decryptSecret(channel.encryptedDestination)
  if (channel.kind === 'email') {
    const copy = notificationCopy(payload)
    await beforeSend()
    const result = await runWithTransactionalEmailRetryGeneration({}, () => sendTransactionalEmail({
      from: process.env.NOTIFICATION_FROM_EMAIL ?? 'Ads by Yodev <ads@yodev.fr>',
      to: destination,
      subject: payload.eventType === 'digest' ? payload.title : `[${payload.severity === 'critical' ? copy.criticalSubject : copy.alert}] ${payload.title}`,
      html: alertEmailHtml(payload),
      idempotencyKey: payload.deliveryKey ?? payload.eventKey,
      category: payload.eventType === 'digest' ? 'weekly_digest' : `alert_${payload.severity}`,
      workspaceId: channel.workspaceId,
      referenceId: payload.eventKey,
    }))
    if (!result.deliveries.length || result.deliveries.some((delivery) =>
      !delivery.providerMessageId || !['queued', 'sending', 'sent', 'accepted', 'delivered'].includes(delivery.status))) {
      throw new Error('YoDevMail has not accepted this notification for delivery')
    }
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
      await beforeSend()
      return postTeamsChannelMessage({
        accessToken: tokens.accessToken,
        teamId: managed.data.teamId,
        channelId: managed.data.channelId,
        html: teamsMessageHtml(payload),
      })
    }
  }
  await beforeSend()
  await postSafeWebhook(destination, webhookBody(payload))
}

export async function retryNotificationDelivery(deliveryId: string) {
  if (!featureEnabled('notifications')) return 'disabled' as const
  const claimResult = await withSystemTransaction(async (db) => {
    const [claimed] = await db
      .update(notificationDeliveries)
      .set({
        status: 'sending',
        attemptCount: sql`${notificationDeliveries.attemptCount} + 1`,
        nextAttemptAt: null,
        leaseExpiresAt: new Date(Date.now() + NOTIFICATION_DELIVERY_LEASE_MS),
        dispatchStartedAt: null,
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
    const payload = claimed.payload as NotificationPayload
    let cancellationReason: string | null = channel && severityRank[payload.severity] < severityRank[channel.minimumSeverity as keyof typeof severityRank]
      ? 'Notification no longer meets channel severity preference' : null
    if (channel && claimed.eventKey.startsWith('monitoring:')) {
      const [context] = await db.select({ incident: alertIncidents, agent: monitoringAgents, client: clients })
        .from(alertIncidents)
        .innerJoin(monitoringAgents, and(eq(monitoringAgents.id, alertIncidents.agentId), eq(monitoringAgents.workspaceId, alertIncidents.workspaceId)))
        .innerJoin(clients, and(eq(clients.id, alertIncidents.clientId), eq(clients.workspaceId, alertIncidents.workspaceId)))
        .where(and(claimed.incidentId ? eq(alertIncidents.id, claimed.incidentId) : sql`false`, eq(alertIncidents.workspaceId, claimed.workspaceId))).limit(1)
      if (!context || !context.agent.enabled || !context.client.active || context.client.isManager ||
        !['open', 'reopened'].includes(context.incident.status) || context.incident.severity !== payload.severity) {
        cancellationReason = 'Monitoring incident is no longer actionable'
      }
    }
    if (channel && (payload.reminderDueAt !== undefined || claimed.eventKey.startsWith('alert-reminder:'))) {
      const [context] = await db.select({ incident: alertIncidents, agent: monitoringAgents, client: clients })
        .from(alertIncidents)
        .innerJoin(monitoringAgents, and(eq(monitoringAgents.id, alertIncidents.agentId), eq(monitoringAgents.workspaceId, alertIncidents.workspaceId)))
        .innerJoin(clients, and(eq(clients.id, alertIncidents.clientId), eq(clients.workspaceId, alertIncidents.workspaceId)))
        .where(and(claimed.incidentId ? eq(alertIncidents.id, claimed.incidentId) : sql`false`, eq(alertIncidents.workspaceId, claimed.workspaceId))).limit(1)
      const accepted = await db.query.notificationDeliveries.findFirst({
        where: and(eq(notificationDeliveries.workspaceId, claimed.workspaceId), eq(notificationDeliveries.eventKey, claimed.eventKey),
          inArray(notificationDeliveries.status, ['accepted', 'delivered'])),
        columns: { terminalAt: true }, orderBy: [desc(notificationDeliveries.terminalAt)],
      })
      const prefix = `alert-reminder:${claimed.incidentId}:`
      const expectedDueAt = payload.reminderDueAt ?? (claimed.eventKey.startsWith(prefix) ? claimed.eventKey.slice(prefix.length) : '')
      if (!context || !context.agent.enabled || !context.client.active || context.client.isManager ||
        (payload.reminderIntervalHours !== undefined && payload.reminderIntervalHours !== context.agent.reminderIntervalHours) ||
        !reminderDeliveryIsCurrent({ incident: context.incident, intervalHours: context.agent.reminderIntervalHours,
          expectedDueAt, acceptedOccurrenceAt: accepted?.terminalAt })) cancellationReason = 'Reminder occurrence is no longer current'
    }
    if (cancellationReason) {
      await db.update(notificationDeliveries).set({ status: 'cancelled', leaseExpiresAt: null, terminalAt: new Date(), errorMessage: cancellationReason })
        .where(and(eq(notificationDeliveries.id, deliveryId), eq(notificationDeliveries.attemptCount, claimed.attemptCount), eq(notificationDeliveries.status, 'sending')))
      return { claimed: null, channel: null, existingStatus: 'cancelled' }
    }
    return { claimed, channel: channel ?? null, existingStatus: undefined }
  })
  const { claimed, channel } = claimResult
  if (!claimed) {
    if (claimResult.existingStatus === 'accepted') return 'accepted' as const
    if (claimResult.existingStatus === 'delivered') return 'delivered' as const
    if (claimResult.existingStatus === 'dead_letter') return 'dead_letter' as const
    if (claimResult.existingStatus === 'cancelled') return 'cancelled' as const
    if (claimResult.existingStatus === 'ambiguous') return 'ambiguous' as const
    return 'not_available' as const
  }
  if (!channel) {
    await withSystemTransaction((db) => db
      .update(notificationDeliveries)
      .set({ status: 'dead_letter', leaseExpiresAt: null, terminalAt: new Date(), errorMessage: 'Notification channel missing or disabled' })
      .where(and(eq(notificationDeliveries.id, deliveryId), eq(notificationDeliveries.attemptCount, claimed.attemptCount), eq(notificationDeliveries.status, 'sending'))))
    return 'dead_letter' as const
  }
  const payload = claimed.payload as NotificationPayload
  let dispatchStarted = false
  try {
    const providerMessageId = await deliverChannel(channel, payload, async () => {
      const now = new Date()
      const [marked] = await withSystemTransaction((db) => db.update(notificationDeliveries).set({ dispatchStartedAt: now })
        .where(and(eq(notificationDeliveries.id, deliveryId), eq(notificationDeliveries.attemptCount, claimed.attemptCount),
          eq(notificationDeliveries.status, 'sending'), gt(notificationDeliveries.leaseExpiresAt, now)))
        .returning({ id: notificationDeliveries.id }))
      if (!marked) throw new NotificationLeaseLostError()
      dispatchStarted = true
    })
    const now = new Date()
    await withSystemTransaction(async (db) => {
      const [recorded] = await db
        .update(notificationDeliveries)
        .set({ status: 'accepted', leaseExpiresAt: null, providerMessageId, errorMessage: null, terminalAt: now })
        .where(and(eq(notificationDeliveries.id, deliveryId), eq(notificationDeliveries.attemptCount, claimed.attemptCount),
          inArray(notificationDeliveries.status, ['sending', 'ambiguous'])))
        .returning({ id: notificationDeliveries.id })
      if (!recorded) throw new NotificationLeaseLostError()
      await db
        .update(notificationChannels)
        // This legacy timestamp records transport acceptance. Actual email
        // delivery/bounces are evidenced by transactional_email_deliveries.
        .set({ lastDeliveredAt: now, lastError: null, updatedAt: now })
        .where(eq(notificationChannels.id, channel.id))
      if (claimed.incidentId) await db.update(alertIncidents).set({
        lastNotifiedAt: sql`greatest(${alertIncidents.lastNotifiedAt}, ${now})`, updatedAt: now,
      }).where(and(eq(alertIncidents.id, claimed.incidentId), eq(alertIncidents.workspaceId, claimed.workspaceId)))
    })
    return 'accepted' as const
  } catch (error) {
    if (error instanceof NotificationLeaseLostError) return 'lease_lost' as const
    const now = new Date()
    const errorMessage = error instanceof Error ? error.message : 'Erreur de notification'
    const ambiguous = dispatchStarted && channel.kind !== 'email'
    const terminal = !ambiguous && (error instanceof NonRetryableJobError || claimed.attemptCount >= MAXIMUM_NOTIFICATION_DELIVERY_ATTEMPTS)
    const status = ambiguous ? 'ambiguous' : terminal ? 'dead_letter' : 'retrying'
    const failureStored = await withSystemTransaction(async (db) => {
      const [recorded] = await db
        .update(notificationDeliveries)
        .set({
          status,
          leaseExpiresAt: null,
          errorMessage: errorMessage.slice(0, 2000),
          nextAttemptAt: terminal || ambiguous ? null : new Date(now.getTime() + jobRetryDelay(claimed.attemptCount)),
          terminalAt: terminal ? now : null,
        })
        .where(and(eq(notificationDeliveries.id, deliveryId), eq(notificationDeliveries.attemptCount, claimed.attemptCount), eq(notificationDeliveries.status, 'sending')))
        .returning({ id: notificationDeliveries.id })
      if (!recorded) return false
      await db
        .update(notificationChannels)
        .set({ lastError: errorMessage.slice(0, 1000), updatedAt: now })
        .where(eq(notificationChannels.id, channel.id))
      if (ambiguous || terminal) await db.insert(jobs).values(operationsAlertJob({
        kind: 'notification_delivery_failed', sourceId: deliveryId, title: `Notification ${status}`,
        description: ambiguous ? 'Transport acceptance is unknown; reconcile before any resend.' : 'Notification delivery exhausted its retries or was rejected.',
      })).onConflictDoNothing({ target: jobs.deduplicationKey })
      return true
    })
    return failureStored ? status : 'lease_lost' as const
  }
}

async function insertNotificationDelivery(db: DatabaseTransaction, payload: NotificationPayload, channelId: string, delayMs: number) {
  const [created] = await db.insert(notificationDeliveries).values({
    workspaceId: payload.workspaceId, channelId, incidentId: payload.incidentId,
    eventKey: payload.eventKey, payload: { ...payload, deliveryKey: notificationDeliveryKey(payload.eventKey, channelId) }, status: 'queued',
  }).onConflictDoNothing().returning({ id: notificationDeliveries.id })
  if (!created) return null
  // The durable fallback exists before the immediate attempt can start.
  await db.insert(jobs).values({
    workspaceId: payload.workspaceId, type: 'notification.deliver', payload: { deliveryId: created.id },
    availableAt: new Date(Date.now() + delayMs), priority: payload.severity === 'critical' ? 20 : 70,
    deduplicationKey: `notification.deliver:${created.id}`, maximumAttempts: MAXIMUM_NOTIFICATION_DELIVERY_ATTEMPTS,
  }).onConflictDoNothing({ target: jobs.deduplicationKey })
  return created
}

/** Persist all eligible channels and their outbox jobs in the caller's transaction.
 * No provider call occurs here; workers independently honor the delivery switch. */
export async function queueIncidentNotifications(db: DatabaseTransaction, payload: NotificationPayload) {
  const workspace = await db.query.workspaces.findFirst({
    where: eq(workspaces.id, payload.workspaceId), columns: { accessState: true, plan: true },
  })
  const candidates = await db.query.notificationChannels.findMany({
    where: and(eq(notificationChannels.workspaceId, payload.workspaceId), eq(notificationChannels.enabled, true)),
  })
  let queued = 0
  for (const channel of channelsAllowedByWorkspace(workspace, candidates)) {
    if (severityRank[payload.severity] < severityRank[channel.minimumSeverity as keyof typeof severityRank]) continue
    if (await insertNotificationDelivery(db, payload, channel.id, 0)) queued += 1
  }
  return queued
}

export async function dispatchIncidentNotifications(payload: NotificationPayload) {
  if (!featureEnabled('notifications')) return { accepted: 0, failed: 0, skipped: true }
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
  let accepted = 0
  let failed = 0
  for (const channel of channels) {
    if (severityRank[payload.severity] < severityRank[channel.minimumSeverity as keyof typeof severityRank]) continue
    const claim = await withSystemTransaction((db) => insertNotificationDelivery(db, payload, channel.id, jobRetryDelay(1)))
    if (!claim) continue
    const result = await retryNotificationDelivery(claim.id)
    if (result === 'accepted' || result === 'delivered') {
      accepted += 1
    } else if (result !== 'cancelled' && result !== 'disabled') {
      failed += 1
    }
  }
  return { accepted, failed }
}

export async function dispatchWeeklyDigest(workspaceId: string, date = new Date()) {
  if (!featureEnabled('notifications')) return { accepted: 0, failed: 0, skipped: true }
  // The job creation date identifies the scheduled event across retries. Metrics
  // are qualified at the attempt time and carry their actual local periods.
  const snapshotDate = date.toISOString().slice(0, 10)
  const workspace = await withSystemTransaction((db) => db.query.workspaces.findFirst({ where: eq(workspaces.id, workspaceId) }))
  if (!workspace) return { accepted: 0, failed: 0, skipped: true }
  const portfolio = await getPortfolioSnapshot(workspaceId)
  if (!portfolio || portfolio.summary.accounts === 0) return { accepted: 0, failed: 0, skipped: true }
  const locale = workspace.locale === 'en' ? 'en' : 'fr'
  const numberLocale = locale === 'en' ? 'en-GB' : 'fr-FR'
  const accountCount = portfolio.summary.accounts.toLocaleString(numberLocale)
  const result = await dispatchIncidentNotifications({
    workspaceId,
    eventKey: `weekly-digest:${workspaceId}:${snapshotDate}`,
    eventType: 'digest',
    severity: 'warning',
    locale,
    title: locale === 'en' ? `Weekly digest ${workspace.brandName}` : `Synthèse hebdomadaire ${workspace.brandName}`,
    clientName: locale === 'en' ? `${accountCount} account(s)` : `${accountCount} compte(s)`,
    description: portfolioDigestDescription(portfolio.summary, portfolio.groups, locale),
  })
  return { ...result, skipped: 'skipped' in result && result.skipped === true }
}
