'use server'

import { and, eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { getDb } from '@/db'
import {
  alertIncidents,
  apiKeys,
  approvalRequests,
  auditEvents,
  clients,
  googleAdsConnections,
  monitoringAgents,
  shareLinks,
  workspaces,
} from '@/db/schema'
import { decryptSecret } from '@/lib/crypto'
import { getWorkspaceClient, getWorkspaceConnection } from '@/lib/data'
import { GoogleAdsGateway } from '@/lib/google-ads'
import { normalizeCustomerId } from '@/lib/ids'
import { agentTemplates } from '@/lib/monitoring'
import { runWorkspaceMonitoring } from '@/lib/run-monitoring'
import { createApiToken, createShareToken, hashToken } from '@/lib/tokens'
import { requireAdminWorkspace, requireWorkspace } from '@/lib/workspace'

function message(error: unknown) {
  return error instanceof Error ? error.message : 'Une erreur inattendue est survenue.'
}

function toUrl(path: string, kind: 'notice' | 'error', value: string) {
  return `${path}?${kind}=${encodeURIComponent(value)}`
}

export async function syncGoogleAdsAccounts() {
  let target: string
  try {
    const { workspace, session } = await requireAdminWorkspace()
    const connection = await getWorkspaceConnection(workspace.id)
    if (!connection) throw new Error('Connectez d’abord un compte Google Ads.')

    const gateway = new GoogleAdsGateway(connection)
    const managedCustomers = await gateway.listManagedCustomers()
    const db = getDb()
    for (const customer of managedCustomers) {
      await db
        .insert(clients)
        .values({
          workspaceId: workspace.id,
          googleCustomerId: normalizeCustomerId(customer.customerId),
          name: customer.name,
          currencyCode: customer.currencyCode,
          timezone: customer.timezone,
          isManager: customer.isManager,
        })
        .onConflictDoUpdate({
          target: [clients.workspaceId, clients.googleCustomerId],
          set: {
            name: customer.name,
            currencyCode: customer.currencyCode,
            timezone: customer.timezone,
            isManager: customer.isManager,
            active: true,
            updatedAt: new Date(),
          },
        })
    }
    await db.insert(auditEvents).values({
      workspaceId: workspace.id,
      actorUserId: session.userId,
      action: 'google_ads.accounts_synced',
      entityType: 'google_ads_connection',
      entityId: connection.id,
      metadata: { count: managedCustomers.length },
    })
    await db
      .update(googleAdsConnections)
      .set({ lastSuccessfulUseAt: new Date(), updatedAt: new Date() })
      .where(and(eq(googleAdsConnections.id, connection.id), eq(googleAdsConnections.workspaceId, workspace.id)))
    target = toUrl('/accounts', 'notice', `${managedCustomers.length} comptes synchronisés.`)
  } catch (error) {
    target = toUrl('/settings', 'error', message(error))
  }
  revalidatePath('/dashboard', 'layout')
  redirect(target)
}

const brandingSchema = z.object({
  brandName: z.string().trim().min(2).max(120),
  brandTagline: z.string().trim().min(2).max(180),
  accentColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  logoUrl: z.union([z.literal(''), z.string().url()]),
})

export async function updateBranding(formData: FormData) {
  let target: string
  try {
    const { workspace, session } = await requireAdminWorkspace()
    const values = brandingSchema.parse(Object.fromEntries(formData))
    await getDb()
      .update(workspaces)
      .set({ ...values, logoUrl: values.logoUrl || null, updatedAt: new Date() })
      .where(eq(workspaces.id, workspace.id))
    await getDb()
      .insert(auditEvents)
      .values({
        workspaceId: workspace.id,
        actorUserId: session.userId,
        action: 'workspace.branding_updated',
        entityType: 'workspace',
        entityId: workspace.id,
        metadata: { brandName: values.brandName, accentColor: values.accentColor },
      })
    target = toUrl('/settings', 'notice', 'Identité de marque enregistrée.')
  } catch (error) {
    target = toUrl('/settings', 'error', message(error))
  }
  revalidatePath('/dashboard', 'layout')
  redirect(target)
}

const approvalSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('campaign_status'),
    clientId: z.string().uuid(),
    campaignId: z.string().min(1),
    campaignName: z.string().min(1).max(220),
    status: z.enum(['ENABLED', 'PAUSED']),
  }),
  z.object({
    kind: z.literal('campaign_budget'),
    clientId: z.string().uuid(),
    campaignId: z.string().min(1),
    campaignName: z.string().min(1).max(220),
    budgetResourceName: z.string().min(1),
    dailyBudget: z.coerce.number().positive().max(10_000_000),
  }),
])

