import 'server-only'

import { and, eq } from 'drizzle-orm'
import { auditEvents, clientGoals, clients, workspaces } from '@/db/schema'
import { withWorkspaceActorTransaction } from '@/lib/workspace-actor-guard'
import { approvalPolicyForPlan } from '@/lib/approval-policy'
import type { Capability, Plan } from '@/lib/entitlements'

type ActorContext = { workspaceId: string; actorUserId: string }

function micros(value: number | '') {
  return value === '' ? null : String(Math.round(value * 1_000_000))
}

export function saveClientGoal(input: ActorContext & {
  clientId: string
  currencyCode: string
  primaryKpi: 'cpa' | 'roas' | 'conversions' | 'conversion_value'
  monthlyBudget: number
  targetCpa: number | ''
  targetRoas: number | ''
  targetConversions: number | ''
  targetConversionValue: number | ''
  conversionValue: number | ''
  marginPercent: number | ''
}) {
  const values = {
    primaryKpi: input.primaryKpi,
    monthlyBudgetMicros: micros(input.monthlyBudget)!,
    targetCpaMicros: micros(input.targetCpa),
    targetRoas: input.targetRoas === '' ? null : String(input.targetRoas),
    targetConversions: input.targetConversions === '' ? null : String(input.targetConversions),
    targetConversionValueMicros: micros(input.targetConversionValue),
    conversionValueMicros: micros(input.conversionValue),
    marginPercent: input.marginPercent === '' ? null : String(input.marginPercent),
  }
  return withWorkspaceActorTransaction({ ...input, permission: 'workspace:admin' }, async (db) => {
    const [client] = await db.select({ currencyCode: clients.currencyCode, isManager: clients.isManager }).from(clients)
      .where(and(eq(clients.id, input.clientId), eq(clients.workspaceId, input.workspaceId))).limit(1).for('share')
    if (!client || client.isManager) throw new Error('Compte client introuvable.')
    await db.insert(clientGoals).values({
      workspaceId: input.workspaceId,
      clientId: input.clientId,
      ...values,
    }).onConflictDoUpdate({
      target: [clientGoals.workspaceId, clientGoals.clientId],
      set: { ...values, updatedAt: new Date() },
    })
    await db.insert(auditEvents).values({
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      action: 'client.goal_updated',
      entityType: 'client',
      entityId: input.clientId,
      metadata: { primaryKpi: input.primaryKpi, currencyCode: client.currencyCode },
    })
  })
}

export function saveWorkspaceLocale(input: ActorContext & { previousLocale: string; locale: 'fr' | 'en' }) {
  return updateWorkspaceWithAudit(input, {
    action: 'workspace.locale_updated',
    build: (previous) => ({ changes: { locale: input.locale }, metadata: { previousLocale: previous.locale, locale: input.locale } }),
  })
}

export function saveWorkspaceApprovalPolicy(input: ActorContext & {
  previousRequiredApprovals: number
  previousAllowSelfApproval: boolean
  requiredApprovals: number
  allowSelfApproval: boolean
  approvalMode: 'single' | 'dual'
}) {
  return updateWorkspaceWithAudit(input, {
    capability: input.requiredApprovals === 2 ? 'approvals.dual' : undefined,
    action: 'workspace.approval_policy_updated',
    build: (previous, plan) => {
      if (input.requiredApprovals !== 1 && input.requiredApprovals !== 2) throw new Error('Politique d’approbation invalide.')
      const policy = approvalPolicyForPlan(plan, { requiredApprovals: input.requiredApprovals, allowSelfApproval: input.allowSelfApproval })
      return { changes: policy, metadata: { previousRequiredApprovals: previous.requiredApprovals, previousAllowSelfApproval: previous.allowSelfApproval, ...policy } }
    },
  })
}

export function saveWorkspaceBranding(input: ActorContext & {
  brandName: string
  brandTagline: string
  accentColor: string
}) {
  return updateWorkspaceWithAudit(input, {
    capability: 'reports.white_label',
    action: 'workspace.branding_updated',
    build: () => ({ changes: { brandName: input.brandName, brandTagline: input.brandTagline, accentColor: input.accentColor }, metadata: { brandName: input.brandName, accentColor: input.accentColor } }),
  })
}

export function saveWorkspaceLogo(input: ActorContext & {
  logoUrl: string | null
  contentType?: string
  size?: number
}) {
  return updateWorkspaceWithAudit(input, {
    capability: 'reports.white_label',
    action: input.logoUrl ? 'workspace.logo_uploaded' : 'workspace.logo_removed',
    build: () => ({ changes: { logoUrl: input.logoUrl }, metadata: input.logoUrl ? { contentType: input.contentType, size: input.size } : {} }),
  })
}

type PreviousSettings = Pick<typeof workspaces.$inferSelect, 'locale' | 'requiredApprovals' | 'allowSelfApproval' | 'logoUrl'>
function updateWorkspaceWithAudit(
  input: ActorContext,
  event: {
    capability?: Capability
    action: string
    build: (previous: PreviousSettings, plan: Plan) => { changes: Partial<typeof workspaces.$inferInsert>; metadata: Record<string, unknown> }
  },
) {
  return withWorkspaceActorTransaction({ ...input, permission: 'workspace:admin', capability: event.capability }, async (db, { entitlements }) => {
    const [previous] = await db.select({ locale: workspaces.locale, requiredApprovals: workspaces.requiredApprovals, allowSelfApproval: workspaces.allowSelfApproval, logoUrl: workspaces.logoUrl })
      .from(workspaces).where(eq(workspaces.id, input.workspaceId)).limit(1)
    if (!previous) throw new Error('Espace de travail introuvable.')
    const { changes, metadata } = event.build(previous, entitlements.plan)
    await db.update(workspaces).set({ ...changes, updatedAt: new Date() }).where(eq(workspaces.id, input.workspaceId))
    await db.insert(auditEvents).values({ workspaceId: input.workspaceId, actorUserId: input.actorUserId, action: event.action, entityType: 'workspace', entityId: input.workspaceId, metadata })
    return { previousLogoUrl: previous.logoUrl }
  })
}
