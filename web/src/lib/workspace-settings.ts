import 'server-only'

import { eq } from 'drizzle-orm'
import { auditEvents, clientGoals, workspaces } from '@/db/schema'
import { withTenantTransaction } from '@/db/transactions'

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
  return withTenantTransaction({ workspaceId: input.workspaceId, userId: input.actorUserId }, async (db) => {
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
      metadata: { primaryKpi: input.primaryKpi, currencyCode: input.currencyCode },
    })
  })
}

export function saveWorkspaceLocale(input: ActorContext & { previousLocale: string; locale: 'fr' | 'en' }) {
  return updateWorkspaceWithAudit(input, {
    changes: { locale: input.locale },
    action: 'workspace.locale_updated',
    metadata: { previousLocale: input.previousLocale, locale: input.locale },
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
    changes: {
      requiredApprovals: input.requiredApprovals,
      allowSelfApproval: input.allowSelfApproval,
      approvalMode: input.approvalMode,
    },
    action: 'workspace.approval_policy_updated',
    metadata: {
      previousRequiredApprovals: input.previousRequiredApprovals,
      previousAllowSelfApproval: input.previousAllowSelfApproval,
      requiredApprovals: input.requiredApprovals,
      allowSelfApproval: input.allowSelfApproval,
      approvalMode: input.approvalMode,
    },
  })
}

export function saveWorkspaceBranding(input: ActorContext & {
  brandName: string
  brandTagline: string
  accentColor: string
}) {
  return updateWorkspaceWithAudit(input, {
    changes: { brandName: input.brandName, brandTagline: input.brandTagline, accentColor: input.accentColor },
    action: 'workspace.branding_updated',
    metadata: { brandName: input.brandName, accentColor: input.accentColor },
  })
}

export function saveWorkspaceLogo(input: ActorContext & {
  logoUrl: string | null
  contentType?: string
  size?: number
}) {
  return updateWorkspaceWithAudit(input, {
    changes: { logoUrl: input.logoUrl },
    action: input.logoUrl ? 'workspace.logo_uploaded' : 'workspace.logo_removed',
    metadata: input.logoUrl ? { contentType: input.contentType, size: input.size } : {},
  })
}

function updateWorkspaceWithAudit(
  input: ActorContext,
  event: {
    changes: Partial<typeof workspaces.$inferInsert>
    action: string
    metadata: Record<string, unknown>
  },
) {
  return withTenantTransaction({ workspaceId: input.workspaceId, userId: input.actorUserId }, async (db) => {
    await db.update(workspaces)
      .set({ ...event.changes, updatedAt: new Date() })
      .where(eq(workspaces.id, input.workspaceId))
    await db.insert(auditEvents).values({
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      action: event.action,
      entityType: 'workspace',
      entityId: input.workspaceId,
      metadata: event.metadata,
    })
  })
}