export async function requestGoogleAdsChange(formData: FormData) {
  let target: string
  try {
    const { workspace, session } = await requireWorkspace()
    const input = approvalSchema.parse(Object.fromEntries(formData))
    const client = await getWorkspaceClient(workspace.id, input.clientId)
    if (!client || client.id !== input.clientId) throw new Error('Compte client introuvable.')
    const connection = await getWorkspaceConnection(workspace.id)
    if (!connection) throw new Error('Connexion Google Ads absente.')
    const gateway = new GoogleAdsGateway(connection)

    let payload: Record<string, unknown>
    let title: string
    let requestId: string | null
    if (input.kind === 'campaign_status') {
      const validation = await gateway.validateCampaignStatus(client.googleCustomerId, input.campaignId, input.status)
      requestId = validation.requestId
      payload = { campaignId: input.campaignId, status: input.status }
      title = `${input.status === 'PAUSED' ? 'Suspendre' : 'Activer'} « ${input.campaignName} »`
    } else {
      const amountMicros = String(Math.round(input.dailyBudget * 1_000_000))
      const validation = await gateway.validateBudget(client.googleCustomerId, input.budgetResourceName, amountMicros)
      requestId = validation.requestId
      payload = {
        campaignId: input.campaignId,
        budgetResourceName: input.budgetResourceName,
        amountMicros,
        dailyBudget: input.dailyBudget,
      }
      title = `Budget de « ${input.campaignName} » à ${input.dailyBudget.toLocaleString('fr-FR')} ${client.currencyCode}/j`
    }

    const [approval] = await getDb()
      .insert(approvalRequests)
      .values({
        workspaceId: workspace.id,
        clientId: client.id,
        requestedBy: session.userId,
        kind: input.kind,
        title,
        payload,
        validationRequestId: requestId,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      })
      .returning()
    await getDb()
      .insert(auditEvents)
      .values({
        workspaceId: workspace.id,
        actorUserId: session.userId,
        action: 'approval.requested',
        entityType: 'approval_request',
        entityId: approval.id,
        metadata: { kind: input.kind, clientId: client.id, validationRequestId: requestId },
      })
    target = toUrl('/approvals', 'notice', 'Changement validé par Google et ajouté aux approbations.')
  } catch (error) {
    target = toUrl('/dashboard', 'error', message(error))
  }
  revalidatePath('/approvals')
  redirect(target)
}

