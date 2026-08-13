import 'server-only'

import { and, count, eq, sql } from 'drizzle-orm'
import {
  auditEvents,
  clients,
  reportSchedules,
  reportTemplates,
  reportTemplateVersions,
  shareLinks,
} from '@/db/schema'
import { withTenantTransaction } from '@/db/transactions'
import { insertActivationMilestone } from '@/lib/activation'
import { encryptSecret } from '@/lib/crypto'
import { requireQuota, type EntitlementContext } from '@/lib/entitlements'
import { hashToken } from '@/lib/tokens'

type ActorContext = { workspaceId: string; actorUserId: string }

export type ReportTemplateInput = {
  name: string
  locale: 'fr' | 'en'
  periodDays: number
  editorialComment?: string
  actionPlan?: string
}

function templateSnapshot(template: typeof reportTemplates.$inferSelect) {
  return {
    name: template.name,
    locale: template.locale as 'fr' | 'en',
    periodDays: template.periodDays,
    editorialComment: template.editorialComment,
    actionPlan: template.actionPlan,
  }
}

export function createWorkspaceReportTemplate(input: ActorContext & ReportTemplateInput) {
  return withTenantTransaction({ workspaceId: input.workspaceId, userId: input.actorUserId }, async (db) => {
    const [template] = await db.insert(reportTemplates).values({
      workspaceId: input.workspaceId,
      createdBy: input.actorUserId,
      name: input.name,
      locale: input.locale,
      periodDays: input.periodDays,
      editorialComment: input.editorialComment || null,
      actionPlan: input.actionPlan || null,
    }).returning()
    if (!template) throw new Error('La création du modèle de rapport a échoué.')
    await db.insert(reportTemplateVersions).values({
      workspaceId: input.workspaceId,
      templateId: template.id,
      version: 1,
      editedBy: input.actorUserId,
      snapshot: templateSnapshot(template),
    })
    await db.insert(auditEvents).values({
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      action: 'report.template_created',
      entityType: 'report_template',
      entityId: template.id,
      metadata: { locale: input.locale, periodDays: input.periodDays },
    })
    return template
  })
}

export function updateWorkspaceReportTemplate(input: ActorContext & ReportTemplateInput & {
  templateId: string
  expectedVersion: number
  now?: Date
}) {
  const now = input.now ?? new Date()
  return withTenantTransaction({ workspaceId: input.workspaceId, userId: input.actorUserId }, async (db) => {
    const [updated] = await db.update(reportTemplates).set({
      name: input.name,
      locale: input.locale,
      periodDays: input.periodDays,
      editorialComment: input.editorialComment || null,
      actionPlan: input.actionPlan || null,
      currentVersion: input.expectedVersion + 1,
      updatedAt: now,
    }).where(and(
      eq(reportTemplates.id, input.templateId),
      eq(reportTemplates.workspaceId, input.workspaceId),
      eq(reportTemplates.currentVersion, input.expectedVersion),
      eq(reportTemplates.active, true),
    )).returning()
    if (!updated) throw new Error('Le modèle a été modifié ou désactivé. Rechargez la page avant de réessayer.')
    await db.insert(reportTemplateVersions).values({
      workspaceId: input.workspaceId,
      templateId: updated.id,
      version: updated.currentVersion,
      editedBy: input.actorUserId,
      snapshot: templateSnapshot(updated),
    })
    await db.insert(auditEvents).values({
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      action: 'report.template_updated',
      entityType: 'report_template',
      entityId: updated.id,
      metadata: { previousVersion: input.expectedVersion, version: updated.currentVersion },
    })
    return updated
  })
}

