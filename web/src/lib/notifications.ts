import 'server-only'

import { and, eq } from 'drizzle-orm'
import { Resend } from 'resend'
import { getDb } from '@/db'
import { notificationChannels, notificationDeliveries, performanceSnapshots, workspaces } from '@/db/schema'
import { decryptSecret } from '@/lib/crypto'

type NotificationPayload = {
  workspaceId: string
  incidentId?: string
  eventKey: string
  severity: 'warning' | 'critical'
  title: string
  description: string
  clientName: string
  eventType?: 'alert' | 'digest'
}

const severityRank = { warning: 1, critical: 2 } as const

export function webhookBody(payload: NotificationPayload) {
  return {
    text: `Vigieads · ${payload.eventType === 'digest' ? 'Synthèse hebdomadaire' : payload.severity === 'critical' ? 'Incident critique' : 'Alerte'} · ${payload.clientName}`,
    title: payload.title,
    description: payload.description,
    severity: payload.severity,
    eventKey: payload.eventKey,
  }
}

export function alertEmailHtml(payload: NotificationPayload) {
  const escaped = [payload.clientName, payload.title, payload.description].map((value) =>
    value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[character]!),
  )
  return `<div style="font-family:Arial,sans-serif;max-width:620px;margin:auto;padding:32px;color:#12202b"><p style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#39725d">Vigieads · ${payload.eventType === 'digest' ? 'Synthèse hebdomadaire' : payload.severity === 'critical' ? 'Incident critique' : 'Alerte'}</p><h1 style="font-size:24px">${escaped[1]}</h1><p style="color:#52626f">Compte : <strong>${escaped[0]}</strong></p><p style="line-height:1.65">${escaped[2]}</p><p style="margin-top:32px;font-size:12px;color:#80909b">Notification automatique et traçable envoyée par Vigieads.</p></div>`
}

async function deliverChannel(
  channel: typeof notificationChannels.$inferSelect,
  payload: NotificationPayload,
): Promise<string | undefined> {
  const destination = decryptSecret(channel.encryptedDestination)
  if (channel.kind === 'email') {
    if (!process.env.RESEND_API_KEY) throw new Error('RESEND_API_KEY absent')
    const resend = new Resend(process.env.RESEND_API_KEY)
    const { data, error } = await resend.emails.send({
      from: process.env.NOTIFICATION_FROM_EMAIL ?? 'Vigieads <onboarding@resend.dev>',
      to: destination,
      subject: payload.eventType === 'digest' ? payload.title : `[${payload.severity === 'critical' ? 'Critique' : 'Alerte'}] ${payload.title}`,
      html: alertEmailHtml(payload),
      headers: { 'X-Entity-Ref-ID': payload.eventKey },
    })
    if (error) throw new Error(error.message)
    return data?.id
  }
  const response = await fetch(destination, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(webhookBody(payload)),
    signal: AbortSignal.timeout(8_000),
  })
  if (!response.ok) throw new Error(`Webhook HTTP ${response.status}`)
}

export async function dispatchIncidentNotifications(payload: NotificationPayload) {
  const db = getDb()
  const channels = await db.query.notificationChannels.findMany({
    where: and(eq(notificationChannels.workspaceId, payload.workspaceId), eq(notificationChannels.enabled, true)),
  })
  let delivered = 0
  let failed = 0
  for (const channel of channels) {
    if (severityRank[payload.severity] < severityRank[channel.minimumSeverity as keyof typeof severityRank]) continue
    const [claim] = await db
      .insert(notificationDeliveries)
      .values({
        workspaceId: payload.workspaceId,
        channelId: channel.id,
        incidentId: payload.incidentId,
        eventKey: payload.eventKey,
        status: 'sending',
      })
      .onConflictDoNothing()
      .returning({ id: notificationDeliveries.id })
    if (!claim) continue
    try {
      const providerMessageId = await deliverChannel(channel, payload)
      await db
        .update(notificationDeliveries)
        .set({ status: 'delivered', providerMessageId })
        .where(eq(notificationDeliveries.id, claim.id))
      await db.update(notificationChannels).set({ lastDeliveredAt: new Date(), lastError: null, updatedAt: new Date() }).where(eq(notificationChannels.id, channel.id))
      delivered += 1
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Erreur de notification'
      await db
        .update(notificationDeliveries)
        .set({ status: 'failed', errorMessage })
        .where(eq(notificationDeliveries.id, claim.id))
      await db.update(notificationChannels).set({ lastError: errorMessage.slice(0, 1000), updatedAt: new Date() }).where(eq(notificationChannels.id, channel.id))
      failed += 1
    }
  }
  return { delivered, failed }
}

export async function dispatchWeeklyDigest(workspaceId: string, date = new Date()) {
  const snapshotDate = date.toISOString().slice(0, 10)
  const [workspace, snapshots] = await Promise.all([
    getDb().query.workspaces.findFirst({ where: eq(workspaces.id, workspaceId) }),
    getDb().query.performanceSnapshots.findMany({
      where: and(
        eq(performanceSnapshots.workspaceId, workspaceId),
        eq(performanceSnapshots.snapshotDate, snapshotDate),
      ),
    }),
  ])
  if (!workspace || snapshots.length === 0) return { delivered: 0, failed: 0, skipped: true }
  const totals = snapshots.reduce(
    (sum, snapshot) => ({
      costMicros: sum.costMicros + Number(snapshot.costMicros),
      clicks: sum.clicks + Number(snapshot.clicks),
      conversions: sum.conversions + Number(snapshot.conversions),
    }),
    { costMicros: 0, clicks: 0, conversions: 0 },
  )
  const result = await dispatchIncidentNotifications({
    workspaceId,
    eventKey: `weekly-digest:${workspaceId}:${snapshotDate}`,
    eventType: 'digest',
    severity: 'warning',
    title: `Synthèse hebdomadaire ${workspace.brandName}`,
    clientName: `${snapshots.length} compte(s)`,
    description: `Fenêtre 30 jours : ${(totals.costMicros / 1_000_000).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} € investis, ${totals.clicks.toLocaleString('fr-FR')} clics et ${totals.conversions.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} conversions.`,
  })
  return { ...result, skipped: false }
}