export async function approveGoogleAdsChange(formData: FormData) {
  let target: string
  let claimedId: string | undefined
  try {
    const { workspace, session } = await requireAdminWorkspace()
    const approvalId = z.string().uuid().parse(formData.get('approvalId'))
    const db = getDb()
    const [claimed] = await db
      .update(approvalRequests)
      .set({ status: 'executing', approvedBy: session.userId, updatedAt: new Date() })
      .where(
        and(
          eq(approvalRequests.id, approvalId),
          eq(approvalRequests.workspaceId, workspace.id),
          eq(approvalRequests.status, 'pending'),
        ),
      )
      .returning()
    if (!claimed) throw new Error('Cette demande a déjà été traitée.')
    claimedId = claimed.id
    if (claimed.expiresAt < new Date()) {
      await db
        .update(approvalRequests)
        .set({ status: 'expired', updatedAt: new Date() })
        .where(eq(approvalRequests.id, claimed.id))
      throw new Error('Cette demande a expiré.')
    }

    const client = await getWorkspaceClient(workspace.id, claimed.clientId)
    const connection = await getWorkspaceConnection(workspace.id)
    if (!client || !connection) throw new Error('Le compte ou sa connexion Google Ads est introuvable.')
    const gateway = new GoogleAdsGateway(connection)
    let executionRequestId: string | null
    let executionValidationRequestId: string | null
    if (claimed.kind === 'campaign_status') {
      const payload = z.object({ campaignId: z.string(), status: z.enum(['ENABLED', 'PAUSED']) }).parse(claimed.payload)
      const validation = await gateway.validateCampaignStatus(
        client.googleCustomerId,
        payload.campaignId,
        payload.status,
      )
      executionValidationRequestId = validation.requestId
      const result = await gateway.mutateCampaignStatus(client.googleCustomerId, payload.campaignId, payload.status)
      executionRequestId = result.requestId
    } else if (claimed.kind === 'campaign_budget') {
      const payload = z.object({ budgetResourceName: z.string(), amountMicros: z.string() }).parse(claimed.payload)
      const validation = await gateway.validateBudget(
        client.googleCustomerId,
        payload.budgetResourceName,
        payload.amountMicros,
      )
      executionValidationRequestId = validation.requestId
      const result = await gateway.mutateBudget(
        client.googleCustomerId,
        payload.budgetResourceName,
        payload.amountMicros,
      )
      executionRequestId = result.requestId
    } else {
      throw new Error('Type de changement non pris en charge.')
    }

    await db
      .update(approvalRequests)
      .set({ status: 'executed', executionRequestId, executedAt: new Date(), updatedAt: new Date() })
      .where(eq(approvalRequests.id, claimed.id))
    await db.insert(auditEvents).values({
      workspaceId: workspace.id,
      actorUserId: session.userId,
      action: 'approval.executed',
      entityType: 'approval_request',
      entityId: claimed.id,
      metadata: { kind: claimed.kind, executionValidationRequestId, executionRequestId },
    })
    target = toUrl('/approvals', 'notice', 'Changement appliqué dans Google Ads.')
  } catch (error) {
    if (claimedId) {
      await getDb()
        .update(approvalRequests)
        .set({ status: 'failed', errorMessage: message(error).slice(0, 2000), updatedAt: new Date() })
        .where(and(eq(approvalRequests.id, claimedId), eq(approvalRequests.status, 'executing')))
    }
    target = toUrl('/approvals', 'error', message(error))
  }
  revalidatePath('/dashboard', 'layout')
  redirect(target)
}

export async function rejectGoogleAdsChange(formData: FormData) {
  let target: string
  try {
    const { workspace, session } = await requireAdminWorkspace()
    const approvalId = z.string().uuid().parse(formData.get('approvalId'))
    const [rejected] = await getDb()
      .update(approvalRequests)
      .set({ status: 'rejected', approvedBy: session.userId, updatedAt: new Date() })
      .where(
        and(
          eq(approvalRequests.id, approvalId),
          eq(approvalRequests.workspaceId, workspace.id),
          eq(approvalRequests.status, 'pending'),
        ),
      )
      .returning()
    if (!rejected) throw new Error('Cette demande a déjà été traitée.')
    await getDb().insert(auditEvents).values({
      workspaceId: workspace.id,
      actorUserId: session.userId,
      action: 'approval.rejected',
      entityType: 'approval_request',
      entityId: rejected.id,
      metadata: {},
    })
    target = toUrl('/approvals', 'notice', 'Demande rejetée.')
  } catch (error) {
    target = toUrl('/approvals', 'error', message(error))
  }
  revalidatePath('/approvals')
  redirect(target)
}

export async function disconnectGoogleAds() {
  let target: string
  try {
    const { workspace, session } = await requireAdminWorkspace()
    const connection = await getWorkspaceConnection(workspace.id)
    if (!connection) throw new Error('Aucune connexion Google Ads active.')
    const refreshToken = decryptSecret(connection.encryptedRefreshToken)
    const revocation = await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(refreshToken)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      cache: 'no-store',
    })
    if (!revocation.ok) throw new Error('Google n’a pas confirmé la révocation du jeton.')
    await getDb()
      .delete(googleAdsConnections)
      .where(and(eq(googleAdsConnections.id, connection.id), eq(googleAdsConnections.workspaceId, workspace.id)))
    await getDb()
      .insert(auditEvents)
      .values({
        workspaceId: workspace.id,
        actorUserId: session.userId,
        action: 'google_ads.disconnected',
        entityType: 'google_ads_connection',
        entityId: connection.id,
        metadata: { managerCustomerId: connection.managerCustomerId },
      })
    target = toUrl('/settings', 'notice', 'Connexion Google Ads révoquée et supprimée.')
  } catch (error) {
    target = toUrl('/settings', 'error', message(error))
  }
  revalidatePath('/dashboard', 'layout')
  redirect(target)
}