export function deactivateWorkspaceReportTemplate(input: ActorContext & { templateId: string; now?: Date }) {
  const now = input.now ?? new Date()
  return withTenantTransaction({ workspaceId: input.workspaceId, userId: input.actorUserId }, async (db) => {
    const [updated] = await db.update(reportTemplates).set({ active: false, updatedAt: now }).where(and(
      eq(reportTemplates.id, input.templateId),
      eq(reportTemplates.workspaceId, input.workspaceId),
      eq(reportTemplates.active, true),
    )).returning({ id: reportTemplates.id, currentVersion: reportTemplates.currentVersion })
    if (!updated) throw new Error('Modèle introuvable ou déjà désactivé.')
    await db.insert(auditEvents).values({
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      action: 'report.template_deactivated',
      entityType: 'report_template',
      entityId: updated.id,
      metadata: { version: updated.currentVersion },
    })
    return updated
  })
}

export function createWorkspaceReportSchedule(input: ActorContext & {
  workspaceLocale: string
  name: string
  clientId: string
  templateId?: string
  cadence: 'weekly' | 'monthly'
  scheduleWeekday: number
  scheduleMonthday: number
  sendHour: number
  timezone: string
  recipientEmails: string[]
  token: string
  entitlements: EntitlementContext
  now?: Date
}) {
  const now = input.now ?? new Date()
  return withTenantTransaction({ workspaceId: input.workspaceId, userId: input.actorUserId }, async (db) => {
    await db.execute(sql`select pg_advisory_xact_lock(hashtext(${`${input.workspaceId}:reports`}))`)
    const usage = await db.select({ count: count() }).from(shareLinks).where(and(eq(shareLinks.workspaceId, input.workspaceId), eq(shareLinks.active, true)))
    const client = await db.query.clients.findFirst({
      where: and(eq(clients.id, input.clientId), eq(clients.workspaceId, input.workspaceId), eq(clients.active, true)),
    })
    const template = input.templateId
      ? await db.query.reportTemplates.findFirst({
          where: and(eq(reportTemplates.id, input.templateId), eq(reportTemplates.workspaceId, input.workspaceId), eq(reportTemplates.active, true)),
        })
      : undefined
    requireQuota(input.entitlements, 'reports', usage[0].count)
    if (!client || client.isManager) throw new Error('Compte client introuvable.')
    if (input.templateId && !template) throw new Error('Modèle de rapport introuvable.')
    const [share] = await db.insert(shareLinks).values({
      workspaceId: input.workspaceId,
      clientId: client.id,
      createdBy: input.actorUserId,
      label: input.name,
      editorialComment: template?.editorialComment ?? null,
      actionPlan: template?.actionPlan ?? null,
      locale: template?.locale ?? input.workspaceLocale,
      periodDays: template?.periodDays ?? 30,
      tokenHash: hashToken(input.token),
      tokenPrefix: input.token.slice(0, 12),
      expiresAt: new Date(now.getTime() + 90 * 24 * 60 * 60_000),
    }).returning({ id: shareLinks.id })
    if (!share) throw new Error('La création du lien de rapport a échoué.')
    const [schedule] = await db.insert(reportSchedules).values({
      workspaceId: input.workspaceId,
      clientId: client.id,
      templateId: template?.id ?? null,
      shareId: share.id,
      createdBy: input.actorUserId,
      name: input.name,
      cadence: input.cadence,
      scheduleWeekday: input.cadence === 'weekly' ? input.scheduleWeekday : null,
      scheduleMonthday: input.cadence === 'monthly' ? input.scheduleMonthday : null,
      sendHour: input.sendHour,
      timezone: input.timezone,
      recipientEmails: input.recipientEmails,
      encryptedReportToken: encryptSecret(input.token),
    }).returning({ id: reportSchedules.id })
    if (!schedule) throw new Error('La création de la planification a échoué.')
    await db.insert(auditEvents).values({
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      action: 'report.schedule_created',
      entityType: 'report_schedule',
      entityId: schedule.id,
      metadata: { cadence: input.cadence, recipientCount: input.recipientEmails.length, clientId: client.id },
    })
    await insertActivationMilestone(db, {
      workspaceId: input.workspaceId,
      milestone: 'first_report',
      actorUserId: input.actorUserId,
      sourceEntityId: share.id,
    })
    return { schedule, share }
  })
}

