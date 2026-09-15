'use server'

import { cookies } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { getWorkspaceClient } from '@/lib/data'
import { requireWorkspacePermission } from '@/lib/workspace'
import { requireFeature } from '@/lib/feature-flags'
import { reportPeriodFromForm, storedReportPeriod } from '@/lib/report-period-selection'
import { assertTimeZone, normalizeReportRecipients } from '@/lib/report-scheduling'
import { createShareToken } from '@/lib/tokens'
import { reportActionError } from '@/lib/report-action-errors'
import { createWorkspaceReportSchedule, createWorkspaceReportTemplate, deactivateWorkspaceReportTemplate,
  rotateWorkspaceScheduledReportToken, setWorkspaceReportScheduleEnabled, updateWorkspaceReportTemplate } from '@/lib/report-management'
import { createWorkspacePublicReport, reviseWorkspacePublicReport, revokeWorkspacePublicReport } from '@/lib/public-report-workflows'

function toUrl(path: string, kind: 'notice' | 'error', value: string) { return `${path}?${kind}=${encodeURIComponent(value)}` }

async function requireReportFormContext(formData: FormData) {
  const context = await requireWorkspacePermission('reports:manage')
  const displayed = formData.getAll('workspaceId')
  if (displayed.length !== 1 || displayed[0] !== context.workspace.id) throw new Error('L’espace actif a changé. Rechargez la page avant d’enregistrer.')
  return context
}

export async function createShareLink(formData: FormData) {
  let target: string
  try {
    const { workspace, session, entitlements } = await requireReportFormContext(formData)
    const clientId = z.string().uuid().parse(formData.get('clientId'))
    const label = z.string().trim().min(2).max(160).parse(formData.get('label'))
    const editorialComment = z.string().trim().max(5000).optional().parse(formData.get('editorialComment') || undefined)
    const actionPlan = z.string().trim().max(5000).optional().parse(formData.get('actionPlan') || undefined)
    const locale = z.enum(['fr', 'en']).default('fr').parse(formData.get('locale') || (workspace.locale === 'en' ? 'en' : 'fr'))
    const periodConfig = reportPeriodFromForm(Object.fromEntries(formData))
    const periodDays = ['7', '30', '90'].includes(periodConfig.period) ? Number(periodConfig.period) : 30
    const mode = z.enum(['dynamic', 'fixed']).parse(formData.get('mode') ?? 'fixed')
    const client = await getWorkspaceClient(workspace.id, clientId)
    if (!client || client.id !== clientId) throw new Error('Compte client introuvable.')
    const token = createShareToken()
    const revelation = await createWorkspacePublicReport({
      workspaceId: workspace.id,
      actorUserId: session.userId,
      clientId,
      label,
      editorialComment,
      actionPlan,
      locale,
      periodDays,
      periodConfig,
      mode,
      token,
      entitlements,
      fallbackOrigin: process.env.NEXT_PUBLIC_APP_URL ?? 'https://ads.yodev.fr',
    })
    const cookieStore = await cookies()
    cookieStore.set('yodev_secret_revelation', revelation.id, {
      httpOnly: true,
      sameSite: 'strict',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 5 * 60,
      path: '/api/secret-revelation',
    })
    target = `/reports?notice=${encodeURIComponent(workspace.locale === 'en' ? 'Report created. Reveal its URL within the next five minutes.' : 'Rapport créé. Révélez son URL dans les cinq prochaines minutes.')}&reveal=report-url&revealId=${revelation.id}`
  } catch (error) {
    target = toUrl('/reports', 'error', reportActionError(error))
  }
  revalidatePath('/reports')
  redirect(target)
}