const monitoringAgentSchema = z.object({
  kind: z.enum([
    'no_delivery',
    'spend_without_conversion',
    'high_cpa',
    'budget_pressure',
    'wasted_search_terms',
    'low_quality_keywords',
    'weak_responsive_ads',
    'tracking_gap',
  ]),
  clientId: z.union([z.literal('all'), z.string().uuid()]),
  threshold: z.coerce.number().min(0).max(1_000_000),
})

export async function createMonitoringAgent(formData: FormData) {
  let target: string
  try {
    const { workspace, session } = await requireAdminWorkspace()
    const input = monitoringAgentSchema.parse(Object.fromEntries(formData))
    const template = agentTemplates.find((item) => item.kind === input.kind)
    if (!template) throw new Error('Modèle de vigie inconnu.')
    if (input.clientId !== 'all') {
      const client = await getWorkspaceClient(workspace.id, input.clientId)
      if (!client || client.id !== input.clientId) throw new Error('Compte client introuvable.')
    }
    const [agent] = await getDb()
      .insert(monitoringAgents)
      .values({
        workspaceId: workspace.id,
        clientId: input.clientId === 'all' ? null : input.clientId,
        createdBy: session.userId,
        kind: input.kind,
        name: template.name,
        description: template.description,
        threshold: String(input.threshold),
      })
      .returning()
    await getDb()
      .insert(auditEvents)
      .values({
        workspaceId: workspace.id,
        actorUserId: session.userId,
        action: 'monitoring.agent_created',
        entityType: 'monitoring_agent',
        entityId: agent.id,
        metadata: { kind: input.kind, clientId: agent.clientId },
      })
    target = toUrl('/agents', 'notice', 'Vigie activée. Elle sera exécutée chaque jour.')
  } catch (error) {
    target = toUrl('/agents', 'error', message(error))
  }
  revalidatePath('/agents')
  redirect(target)
}

export async function toggleMonitoringAgent(formData: FormData) {
  let target: string
  try {
    const { workspace } = await requireAdminWorkspace()
    const id = z.string().uuid().parse(formData.get('agentId'))
    const enabled = z.enum(['true', 'false']).parse(formData.get('enabled')) === 'true'
    const [agent] = await getDb()
      .update(monitoringAgents)
      .set({ enabled, updatedAt: new Date() })
      .where(and(eq(monitoringAgents.id, id), eq(monitoringAgents.workspaceId, workspace.id)))
      .returning()
    if (!agent) throw new Error('Vigie introuvable.')
    target = toUrl('/agents', 'notice', enabled ? 'Vigie activée.' : 'Vigie mise en pause.')
  } catch (error) {
    target = toUrl('/agents', 'error', message(error))
  }
  revalidatePath('/agents')
  redirect(target)
}

export async function runMonitoringScan(formData: FormData) {
  let target: string
  try {
    const { workspace, session } = await requireWorkspace()
    const rawId = formData.get('agentId')
    const agentId = rawId ? z.string().uuid().parse(rawId) : undefined
    const result = await runWorkspaceMonitoring(workspace.id, agentId)
    await getDb().insert(auditEvents).values({
      workspaceId: workspace.id,
      actorUserId: session.userId,
      action: 'monitoring.scan_completed',
      entityType: 'workspace',
      entityId: workspace.id,
      metadata: result,
    })
    target = toUrl('/alerts', 'notice', `${result.detected} signalement(s) détecté(s), ${result.resolved} résolu(s).`)
  } catch (error) {
    target = toUrl('/agents', 'error', message(error))
  }
  revalidatePath('/alerts')
  redirect(target)
}