export function setWorkspaceReportScheduleEnabled(input: ActorContext & {
  scheduleId: string
  enabled: boolean
  replacementToken: string | null
  entitlements: EntitlementContext
  now?: Date
}) {
  const now = input.now ?? new Date()
  return withTenantTransaction({ workspaceId: input.workspaceId, userId: input.actorUserId }, async (db) => {
    await db.execute(sql`select pg_advisory_xact_lock(hashtext(${`${input.workspaceId}:reports`}))`)
    const schedule = await db.query.reportSchedules.findFirst({
      where: and(eq(reportSchedules.id, input.scheduleId), eq(reportSchedules.workspaceId, input.workspaceId)),
    })
    if (!schedule) throw new Error('Planification introuvable.')
    if (schedule.deliveryLeaseUntil && schedule.deliveryLeaseUntil > now) throw new Error('Un envoi est en cours. Réessayez dans quelques minutes.')
    if (input.enabled && !schedule.enabled) {
      const [usage] = await db.select({ count: count() }).from(shareLinks).where(and(
        eq(shareLinks.workspaceId, input.workspaceId), eq(shareLinks.active, true),
      ))
      requireQuota(input.entitlements, 'reports', usage.count)
    }
    await db.update(reportSchedules).set({
      enabled: input.enabled,
      encryptedReportToken: input.replacementToken ? encryptSecret(input.replacementToken) : schedule.encryptedReportToken,
      lastError: null,
      updatedAt: now,
    }).where(and(eq(reportSchedules.id, schedule.id), eq(reportSchedules.workspaceId, input.workspaceId)))
    await db.update(shareLinks).set({
      active: input.enabled,
      tokenHash: input.replacementToken ? hashToken(input.replacementToken) : undefined,
      tokenPrefix: input.replacementToken ? input.replacementToken.slice(0, 12) : undefined,
      expiresAt: input.enabled
        ? new Date(now.getTime() + 90 * 24 * 60 * 60_000)
        : schedule.enabled ? now : undefined,
      updatedAt: now,
    }).where(and(eq(shareLinks.id, schedule.shareId), eq(shareLinks.workspaceId, input.workspaceId)))
    await db.insert(auditEvents).values({
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      action: input.enabled ? 'report.schedule_enabled' : 'report.schedule_disabled',
      entityType: 'report_schedule',
      entityId: schedule.id,
      metadata: { shareId: schedule.shareId },
    })
    return schedule
  })
}

export function rotateWorkspaceScheduledReportToken(input: ActorContext & {
  scheduleId: string
  token: string
  now?: Date
}) {
  const now = input.now ?? new Date()
  return withTenantTransaction({ workspaceId: input.workspaceId, userId: input.actorUserId }, async (db) => {
    const schedule = await db.query.reportSchedules.findFirst({
      where: and(eq(reportSchedules.id, input.scheduleId), eq(reportSchedules.workspaceId, input.workspaceId)),
    })
    if (!schedule) throw new Error('Planification introuvable.')
    if (schedule.deliveryLeaseUntil && schedule.deliveryLeaseUntil > now) throw new Error('Un envoi est en cours. Réessayez dans quelques minutes.')
    await db.update(shareLinks).set({
      tokenHash: hashToken(input.token),
      tokenPrefix: input.token.slice(0, 12),
      expiresAt: new Date(now.getTime() + 90 * 24 * 60 * 60_000),
      updatedAt: now,
    }).where(and(eq(shareLinks.id, schedule.shareId), eq(shareLinks.workspaceId, input.workspaceId)))
    await db.update(reportSchedules).set({
      encryptedReportToken: encryptSecret(input.token),
      updatedAt: now,
    }).where(and(eq(reportSchedules.id, schedule.id), eq(reportSchedules.workspaceId, input.workspaceId)))
    await db.insert(auditEvents).values({
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      action: 'report.schedule_token_rotated',
      entityType: 'report_schedule',
      entityId: schedule.id,
      metadata: { shareId: schedule.shareId },
    })
    return schedule
  })
}