export async function reviseReportEdition(formData: FormData) {
  let target: string
  try {
    const { workspace, session } = await requireReportFormContext(formData)
    const shareId = z.string().uuid().parse(formData.get('shareId'))
    const previousEditionId = z.string().uuid().parse(formData.get('previousEditionId'))
    const revelation = await reviseWorkspacePublicReport({ workspaceId: workspace.id, actorUserId: session.userId, shareId, previousEditionId,
      fallbackOrigin: process.env.NEXT_PUBLIC_APP_URL ?? 'https://ads.yodev.fr' })
    const cookieStore = await cookies()
    cookieStore.set('yodev_secret_revelation', revelation.id, { httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production', maxAge: 5 * 60, path: '/api/secret-revelation' })
    target = `/reports?notice=${encodeURIComponent(workspace.locale === 'en' ? 'Revision published. Previous editions remain unchanged.' : 'Révision publiée. Les éditions précédentes restent inchangées.')}&reveal=report-url&revealId=${revelation.id}`
  } catch (error) { target = toUrl('/reports', 'error', reportActionError(error)) }
  revalidatePath('/reports')
  redirect(target)
}

export async function createReportTemplate(formData: FormData) {
  let target: string
  try {
    const { workspace, session } = await requireReportFormContext(formData)
    const periodConfig = reportPeriodFromForm(Object.fromEntries(formData))
    const input = reportTemplateInputSchema.parse({ ...Object.fromEntries(formData), periodDays: ['7', '30', '90'].includes(periodConfig.period) ? Number(periodConfig.period) : 30 })
    await createWorkspaceReportTemplate({
      workspaceId: workspace.id,
      actorUserId: session.userId,
      ...input,
      periodConfig,
    })
    target = toUrl('/reports', 'notice', 'Modèle de rapport créé.')
  } catch (error) {
    target = toUrl('/reports', 'error', reportActionError(error))
  }
  revalidatePath('/reports')
  redirect(target)
}

const reportTemplateInputSchema = z.object({
  name: z.string().trim().min(2).max(160),
  locale: z.enum(['fr', 'en']).default('fr'),
  periodDays: z.coerce.number().refine((value) => { try { storedReportPeriod({ periodDays: value }); return true } catch { return false } }),
  editorialComment: z.string().trim().max(5000).optional(),
  actionPlan: z.string().trim().max(5000).optional(),
})

export async function updateReportTemplate(formData: FormData) {
  let target: string
  try {
    const { workspace, session } = await requireReportFormContext(formData)
    const periodConfig = reportPeriodFromForm(Object.fromEntries(formData))
    const { templateId, expectedVersion, ...input } = reportTemplateInputSchema.extend({
      templateId: z.string().uuid(),
      expectedVersion: z.coerce.number().int().positive(),
    }).parse({ ...Object.fromEntries(formData), periodDays: ['7', '30', '90'].includes(periodConfig.period) ? Number(periodConfig.period) : 30 })
    await updateWorkspaceReportTemplate({
      workspaceId: workspace.id,
      actorUserId: session.userId,
      templateId,
      expectedVersion,
      ...input,
      periodConfig,
    })
    target = toUrl('/reports', 'notice', 'Nouvelle version du modèle enregistrée.')
  } catch (error) {
    target = toUrl('/reports', 'error', reportActionError(error))
  }
  revalidatePath('/reports')
  redirect(target)
}

export async function deactivateReportTemplate(formData: FormData) {
  let target: string
  try {
    const { workspace, session } = await requireReportFormContext(formData)
    const templateId = z.string().uuid().parse(formData.get('templateId'))
    await deactivateWorkspaceReportTemplate({ workspaceId: workspace.id, actorUserId: session.userId, templateId })
    target = toUrl('/reports', 'notice', 'Modèle désactivé. Les rapports existants conservent leur snapshot.')
  } catch (error) {
    target = toUrl('/reports', 'error', reportActionError(error))
  }
  revalidatePath('/reports')
  redirect(target)
}

export async function createReportSchedule(formData: FormData) {
  let target: string
  try {
    const { workspace, session, entitlements } = await requireReportFormContext(formData)
    requireFeature('scheduler', 'Les rapports programmés sont temporairement désactivés.')
    requireFeature('notifications', 'La livraison des rapports programmés est temporairement désactivée.')
    const input = z.object({
      name: z.string().trim().min(2).max(160),
      clientId: z.string().uuid(),
      templateId: z.preprocess((value) => value === '' ? undefined : value, z.string().uuid().optional()),
      cadence: z.enum(['weekly', 'monthly']),
      scheduleWeekday: z.coerce.number().int().min(1).max(7).default(1),
      scheduleMonthday: z.coerce.number().int().min(1).max(31).default(1),
      sendHour: z.coerce.number().int().min(0).max(23).default(8),
      timezone: z.string().trim().min(1).max(64),
      recipients: z.string().trim().min(3).max(5000),
    }).parse(Object.fromEntries(formData))
    const timezone = assertTimeZone(input.timezone)
    const recipientEmails = z.array(z.email()).min(1).max(20).parse(normalizeReportRecipients(input.recipients))
    const token = createShareToken()
    await createWorkspaceReportSchedule({
      workspaceId: workspace.id,
      actorUserId: session.userId,
      workspaceLocale: workspace.locale,
      name: input.name,
      clientId: input.clientId,
      templateId: input.templateId,
      cadence: input.cadence,
      scheduleWeekday: input.scheduleWeekday,
      scheduleMonthday: input.scheduleMonthday,
      sendHour: input.sendHour,
      timezone,
      recipientEmails,
      token,
      entitlements,
    })
    target = toUrl('/reports', 'notice', 'Envoi planifié créé.')
  } catch (error) {
    target = toUrl('/reports', 'error', reportActionError(error))
  }
  revalidatePath('/reports')
  redirect(target)
}

export async function toggleReportSchedule(formData: FormData) {
  let target: string
  try {
    const { workspace, session, entitlements } = await requireReportFormContext(formData)
    const scheduleId = z.string().uuid().parse(formData.get('scheduleId'))
    const enabled = z.enum(['enable', 'disable']).parse(formData.get('operation')) === 'enable'
    if (enabled) {
      requireFeature('scheduler', 'Les rapports programmés sont temporairement désactivés.')
      requireFeature('notifications', 'La livraison des rapports programmés est temporairement désactivée.')
    }
    const replacementToken = enabled ? createShareToken() : null
    await setWorkspaceReportScheduleEnabled({
      workspaceId: workspace.id,
      actorUserId: session.userId,
      scheduleId,
      enabled,
      replacementToken,
      entitlements,
    })
    target = toUrl('/reports', 'notice', enabled ? 'Envoi planifié activé.' : 'Envoi planifié suspendu et lien révoqué.')
  } catch (error) {
    target = toUrl('/reports', 'error', reportActionError(error))
  }
  revalidatePath('/reports')
  redirect(target)
}

export async function rotateScheduledReportToken(formData: FormData) {
  let target: string
  try {
    const { workspace, session } = await requireReportFormContext(formData)
    requireFeature('scheduler', 'Les rapports programmés sont temporairement désactivés.')
    requireFeature('notifications', 'La livraison des rapports programmés est temporairement désactivée.')
    const scheduleId = z.string().uuid().parse(formData.get('scheduleId'))
    const token = createShareToken()
    await rotateWorkspaceScheduledReportToken({
      workspaceId: workspace.id,
      actorUserId: session.userId,
      scheduleId,
      token,
    })
    target = toUrl('/reports', 'notice', 'Token du rapport planifié renouvelé. L’ancien lien est immédiatement invalide.')
  } catch (error) {
    target = toUrl('/reports', 'error', reportActionError(error))
  }
  revalidatePath('/reports')
  redirect(target)
}

export async function revokeShareLink(formData: FormData) {
  let target: string
  try {
    const { workspace, session } = await requireReportFormContext(formData)
    const shareId = z.string().uuid().parse(formData.get('shareId'))
    await revokeWorkspacePublicReport({ workspaceId: workspace.id, actorUserId: session.userId, shareId })
    target = toUrl('/reports', 'notice', 'Lien public révoqué immédiatement.')
  } catch (error) {
    target = toUrl('/reports', 'error', reportActionError(error))
  }
  revalidatePath('/reports')
  redirect(target)
}