export async function resolveAlertIncident(formData: FormData) {
  let target: string
  try {
    const { workspace, session } = await requireWorkspace()
    const incidentId = z.string().uuid().parse(formData.get('incidentId'))
    const [incident] = await getDb()
      .update(alertIncidents)
      .set({ status: 'acknowledged', resolvedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(alertIncidents.id, incidentId), eq(alertIncidents.workspaceId, workspace.id)))
      .returning()
    if (!incident) throw new Error('Alerte introuvable.')
    await getDb().insert(auditEvents).values({
      workspaceId: workspace.id,
      actorUserId: session.userId,
      action: 'monitoring.alert_acknowledged',
      entityType: 'alert_incident',
      entityId: incident.id,
      metadata: {},
    })
    target = toUrl('/alerts', 'notice', 'Alerte acquittée.')
  } catch (error) {
    target = toUrl('/alerts', 'error', message(error))
  }
  revalidatePath('/alerts')
  redirect(target)
}

export async function createShareLink(formData: FormData) {
  let target: string
  try {
    const { workspace, session } = await requireWorkspace()
    const clientId = z.string().uuid().parse(formData.get('clientId'))
    const label = z.string().trim().min(2).max(160).parse(formData.get('label'))
    const client = await getWorkspaceClient(workspace.id, clientId)
    if (!client || client.id !== clientId) throw new Error('Compte client introuvable.')
    const token = createShareToken()
    await getDb()
      .insert(shareLinks)
      .values({
        workspaceId: workspace.id,
        clientId,
        createdBy: session.userId,
        label,
        tokenHash: hashToken(token),
        tokenPrefix: token.slice(0, 12),
        expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
      })
    target = `/reports?notice=${encodeURIComponent('Rapport créé. Copiez son URL maintenant.')}&share=${encodeURIComponent(token)}`
  } catch (error) {
    target = toUrl('/reports', 'error', message(error))
  }
  revalidatePath('/reports')
  redirect(target)
}

export async function revokeShareLink(formData: FormData) {
  let target: string
  try {
    const { workspace } = await requireWorkspace()
    const shareId = z.string().uuid().parse(formData.get('shareId'))
    const [share] = await getDb()
      .update(shareLinks)
      .set({ active: false, updatedAt: new Date() })
      .where(and(eq(shareLinks.id, shareId), eq(shareLinks.workspaceId, workspace.id)))
      .returning()
    if (!share) throw new Error('Lien introuvable.')
    target = toUrl('/reports', 'notice', 'Lien public révoqué immédiatement.')
  } catch (error) {
    target = toUrl('/reports', 'error', message(error))
  }
  revalidatePath('/reports')
  redirect(target)
}

export async function createAgencyApiKey(formData: FormData) {
  let target: string
  try {
    const { workspace, session } = await requireAdminWorkspace()
    const name = z.string().trim().min(2).max(120).parse(formData.get('name'))
    const token = createApiToken()
    await getDb()
      .insert(apiKeys)
      .values({
        workspaceId: workspace.id,
        createdBy: session.userId,
        name,
        tokenHash: hashToken(token),
        tokenPrefix: token.slice(0, 16),
      })
    target = `/settings?notice=${encodeURIComponent('Clé créée. Copiez-la maintenant : elle ne sera plus affichée.')}&apiKey=${encodeURIComponent(token)}`
  } catch (error) {
    target = toUrl('/settings', 'error', message(error))
  }
  revalidatePath('/settings')
  redirect(target)
}

export async function revokeAgencyApiKey(formData: FormData) {
  let target: string
  try {
    const { workspace } = await requireAdminWorkspace()
    const keyId = z.string().uuid().parse(formData.get('keyId'))
    const [key] = await getDb()
      .update(apiKeys)
      .set({ revokedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(apiKeys.id, keyId), eq(apiKeys.workspaceId, workspace.id)))
      .returning()
    if (!key) throw new Error('Clé API introuvable.')
    target = toUrl('/settings', 'notice', 'Clé API révoquée.')
  } catch (error) {
    target = toUrl('/settings', 'error', message(error))
  }
  revalidatePath('/settings')
  redirect(target)
}
