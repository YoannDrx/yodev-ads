'use server'

import { cookies, headers } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { del, put } from '@vercel/blob'
import {
  checkoutIntegrationIdentifier,
  checkoutTaxConfiguration,
  getStripe,
  isPlanId,
  planCatalog,
  priceIdForPlan,
  subscriptionIsActive,
  taxCheckoutCopy,
  type PlanId,
} from '@/lib/billing'
import { decryptSecret } from '@/lib/crypto'
import { getPublicShare, getWorkspaceClient, getWorkspaceConnection } from '@/lib/data'
import { requireCapability } from '@/lib/entitlements'
import { authUser } from '@/lib/auth-identities'
import { featureEnabled, requireFeature, requireGoogleMutationKind, requireWritableProduct } from '@/lib/feature-flags'
import { GoogleAdsError, GoogleAdsGateway, revokeGoogleOAuthToken, type AtomicGoogleAdsOperation } from '@/lib/google-ads'
import {
  currentKeywordCreationContext,
  keywordCreationPayloadSchema,
  mutateKeywordCreation,
  proposedKeywordCreationState,
  type KeywordCreationContext,
} from '@/lib/keyword-creation'
import { stateHash } from '@/lib/approval-state'
import { atomicBudgetState, buildAtomicBudgetReallocation } from '@/lib/budget-reallocation'
import { atomicChangeBatchState, atomicOperationFromApproval, type AtomicBatchSource } from '@/lib/atomic-change-batch'
import { atomicOperationSchema, currentAtomicBatchSource, storedAtomicBatchSourceSchema } from '@/lib/atomic-change-batch-server'
import { buildMutationImpactPreview, mergeAtomicImpactPreviews, mutationConflicts, type MutationImpactPreview } from '@/lib/mutation-impact'
import { assertBudgetChangeSafety } from '@/lib/budget-safety'
import { LEGAL_VERSIONS, legalRequestFingerprint, requireCommercialLegalReadiness } from '@/lib/legal'
import { LOCALE_COOKIE } from '@/lib/locale'
import { enqueueJob } from '@/lib/jobs'
import { agentTemplatesForLocale } from '@/lib/monitoring'
import { runWorkspaceMonitoring } from '@/lib/run-monitoring'
import { assertSafeWebhookUrl } from '@/lib/webhook-security'
import { consumeRateLimit, requestIp } from '@/lib/rate-limit'
import { sendReportOtpEmail } from '@/lib/report-otp'
import { assertTimeZone, normalizeReportRecipients } from '@/lib/report-scheduling'
import {
  SUPPORT_CATEGORIES,
  SUPPORT_PRIORITIES,
  SUPPORT_STATUSES,
} from '@/lib/support-workflow'
import { PLATFORM_COMPONENTS, PLATFORM_IMPACTS, PLATFORM_INCIDENT_STATUSES } from '@/lib/platform-status'
import {
  createApiToken,
  createDomainVerificationToken,
  createOtp,
  createReportFeedbackSessionToken,
  createShareToken,
} from '@/lib/tokens'
import {
  normalizeCustomHostname,
} from '@/lib/vercel-domains'
import { requireWorkspacePermission } from '@/lib/workspace'
import {
  inviteWorkspaceMemberWithQuota,
  manageableWorkspaceRoles,
  removeWorkspaceMemberWithAudit,
  revokeWorkspaceInvitationWithAudit,
  saveMemberTaskNotificationPreferences,
  transferWorkspaceOwnershipWithAudit,
  updateWorkspaceMemberRoleWithAudit,
  workspaceMemberRoster,
} from '@/lib/workspace-members'
import { isControlledBrandLogoUrl, validatedBrandLogo } from '@/lib/branding-assets'
import { approvalPolicyForPlan } from '@/lib/approval-policy'
import { assertSafetyPolicyScope } from '@/lib/safety-policy-scope'
import { persistTenantGoogleAccountInventory } from '@/lib/google-account-sync'
import {
  saveClientGoal,
  saveWorkspaceApprovalPolicy,
  saveWorkspaceBranding,
  saveWorkspaceLocale,
  saveWorkspaceLogo,
} from '@/lib/workspace-settings'
import {
  acknowledgeWorkspaceAlert,
  createWorkspaceMonitoringAgent,
  recordWorkspaceMonitoringScan,
  setWorkspaceMonitoringAgentEnabled,
  updateWorkspaceAlertWorkflow,
} from '@/lib/monitoring-workflows'
import {
  addTenantWorkspaceTaskComment,
  createTenantWorkspaceTask,
  updateTenantWorkspaceTask,
} from '@/lib/workspace-task-actions'
import {
  createWorkspaceApiKey,
  createWorkspaceNotificationChannel,
  disableWorkspaceNotificationChannel,
  retryWorkspaceDeadLetterJob,
  revokeWorkspaceApiKey,
  saveWorkspaceSafetyPolicy,
} from '@/lib/workspace-security-resources'
import {
  createWorkspaceReportSchedule,
  createWorkspaceReportTemplate,
  deactivateWorkspaceReportTemplate,
  rotateWorkspaceScheduledReportToken,
  setWorkspaceReportScheduleEnabled,
  updateWorkspaceReportTemplate,
} from '@/lib/report-management'
import {
  createWorkspacePublicReport,
  issuePublicReportOtp,
  revokeWorkspacePublicReport,
  submitPublicReportFeedback,
  verifyPublicReportOtp,
} from '@/lib/public-report-workflows'
import {
  createWorkspaceCustomDomain,
  revokeWorkspaceCustomDomain,
  verifyWorkspaceCustomDomain,
} from '@/lib/workspace-domain-management'
import {
  claimWorkspaceDeletionCancellation,
  createWorkspaceExportRequest,
  finalizeWorkspaceDeletionCancellation,
  markWorkspaceDeletionPending,
} from '@/lib/workspace-lifecycle-management'
import {
  persistWorkspaceStripeCustomer,
  recordSubscriptionCancellationRequested,
  recordSubscriptionCancellationRevoked,
  releaseWorkspaceCheckoutReservation,
  reserveWorkspaceCheckout,
} from '@/lib/billing-management'
import {
  addSystemSupportReply,
  addTenantSupportMessage,
  createTenantSupportTicket,
  updateSystemSupportTicket,
} from '@/lib/support-management'
import {
  addSystemPlatformIncidentUpdate,
  createSystemPlatformIncident,
} from '@/lib/platform-incident-management'
import { scheduleSubprocessorChangeNotice } from '@/lib/subprocessor-change-management'
import { SUBPROCESSOR_CHANGE_TYPES } from '@/lib/subprocessor-change-model'
import { accessTeamsOAuthSession, completeTeamsOAuthSession } from '@/lib/notification-oauth-management'
import { openOAuthState } from '@/lib/oauth-state'
import { resolveTeamsDestination } from '@/lib/teams-oauth'
import {
  addGoogleApprovalComment,
  completeGoogleMutationExecution,
  createAtomicGoogleApprovalBatch,
  createGoogleApprovalRequest,
  createGoogleMutationExecution,
  deleteWorkspaceGoogleConnection,
  failGoogleMutationExecution,
  loadAtomicGoogleApprovalSources,
  markGoogleApprovalDrifted,
  markGoogleMutationSubmitted,
  rejectGoogleApproval,
  voteAndClaimGoogleApproval,
} from '@/lib/google-approval-management'

function message(error: unknown) {
  return error instanceof Error ? error.message : 'Une erreur inattendue est survenue.'
}

function requiredAuthOrganizationId(value: string | null) {
  if (!value) throw new Error('Cet espace doit être migré vers Better Auth avant cette opération.')
  return value
}

function toUrl(path: string, kind: 'notice' | 'error', value: string) {
  return `${path}?${kind}=${encodeURIComponent(value)}`
}

class ApprovalVotePendingError extends Error {}

async function revokeGoogleRefreshToken(encryptedRefreshToken: string) {
  return revokeGoogleOAuthToken(decryptSecret(encryptedRefreshToken))
}

export async function syncGoogleAdsAccounts() {
  let target: string
  try {
    const { workspace, session, entitlements } = await requireWorkspacePermission('google:connect')
    requireCapability(entitlements, 'google.read')
    const connection = await getWorkspaceConnection(workspace.id)
    if (!connection) throw new Error('Connectez d’abord un compte Google Ads.')

    const gateway = new GoogleAdsGateway(connection)
    const managedCustomers = await gateway.listManagedCustomers()
    const { included, excluded, limit } = await persistTenantGoogleAccountInventory({
      workspaceId: workspace.id,
      actorUserId: session.userId,
      connectionId: connection.id,
      managedCustomers,
      advertiserLimit: entitlements.limits.advertiserAccounts,
      plan: workspace.plan,
      action: 'google_ads.accounts_synced',
      recordActivation: true,
    })
    target = toUrl(
      '/accounts',
      'notice',
      excluded.length
        ? `${included.length} comptes synchronisés. ${excluded.length} compte annonceur hors quota (${limit ?? 'illimité'}) reste inactif.`
        : `${included.length} comptes synchronisés.`,
    )
  } catch (error) {
    target = toUrl('/settings', 'error', message(error))
  }
  revalidatePath('/dashboard', 'layout')
  redirect(target)
}

const clientGoalSchema = z.object({
  clientId: z.string().uuid(),
  primaryKpi: z.enum(['cpa', 'roas', 'conversions', 'conversion_value']),
  monthlyBudget: z.coerce.number().positive().max(100_000_000),
  targetCpa: z.union([z.literal(''), z.coerce.number().positive().max(100_000_000)]),
  targetRoas: z.union([z.literal(''), z.coerce.number().positive().max(100_000)]),
  targetConversions: z.union([z.literal(''), z.coerce.number().positive().max(1_000_000)]),
  targetConversionValue: z.union([z.literal(''), z.coerce.number().positive().max(100_000_000)]),
  conversionValue: z.union([z.literal(''), z.coerce.number().positive().max(100_000_000)]),
  marginPercent: z.union([z.literal(''), z.coerce.number().min(0).max(100)]),
})

export async function updateClientGoal(formData: FormData) {
  let target: string
  try {
    const { workspace, session } = await requireWorkspacePermission('workspace:admin')
    const input = clientGoalSchema.parse(Object.fromEntries(formData))
    const client = await getWorkspaceClient(workspace.id, input.clientId)
    if (!client || client.isManager) throw new Error('Compte client introuvable.')
    await saveClientGoal({
      workspaceId: workspace.id,
      actorUserId: session.userId,
      currencyCode: client.currencyCode,
      ...input,
    })
    target = `/dashboard?client=${client.id}&notice=${encodeURIComponent('Objectif client enregistré.')}`
  } catch (error) {
    target = toUrl('/dashboard', 'error', message(error))
  }
  revalidatePath('/dashboard')
  redirect(target)
}

const brandingSchema = z.object({
  brandName: z.string().trim().min(2).max(120),
  brandTagline: z.string().trim().min(2).max(180),
  accentColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
})

export async function updateWorkspaceLocale(formData: FormData) {
  let target: string
  try {
    const { workspace, session } = await requireWorkspacePermission('workspace:admin')
    const locale = z.enum(['fr', 'en']).parse(formData.get('locale'))
    await saveWorkspaceLocale({
      workspaceId: workspace.id,
      actorUserId: session.userId,
      previousLocale: workspace.locale,
      locale,
    })
    const cookieStore = await cookies()
    cookieStore.set(LOCALE_COOKIE, locale, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 365 * 24 * 60 * 60,
    })
    target = toUrl('/settings', 'notice', locale === 'en' ? 'Workspace language updated.' : 'Langue de l’espace mise à jour.')
  } catch (error) {
    target = toUrl('/settings', 'error', message(error))
  }
  revalidatePath('/', 'layout')
  redirect(target)
}

export async function updateApprovalPolicy(formData: FormData) {
  let target: string
  try {
    const { workspace, session, entitlements } = await requireWorkspacePermission('workspace:admin')
    const input = z.object({
      requiredApprovals: z.coerce.number().int().min(1).max(2).transform((value) => value as 1 | 2),
      allowSelfApproval: z.preprocess((value) => value === 'on' || value === 'true', z.boolean()),
    }).parse(Object.fromEntries(formData))
    if (input.requiredApprovals === 2) requireCapability(entitlements, 'approvals.dual')
    const policy = approvalPolicyForPlan(entitlements.plan, input)
    await saveWorkspaceApprovalPolicy({
      workspaceId: workspace.id,
      actorUserId: session.userId,
      previousRequiredApprovals: workspace.requiredApprovals,
      previousAllowSelfApproval: workspace.allowSelfApproval,
      ...policy,
    })
    target = toUrl('/settings', 'notice', workspace.locale === 'en' ? 'Approval policy updated.' : 'Politique d’approbation mise à jour.')
  } catch (error) {
    target = toUrl('/settings', 'error', message(error))
  }
  revalidatePath('/settings')
  revalidatePath('/approvals')
  redirect(target)
}

export async function updateBranding(formData: FormData) {
  let target: string
  try {
    const { workspace, session, entitlements } = await requireWorkspacePermission('workspace:admin')
    requireCapability(entitlements, 'reports.white_label')
    const values = brandingSchema.parse(Object.fromEntries(formData))
    await saveWorkspaceBranding({
      workspaceId: workspace.id,
      actorUserId: session.userId,
      ...values,
    })
    target = toUrl('/settings', 'notice', 'Identité de marque enregistrée.')
  } catch (error) {
    target = toUrl('/settings', 'error', message(error))
  }
  revalidatePath('/dashboard', 'layout')
  redirect(target)
}

export async function uploadWorkspaceLogo(formData: FormData) {
  let target: string
  let uploadedUrl: string | null = null
  try {
    const { workspace, session, entitlements } = await requireWorkspacePermission('workspace:admin')
    requireCapability(entitlements, 'reports.white_label')
    const file = formData.get('logo')
    if (!(file instanceof File)) throw new Error('Sélectionnez un fichier logo.')
    const image = await validatedBrandLogo(file)
    const uploaded = await put(`workspace-branding/${workspace.id}/logo.${image.extension}`, Buffer.from(image.bytes), {
      access: 'public',
      addRandomSuffix: true,
      contentType: image.contentType,
      cacheControlMaxAge: 31_536_000,
    })
    uploadedUrl = uploaded.url
    await saveWorkspaceLogo({
      workspaceId: workspace.id,
      actorUserId: session.userId,
      logoUrl: uploaded.url,
      contentType: image.contentType,
      size: file.size,
    })
    if (workspace.logoUrl && isControlledBrandLogoUrl(workspace.logoUrl)) await del(workspace.logoUrl).catch(() => undefined)
    target = toUrl('/settings', 'notice', workspace.locale === 'en' ? 'Logo uploaded.' : 'Logo importé.')
  } catch (error) {
    if (uploadedUrl) await del(uploadedUrl).catch(() => undefined)
    target = toUrl('/settings', 'error', message(error))
  }
  revalidatePath('/', 'layout')
  redirect(target)
}

export async function removeWorkspaceLogo() {
  let target: string
  try {
    const { workspace, session, entitlements } = await requireWorkspacePermission('workspace:admin')
    requireCapability(entitlements, 'reports.white_label')
    await saveWorkspaceLogo({
      workspaceId: workspace.id,
      actorUserId: session.userId,
      logoUrl: null,
    })
    if (workspace.logoUrl && isControlledBrandLogoUrl(workspace.logoUrl)) await del(workspace.logoUrl).catch(() => undefined)
    target = toUrl('/settings', 'notice', workspace.locale === 'en' ? 'Logo removed.' : 'Logo supprimé.')
  } catch (error) {
    target = toUrl('/settings', 'error', message(error))
  }
  revalidatePath('/', 'layout')
  redirect(target)
}

export async function updateMyTaskNotificationPreferences(formData: FormData) {
  let target: string
  try {
    const { workspace, session } = await requireWorkspacePermission('workspace:read')
    const input = z.object({
      mentionHandle: z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9_-]{1,31}$/, 'Identifiant de mention invalide.'),
      mentionNotifications: z.preprocess((value) => value === 'on' || value === 'true', z.boolean()),
      digestCadence: z.enum(['none', 'daily', 'weekly']),
      digestHour: z.coerce.number().int().min(0).max(23),
      timezone: z.string().trim().min(1).max(64),
    }).parse(Object.fromEntries(formData))
    const timezone = assertTimeZone(input.timezone)
    const user = await authUser(session.userId)
    if (!user?.emailVerified) throw new Error('Une adresse Better Auth vérifiée est requise.')
    const displayName = user.name || input.mentionHandle
    await saveMemberTaskNotificationPreferences({
      workspaceId: workspace.id,
      userId: session.userId,
      mentionHandle: input.mentionHandle,
      displayName,
      emailAddress: user.email,
      mentionNotifications: input.mentionNotifications,
      digestCadence: input.digestCadence,
      digestHour: input.digestHour,
      timezone,
    })
    target = toUrl('/settings', 'notice', 'Préférences personnelles de tâches enregistrées.')
  } catch (error) {
    target = toUrl('/settings', 'error', message(error))
  }
  revalidatePath('/settings')
  revalidatePath('/tasks')
  redirect(target)
}

const memberRoleSchema = z.enum(manageableWorkspaceRoles)

export async function inviteWorkspaceMember(formData: FormData) {
  let target: string
  try {
    const { workspace, session, entitlements } = await requireWorkspacePermission('members:manage')
    requireCapability(entitlements, 'collaboration')
    const input = z.object({
      emailAddress: z.string().trim().toLowerCase().email().max(254),
      role: memberRoleSchema,
    }).parse(Object.fromEntries(formData))
    await inviteWorkspaceMemberWithQuota({
      workspaceId: workspace.id,
      organizationId: requiredAuthOrganizationId(workspace.authOrganizationId),
      ownerUserId: workspace.ownerUserId,
      actorUserId: session.userId,
      emailAddress: input.emailAddress,
      role: input.role,
      entitlements,
    })
    target = toUrl('/settings', 'notice', workspace.locale === 'en' ? 'Invitation sent.' : 'Invitation envoyée.')
  } catch (error) {
    target = toUrl('/settings', 'error', message(error))
  }
  revalidatePath('/settings')
  redirect(target)
}

export async function updateWorkspaceMemberRole(formData: FormData) {
  let target: string
  try {
    const { workspace, session } = await requireWorkspacePermission('members:manage')
    const input = z.object({ userId: z.string().min(3).max(128), role: memberRoleSchema }).parse(Object.fromEntries(formData))
    if (input.userId === workspace.ownerUserId) throw new Error('Le rôle du propriétaire ne peut être modifié que par un transfert de propriété.')
    await updateWorkspaceMemberRoleWithAudit({
      workspaceId: workspace.id,
      organizationId: requiredAuthOrganizationId(workspace.authOrganizationId),
      actorUserId: session.userId,
      targetUserId: input.userId,
      role: input.role,
    })
    target = toUrl('/settings', 'notice', workspace.locale === 'en' ? 'Member role updated.' : 'Rôle du membre mis à jour.')
  } catch (error) {
    target = toUrl('/settings', 'error', message(error))
  }
  revalidatePath('/settings')
  redirect(target)
}

export async function removeWorkspaceMember(formData: FormData) {
  let target: string
  try {
    const { workspace, session } = await requireWorkspacePermission('members:manage')
    const userId = z.string().min(3).max(128).parse(formData.get('userId'))
    if (userId === workspace.ownerUserId) throw new Error('Le propriétaire ne peut pas être retiré de son espace.')
    await removeWorkspaceMemberWithAudit({
      workspaceId: workspace.id,
      organizationId: requiredAuthOrganizationId(workspace.authOrganizationId),
      actorUserId: session.userId,
      targetUserId: userId,
    })
    target = toUrl('/settings', 'notice', workspace.locale === 'en' ? 'Member removed.' : 'Membre retiré.')
  } catch (error) {
    target = toUrl('/settings', 'error', message(error))
  }
  revalidatePath('/settings')
  redirect(target)
}

export async function revokeWorkspaceInvitation(formData: FormData) {
  let target: string
  try {
    const { workspace, session } = await requireWorkspacePermission('members:manage')
    const invitationId = z.string().min(3).max(128).parse(formData.get('invitationId'))
    await revokeWorkspaceInvitationWithAudit({
      workspaceId: workspace.id,
      organizationId: requiredAuthOrganizationId(workspace.authOrganizationId),
      invitationId,
      actorUserId: session.userId,
    })
    target = toUrl('/settings', 'notice', workspace.locale === 'en' ? 'Invitation revoked.' : 'Invitation révoquée.')
  } catch (error) {
    target = toUrl('/settings', 'error', message(error))
  }
  revalidatePath('/settings')
  redirect(target)
}

export async function transferWorkspaceOwnership(formData: FormData) {
  let target: string
  try {
    const { workspace, session, role } = await requireWorkspacePermission('members:manage')
    if (role !== 'owner') throw new Error('Seul le propriétaire peut transférer la propriété.')
    const input = z.object({
      userId: z.string().min(3).max(128),
      confirmation: z.string(),
    }).parse(Object.fromEntries(formData))
    if (input.userId === workspace.ownerUserId) throw new Error('Ce membre est déjà propriétaire.')
    if (input.confirmation !== workspace.slug) throw new Error('La confirmation ne correspond pas à l’identifiant de l’espace.')
    const organizationId = requiredAuthOrganizationId(workspace.authOrganizationId)
    const roster = await workspaceMemberRoster(organizationId, workspace.ownerUserId)
    if (!roster.members.some((member) => member.userId === input.userId)) throw new Error('Le nouveau propriétaire doit déjà être membre actif.')
    await transferWorkspaceOwnershipWithAudit({
      workspaceId: workspace.id,
      organizationId,
      actorUserId: session.userId,
      newOwnerUserId: input.userId,
    })
    target = toUrl('/settings', 'notice', workspace.locale === 'en' ? 'Workspace ownership transferred.' : 'Propriété de l’espace transférée.')
  } catch (error) {
    target = toUrl('/settings', 'error', message(error))
  }
  revalidatePath('/', 'layout')
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
  z.object({
    kind: z.literal('budget_reallocation'),
    clientId: z.string().uuid(),
    campaignId: z.string().regex(/^\d+$/),
    campaignName: z.string().min(1).max(220),
    budgetResourceName: z.string().min(1),
    targetCampaignId: z.string().regex(/^\d+$/),
    targetCampaignName: z.string().min(1).max(220),
    targetBudgetResourceName: z.string().min(1),
    transferDaily: z.coerce.number().positive().max(10_000_000),
  }),
  z.object({
    kind: z.literal('keyword_create_negative'),
    clientId: z.string().uuid(),
    campaignId: z.string().regex(/^\d+$/),
    campaignName: z.string().min(1).max(220),
    adGroupId: z.string().regex(/^\d+$/),
    adGroupName: z.string().min(1).max(220),
    scope: z.enum(['ad_group', 'campaign', 'account']).default('ad_group'),
    keywordText: z.string().trim().min(1).max(80),
    matchType: z.enum(['EXACT', 'PHRASE', 'BROAD']),
  }),
  z.object({
    kind: z.literal('keyword_create_positive'),
    clientId: z.string().uuid(),
    campaignId: z.string().regex(/^\d+$/),
    campaignName: z.string().min(1).max(220),
    adGroupId: z.string().regex(/^\d+$/),
    adGroupName: z.string().min(1).max(220),
    scope: z.literal('ad_group').default('ad_group'),
    keywordText: z.string().trim().min(1).max(80),
    matchType: z.enum(['EXACT', 'PHRASE', 'BROAD']),
  }),
  z.object({
    kind: z.literal('keyword_status'),
    clientId: z.string().uuid(),
    campaignId: z.string().regex(/^\d+$/),
    campaignName: z.string().min(1).max(220),
    adGroupId: z.string().regex(/^\d+$/),
    criterionId: z.string().regex(/^\d+$/),
    status: z.enum(['ENABLED', 'PAUSED']),
  }),
  z.object({
    kind: z.literal('ad_status'),
    clientId: z.string().uuid(),
    campaignId: z.string().regex(/^\d+$/),
    campaignName: z.string().min(1).max(220),
    adGroupId: z.string().regex(/^\d+$/),
    adId: z.string().regex(/^\d+$/),
    status: z.enum(['ENABLED', 'PAUSED']),
  }),
  z.object({
    kind: z.literal('rsa_create_draft'),
    clientId: z.string().uuid(),
    campaignId: z.string().regex(/^\d+$/),
    campaignName: z.string().min(1).max(220),
    adGroupId: z.string().regex(/^\d+$/),
    adGroupName: z.string().min(1).max(220),
    headlines: z.string().max(500),
    descriptions: z.string().max(500),
    finalUrl: z.string().url().refine((value) => new URL(value).protocol === 'https:', 'L’URL finale doit utiliser HTTPS.'),
  }),
])

function parseRsaAssets(input: { headlines: string; descriptions: string; finalUrl: string }) {
  const split = (value: string) => value.split('\n').map((part) => part.trim().replace(/\s+/g, ' ')).filter(Boolean)
  const headlines = split(input.headlines)
  const descriptions = split(input.descriptions)
  if (headlines.length < 3 || headlines.length > 15) throw new Error('Un draft RSA exige entre 3 et 15 titres, un par ligne.')
  if (descriptions.length < 2 || descriptions.length > 4) throw new Error('Un draft RSA exige entre 2 et 4 descriptions, une par ligne.')
  if (headlines.some((value) => value.length > 30)) throw new Error('Chaque titre RSA est limité à 30 caractères.')
  if (descriptions.some((value) => value.length > 90)) throw new Error('Chaque description RSA est limitée à 90 caractères.')
  if (new Set(headlines.map((value) => value.toLocaleLowerCase('und'))).size !== headlines.length) throw new Error('Les titres RSA doivent être distincts.')
  if (new Set(descriptions.map((value) => value.toLocaleLowerCase('und'))).size !== descriptions.length) throw new Error('Les descriptions RSA doivent être distinctes.')
  return { headlines, descriptions, finalUrl: new URL(input.finalUrl).toString() }
}

export async function requestGoogleAdsChange(formData: FormData) {
  let target: string
  try {
    const { workspace, session, entitlements } = await requireWorkspacePermission('google:propose')
    const input = approvalSchema.parse(Object.fromEntries(formData))
    requireGoogleMutationKind(input.kind)
    const basicChange = input.kind === 'campaign_status' || input.kind === 'campaign_budget'
    requireCapability(entitlements, basicChange ? 'google.mutate.basic' : 'google.mutate.advanced')
    if (input.kind === 'budget_reallocation' && entitlements.plan !== 'agency' && entitlements.plan !== 'internal') {
      throw new Error('Le batch atomique de réallocation est réservé au plan Agency.')
    }
    const client = await getWorkspaceClient(workspace.id, input.clientId)
    if (!client || client.id !== input.clientId) throw new Error('Compte client introuvable.')
    const connection = await getWorkspaceConnection(workspace.id)
    if (!connection) throw new Error('Connexion Google Ads absente.')
    const gateway = new GoogleAdsGateway(connection)
    const current = await gateway.campaignMutationState(client.googleCustomerId, input.campaignId)

    let payload: Record<string, unknown>
    let expectedState: Record<string, unknown>
    let proposedState: Record<string, unknown>
    let resourceName: string
    let title: string
    let requestId: string | null
    let previewOperationCount: number | undefined
    let previewAtomic: boolean | undefined
    if (input.kind === 'campaign_status') {
      const validation = await gateway.validateCampaignStatus(client.googleCustomerId, input.campaignId, input.status)
      requestId = validation.requestId
      payload = { campaignId: input.campaignId, status: input.status }
      resourceName = current.campaignResourceName
      expectedState = { resourceName, status: current.status }
      proposedState = { resourceName, status: input.status }
      title = `${input.status === 'PAUSED' ? 'Suspendre' : 'Activer'} « ${current.campaignName} »`
    } else if (input.kind === 'campaign_budget') {
      if (!current.budgetResourceName || current.budgetResourceName !== input.budgetResourceName) {
        throw new Error('Le budget transmis ne correspond plus à la campagne Google Ads.')
      }
      const amountMicros = String(Math.round(input.dailyBudget * 1_000_000))
      await assertBudgetChangeSafety({
        workspace,
        client,
        campaignId: input.campaignId,
        currentBudgetMicros: current.budgetMicros,
        proposedBudgetMicros: amountMicros,
      })
      const validation = await gateway.validateBudget(client.googleCustomerId, input.budgetResourceName, amountMicros)
      requestId = validation.requestId
      payload = {
        campaignId: input.campaignId,
        budgetResourceName: input.budgetResourceName,
        amountMicros,
        dailyBudget: input.dailyBudget,
      }
      resourceName = current.budgetResourceName
      expectedState = {
        resourceName,
        amountMicros: current.budgetMicros,
        explicitlyShared: current.budgetExplicitlyShared,
        referenceCount: current.budgetReferenceCount,
      }
      proposedState = { ...expectedState, amountMicros }
      title = `Budget de « ${current.campaignName} » à ${input.dailyBudget.toLocaleString('fr-FR')} ${client.currencyCode}/j`
    } else if (input.kind === 'budget_reallocation') {
      const targetCurrent = await gateway.campaignMutationState(client.googleCustomerId, input.targetCampaignId)
      if (current.budgetResourceName !== input.budgetResourceName || targetCurrent.budgetResourceName !== input.targetBudgetResourceName) {
        throw new Error('Un budget transmis ne correspond plus à sa campagne Google Ads.')
      }
      const transferMicros = BigInt(Math.round(input.transferDaily * 1_000_000))
      const reallocation = buildAtomicBudgetReallocation(current, targetCurrent, transferMicros)
      await Promise.all([
        assertBudgetChangeSafety({
          workspace, client, campaignId: input.campaignId,
          currentBudgetMicros: current.budgetMicros, proposedBudgetMicros: reallocation.changes[0].amountMicros,
        }),
        assertBudgetChangeSafety({
          workspace, client, campaignId: input.targetCampaignId,
          currentBudgetMicros: targetCurrent.budgetMicros, proposedBudgetMicros: reallocation.changes[1].amountMicros,
        }),
      ])
      const validation = await gateway.mutateBudgetBatch(client.googleCustomerId, reallocation.changes, true)
      requestId = validation.requestId
      payload = { campaignId: input.campaignId, transferMicros: transferMicros.toString(), changes: reallocation.changes }
      resourceName = `atomic-budget-batch:${current.budgetResourceName}:${targetCurrent.budgetResourceName}`
      expectedState = reallocation.expectedState
      proposedState = reallocation.proposedState
      title = `Réallouer ${input.transferDaily.toLocaleString('fr-FR')} ${client.currencyCode}/j de « ${current.campaignName} » vers « ${targetCurrent.campaignName} »`
    } else if (input.kind === 'keyword_create_negative' || input.kind === 'keyword_create_positive') {
      const negative = input.kind === 'keyword_create_negative'
      const creationPayload = keywordCreationPayloadSchema.parse({
        scope: input.scope,
        campaignId: input.campaignId,
        adGroupId: input.adGroupId,
        keywordText: input.keywordText.trim().replace(/\s+/g, ' '),
        matchType: input.matchType,
        negative,
      })
      const keywordContext = await currentKeywordCreationContext(gateway, client.googleCustomerId, creationPayload)
      const matches = Array.isArray(keywordContext.approvalState.matches)
        ? keywordContext.approvalState.matches as Array<{ negative?: boolean; matchType?: string; status?: string }>
        : []
      if (matches.length) {
        const conflicts = matches.map((match) => `${match.negative ? 'négatif' : 'positif'} ${match.matchType ?? 'inconnu'} (${match.status ?? 'inconnu'})`).join(', ')
        throw new Error(`Un mot-clé en conflit existe déjà à la portée ${input.scope === 'ad_group' ? 'groupe' : input.scope === 'campaign' ? 'campagne' : 'compte'} : ${conflicts}.`)
      }
      const validation = await mutateKeywordCreation(
        gateway,
        client.googleCustomerId,
        creationPayload,
        keywordContext,
        true,
      )
      requestId = validation.requestId
      payload = {
        ...creationPayload,
        ...(keywordContext.accountState ? { campaignIds: keywordContext.accountState.campaignIds } : {}),
      }
      resourceName = keywordContext.resourceName
      expectedState = keywordContext.approvalState
      proposedState = proposedKeywordCreationState(keywordContext, creationPayload)
      previewOperationCount = keywordContext.operationCount
      previewAtomic = keywordContext.operationCount > 1
      const destination = input.scope === 'ad_group'
        ? `le groupe « ${input.adGroupName} »`
        : input.scope === 'campaign'
          ? `la campagne « ${input.campaignName} »`
          : `tout le compte « ${client.name} »`
      title = `${negative ? 'Ajouter le mot-clé négatif' : 'Promouvoir la requête'} « ${input.keywordText} » dans ${destination}`
    } else if (input.kind === 'keyword_status') {
      const keywordState = await gateway.keywordCriterionState(client.googleCustomerId, input.adGroupId, input.criterionId)
      if (keywordState.campaignId !== BigInt(input.campaignId).toString()) throw new Error('Le mot-clé ne correspond pas à la campagne transmise.')
      const validation = await gateway.mutateKeywordStatus(client.googleCustomerId, keywordState.resourceName, input.status, true)
      requestId = validation.requestId
      payload = {
        campaignId: input.campaignId,
        adGroupId: input.adGroupId,
        criterionId: input.criterionId,
        resourceName: keywordState.resourceName,
        status: input.status,
      }
      resourceName = keywordState.resourceName
      expectedState = keywordState
      proposedState = { ...keywordState, status: input.status }
      title = `${input.status === 'PAUSED' ? 'Suspendre' : 'Réactiver'} le mot-clé « ${keywordState.text} »`
    } else if (input.kind === 'ad_status') {
      const adState = await gateway.adGroupAdMutationState(client.googleCustomerId, input.adGroupId, input.adId)
      if (adState.campaignId !== BigInt(input.campaignId).toString()) throw new Error('L’annonce ne correspond pas à la campagne transmise.')
      const validation = await gateway.mutateAdGroupAdStatus(client.googleCustomerId, adState.resourceName, input.status, true)
      requestId = validation.requestId
      payload = {
        campaignId: input.campaignId,
        adGroupId: input.adGroupId,
        adId: input.adId,
        resourceName: adState.resourceName,
        status: input.status,
      }
      resourceName = adState.resourceName
      expectedState = adState
      proposedState = { ...adState, status: input.status }
      title = `${input.status === 'PAUSED' ? 'Suspendre' : 'Réactiver'} l’annonce ${input.adId} de « ${input.campaignName} »`
    } else if (input.kind === 'rsa_create_draft') {
      const draft = parseRsaAssets(input)
      const draftState = await gateway.rsaDraftState(client.googleCustomerId, input.adGroupId, {
        headlines: draft.headlines,
        descriptions: draft.descriptions,
        finalUrls: [draft.finalUrl],
      })
      if (draftState.campaignId !== BigInt(input.campaignId).toString()) throw new Error('Le groupe d’annonces ne correspond pas à la campagne transmise.')
      if (draftState.matches.length) throw new Error('Une annonce RSA identique existe déjà dans ce groupe d’annonces.')
      const validation = await gateway.mutateRsaDraft(client.googleCustomerId, input.adGroupId, draft, true)
      requestId = validation.requestId
      payload = { campaignId: input.campaignId, adGroupId: input.adGroupId, ...draft }
      resourceName = draftState.adGroupResourceName
      expectedState = draftState
      proposedState = { ...draftState, matches: [{ ...draftState.normalizedDraft, status: 'PAUSED' }] }
      title = `Créer un draft RSA en pause dans « ${input.adGroupName} »`
    } else {
      throw new Error('Type de changement non pris en charge.')
    }

    const conflicts = mutationConflicts(input.kind, expectedState, proposedState)
    const blockingConflict = conflicts.find((conflict) => conflict.severity === 'blocking')
    if (blockingConflict) throw new Error(blockingConflict.message)
    const impactPreview = buildMutationImpactPreview({
      kind: input.kind,
      expectedState,
      proposedState,
      conflicts,
      summary: title,
      atomic: previewAtomic ?? input.kind === 'budget_reallocation',
      operationCount: previewOperationCount ?? (input.kind === 'budget_reallocation' ? 2 : 1),
    })

    await createGoogleApprovalRequest({
      workspaceId: workspace.id,
      actorUserId: session.userId,
      clientId: client.id,
      kind: input.kind,
      title,
      payload,
      resourceName,
      expectedState,
      proposedState,
      impactPreview,
      observationWindowDays: impactPreview.observationWindowDays,
      requiredApprovals: workspace.requiredApprovals,
      validationRequestId: requestId,
    })
    target = toUrl('/approvals', 'notice', 'Changement validé par Google et ajouté aux approbations.')
  } catch (error) {
    target = toUrl('/dashboard', 'error', message(error))
  }
  revalidatePath('/approvals')
  redirect(target)
}

export async function requestAtomicGoogleAdsBatch(formData: FormData) {
  let target: string
  try {
    const { workspace, session, entitlements } = await requireWorkspacePermission('google:propose')
    requireCapability(entitlements, 'google.mutate.advanced')
    requireGoogleMutationKind('atomic_change_batch')
    if (entitlements.plan !== 'agency' && entitlements.plan !== 'internal') {
      throw new Error('Les batches atomiques multi-opérations sont réservés au plan Agency.')
    }
    const approvalIds = [...new Set(formData.getAll('approvalId').map(String))].sort()
    z.array(z.string().uuid()).min(2).max(20).parse(approvalIds)

    const sources = await loadAtomicGoogleApprovalSources({
      workspaceId: workspace.id,
      actorUserId: session.userId,
      approvalIds,
    })

    const client = await getWorkspaceClient(workspace.id, sources[0].clientId)
    const connection = await getWorkspaceConnection(workspace.id)
    if (!client || !connection) throw new Error('Le compte ou sa connexion Google Ads est introuvable.')
    const gateway = new GoogleAdsGateway(connection)
    const storedSources = sources.map((source) => storedAtomicBatchSourceSchema.parse({
      id: source.id,
      kind: source.kind,
      resourceName: source.resourceName,
      payload: source.payload,
    }))
    const currentSources = await Promise.all(storedSources.map((source) => currentAtomicBatchSource(gateway, client.googleCustomerId, source)))
    for (const [index, source] of sources.entries()) {
      if (!source.expectedStateHash || stateHash(currentSources[index].expectedState!) !== source.expectedStateHash) {
        throw new Error(`La proposition « ${source.title} » a dérivé dans Google Ads et doit être recréée.`)
      }
    }
    const batchSources: AtomicBatchSource[] = sources.map((source) => ({
      id: source.id,
      kind: source.kind,
      resourceName: source.resourceName,
      payload: source.payload,
      expectedState: source.expectedState,
      proposedState: source.proposedState,
    }))
    const operations = batchSources.map(atomicOperationFromApproval)
    await Promise.all(operations.flatMap((operation, index) => operation.kind === 'campaign_budget'
      ? [assertBudgetChangeSafety({
          workspace,
          client,
          campaignId: operation.campaignId,
          currentBudgetMicros: String(currentSources[index].expectedState?.amountMicros ?? ''),
          proposedBudgetMicros: operation.amountMicros,
        })]
      : []))
    const validation = await gateway.mutateAtomicBatch(client.googleCustomerId, operations, true)
    const expectedState = atomicChangeBatchState(batchSources, 'expectedState')
    const proposedState = atomicChangeBatchState(batchSources, 'proposedState')
    const sourcePreviews = sources.map((source) => source.impactPreview ?? buildMutationImpactPreview({
      kind: source.kind,
      expectedState: source.expectedState ?? {},
      proposedState: source.proposedState ?? {},
      summary: source.title,
    })) as MutationImpactPreview[]
    const title = `${sources.length} changements atomiques pour « ${client.name} »`
    const impactPreview = mergeAtomicImpactPreviews(sourcePreviews, title)

    await createAtomicGoogleApprovalBatch({
      workspaceId: workspace.id,
      actorUserId: session.userId,
      clientId: client.id,
      kind: 'atomic_change_batch',
      title,
      payload: { campaignId: operations[0].campaignId, operations, sources: storedSources },
      resourceName: `atomic-change-batch:${operations.map((operation) => operation.resourceName).join('|')}`,
      expectedState,
      proposedState,
      impactPreview,
      observationWindowDays: impactPreview.observationWindowDays,
      requiredApprovals: workspace.requiredApprovals,
      validationRequestId: validation.requestId,
      sourceApprovalIds: approvalIds,
      operationCount: operations.length,
    })
    target = toUrl('/approvals', 'notice', 'Batch validé par Google et ajouté aux approbations.')
  } catch (error) {
    target = toUrl('/approvals', 'error', message(error))
  }
  revalidatePath('/approvals')
  redirect(target)
}

export async function approveGoogleAdsChange(formData: FormData) {
  let target: string
  let claimedId: string | undefined
  let executionId: string | undefined
  let mutationSubmitted = false
  let workspaceId: string | undefined
  let actorUserId: string | undefined
  try {
    requireWritableProduct()
    const { workspace, session, entitlements } = await requireWorkspacePermission('google:approve')
    workspaceId = workspace.id
    actorUserId = session.userId
    requireCapability(entitlements, 'google.mutate.basic')
    if (!workspace.mutationsEnabled) throw new Error('Les mutations sont désactivées pour cet espace.')
    const approvalId = z.string().uuid().parse(formData.get('approvalId'))
    const claimResult = await voteAndClaimGoogleApproval({
      workspaceId: workspace.id,
      actorUserId: session.userId,
      approvalId,
      allowSelfApproval: workspace.allowSelfApproval,
      assertKindAllowed: (kind) => {
        requireGoogleMutationKind(kind)
        const basicChange = kind === 'campaign_status' || kind === 'campaign_budget'
        requireCapability(entitlements, basicChange ? 'google.mutate.basic' : 'google.mutate.advanced')
        if ((kind === 'budget_reallocation' || kind === 'atomic_change_batch') && entitlements.plan !== 'agency' && entitlements.plan !== 'internal') {
          throw new Error('Le batch atomique de réallocation est réservé au plan Agency.')
        }
      },
    })
    if (claimResult.outcome === 'expired') throw new Error('Cette demande a expiré.')
    if (claimResult.outcome === 'waiting') throw new ApprovalVotePendingError(claimResult.message)
    const claimed = claimResult.claimed
    claimedId = claimed.id

    const client = await getWorkspaceClient(workspace.id, claimed.clientId)
    const connection = await getWorkspaceConnection(workspace.id)
    if (!client || !connection) throw new Error('Le compte ou sa connexion Google Ads est introuvable.')
    const gateway = new GoogleAdsGateway(connection)
    const payloadBase = z.object({ campaignId: z.string() }).parse(claimed.payload)
    const currentCampaign = await gateway.campaignMutationState(client.googleCustomerId, payloadBase.campaignId)
    let actualState: Record<string, unknown>
    let atomicCurrentSources: AtomicBatchSource[] | undefined
    let keywordCreationContext: KeywordCreationContext | undefined
    if (claimed.kind === 'campaign_status') {
      actualState = { resourceName: currentCampaign.campaignResourceName, status: currentCampaign.status }
    } else if (claimed.kind === 'campaign_budget') {
      actualState = {
        resourceName: currentCampaign.budgetResourceName,
        amountMicros: currentCampaign.budgetMicros,
        explicitlyShared: currentCampaign.budgetExplicitlyShared,
        referenceCount: currentCampaign.budgetReferenceCount,
      }
    } else if (claimed.kind === 'budget_reallocation') {
      const payload = z.object({ changes: z.array(z.object({ campaignId: z.string() })).min(2).max(50) }).parse(claimed.payload)
      const states = await Promise.all(payload.changes.map((change, index) => index === 0
        ? Promise.resolve(currentCampaign)
        : gateway.campaignMutationState(client.googleCustomerId, change.campaignId)))
      actualState = atomicBudgetState(states)
    } else if (claimed.kind === 'atomic_change_batch') {
      const payload = z.object({ sources: z.array(storedAtomicBatchSourceSchema).min(2).max(20) }).parse(claimed.payload)
      atomicCurrentSources = await Promise.all(payload.sources.map((source) => currentAtomicBatchSource(gateway, client.googleCustomerId, source)))
      actualState = atomicChangeBatchState(atomicCurrentSources, 'expectedState')
    } else if (claimed.kind === 'keyword_create_negative' || claimed.kind === 'keyword_create_positive') {
      const payload = keywordCreationPayloadSchema.parse(claimed.payload)
      keywordCreationContext = await currentKeywordCreationContext(gateway, client.googleCustomerId, payload)
      actualState = keywordCreationContext.approvalState
    } else if (claimed.kind === 'keyword_status') {
      const payload = z.object({ adGroupId: z.string(), criterionId: z.string() }).parse(claimed.payload)
      actualState = await gateway.keywordCriterionState(client.googleCustomerId, payload.adGroupId, payload.criterionId)
    } else if (claimed.kind === 'ad_status') {
      const payload = z.object({ adGroupId: z.string(), adId: z.string() }).parse(claimed.payload)
      actualState = await gateway.adGroupAdMutationState(client.googleCustomerId, payload.adGroupId, payload.adId)
    } else if (claimed.kind === 'rsa_create_draft') {
      const payload = z.object({ adGroupId: z.string(), headlines: z.array(z.string()), descriptions: z.array(z.string()), finalUrl: z.string() }).parse(claimed.payload)
      actualState = await gateway.rsaDraftState(client.googleCustomerId, payload.adGroupId, {
        headlines: payload.headlines,
        descriptions: payload.descriptions,
        finalUrls: [payload.finalUrl],
      })
    } else {
      throw new Error('Type de changement non pris en charge.')
    }
    if (!claimed.expectedStateHash || stateHash(actualState) !== claimed.expectedStateHash) {
      await markGoogleApprovalDrifted({ workspaceId: workspace.id, actorUserId: session.userId, approvalId: claimed.id })
      claimedId = undefined
      throw new Error('La ressource Google Ads a changé depuis la proposition. Une nouvelle proposition est requise.')
    }

    const execution = await createGoogleMutationExecution({
      workspaceId: workspace.id,
      actorUserId: session.userId,
      approvalId: claimed.id,
    })
    executionId = execution.id
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
      await markGoogleMutationSubmitted({
        workspaceId: workspace.id, actorUserId: session.userId, executionId: execution.id,
        validationRequestId: validation.requestId,
      })
      mutationSubmitted = true
      const result = await gateway.mutateCampaignStatus(client.googleCustomerId, payload.campaignId, payload.status)
      executionRequestId = result.requestId
    } else if (claimed.kind === 'campaign_budget') {
      const payload = z.object({ budgetResourceName: z.string(), amountMicros: z.string() }).parse(claimed.payload)
      await assertBudgetChangeSafety({
        workspace,
        client,
        campaignId: payloadBase.campaignId,
        currentBudgetMicros: currentCampaign.budgetMicros,
        proposedBudgetMicros: payload.amountMicros,
      })
      const validation = await gateway.validateBudget(
        client.googleCustomerId,
        payload.budgetResourceName,
        payload.amountMicros,
      )
      executionValidationRequestId = validation.requestId
      await markGoogleMutationSubmitted({
        workspaceId: workspace.id, actorUserId: session.userId, executionId: execution.id,
        validationRequestId: validation.requestId,
      })
      mutationSubmitted = true
      const result = await gateway.mutateBudget(
        client.googleCustomerId,
        payload.budgetResourceName,
        payload.amountMicros,
      )
      executionRequestId = result.requestId
    } else if (claimed.kind === 'budget_reallocation') {
      const payload = z.object({
        changes: z.array(z.object({
          campaignId: z.string(),
          budgetResourceName: z.string(),
          amountMicros: z.string(),
        })).min(2).max(50),
      }).parse(claimed.payload)
      const currentBatch = z.object({ changes: z.array(z.object({ campaignId: z.string(), amountMicros: z.string() })) }).parse(actualState)
      await Promise.all(payload.changes.map((change, index) => assertBudgetChangeSafety({
        workspace,
        client,
        campaignId: change.campaignId,
        currentBudgetMicros: currentBatch.changes[index].amountMicros,
        proposedBudgetMicros: change.amountMicros,
      })))
      const validation = await gateway.mutateBudgetBatch(client.googleCustomerId, payload.changes, true)
      executionValidationRequestId = validation.requestId
      await markGoogleMutationSubmitted({
        workspaceId: workspace.id, actorUserId: session.userId, executionId: execution.id,
        validationRequestId: validation.requestId,
      })
      mutationSubmitted = true
      const result = await gateway.mutateBudgetBatch(client.googleCustomerId, payload.changes)
      executionRequestId = result.requestId
    } else if (claimed.kind === 'atomic_change_batch') {
      const payload = z.object({ operations: z.array(atomicOperationSchema).min(2).max(20) }).parse(claimed.payload)
      if (!atomicCurrentSources) throw new Error('L’état courant du batch est indisponible.')
      await Promise.all(payload.operations.flatMap((operation) => {
        if (operation.kind !== 'campaign_budget') return []
        const source = atomicCurrentSources?.find((candidate) => candidate.resourceName === operation.resourceName)
        if (!source?.expectedState) throw new Error('Le budget courant du batch est introuvable.')
        return [assertBudgetChangeSafety({
          workspace,
          client,
          campaignId: operation.campaignId,
          currentBudgetMicros: String(source.expectedState.amountMicros ?? ''),
          proposedBudgetMicros: operation.amountMicros,
        })]
      }))
      const validation = await gateway.mutateAtomicBatch(client.googleCustomerId, payload.operations as AtomicGoogleAdsOperation[], true)
      executionValidationRequestId = validation.requestId
      await markGoogleMutationSubmitted({
        workspaceId: workspace.id, actorUserId: session.userId, executionId: execution.id,
        validationRequestId: validation.requestId,
      })
      mutationSubmitted = true
      const result = await gateway.mutateAtomicBatch(client.googleCustomerId, payload.operations as AtomicGoogleAdsOperation[])
      executionRequestId = result.requestId
    } else if (claimed.kind === 'keyword_create_negative' || claimed.kind === 'keyword_create_positive') {
      const payload = keywordCreationPayloadSchema.parse(claimed.payload)
      if (!keywordCreationContext) throw new Error('L’état courant du mot-clé est indisponible.')
      const validation = await mutateKeywordCreation(gateway, client.googleCustomerId, payload, keywordCreationContext, true)
      executionValidationRequestId = validation.requestId
      await markGoogleMutationSubmitted({
        workspaceId: workspace.id, actorUserId: session.userId, executionId: execution.id,
        validationRequestId: validation.requestId,
      })
      mutationSubmitted = true
      const result = await mutateKeywordCreation(gateway, client.googleCustomerId, payload, keywordCreationContext)
      executionRequestId = result.requestId
    } else if (claimed.kind === 'keyword_status') {
      const payload = z.object({ resourceName: z.string(), status: z.enum(['ENABLED', 'PAUSED']) }).parse(claimed.payload)
      const validation = await gateway.mutateKeywordStatus(client.googleCustomerId, payload.resourceName, payload.status, true)
      executionValidationRequestId = validation.requestId
      await markGoogleMutationSubmitted({
        workspaceId: workspace.id, actorUserId: session.userId, executionId: execution.id,
        validationRequestId: validation.requestId,
      })
      mutationSubmitted = true
      const result = await gateway.mutateKeywordStatus(client.googleCustomerId, payload.resourceName, payload.status)
      executionRequestId = result.requestId
    } else if (claimed.kind === 'ad_status') {
      const payload = z.object({ resourceName: z.string(), status: z.enum(['ENABLED', 'PAUSED']) }).parse(claimed.payload)
      const validation = await gateway.mutateAdGroupAdStatus(client.googleCustomerId, payload.resourceName, payload.status, true)
      executionValidationRequestId = validation.requestId
      await markGoogleMutationSubmitted({
        workspaceId: workspace.id, actorUserId: session.userId, executionId: execution.id,
        validationRequestId: validation.requestId,
      })
      mutationSubmitted = true
      const result = await gateway.mutateAdGroupAdStatus(client.googleCustomerId, payload.resourceName, payload.status)
      executionRequestId = result.requestId
    } else if (claimed.kind === 'rsa_create_draft') {
      const payload = z.object({ adGroupId: z.string(), headlines: z.array(z.string()), descriptions: z.array(z.string()), finalUrl: z.string() }).parse(claimed.payload)
      const validation = await gateway.mutateRsaDraft(client.googleCustomerId, payload.adGroupId, payload, true)
      executionValidationRequestId = validation.requestId
      await markGoogleMutationSubmitted({
        workspaceId: workspace.id, actorUserId: session.userId, executionId: execution.id,
        validationRequestId: validation.requestId,
      })
      mutationSubmitted = true
      const result = await gateway.mutateRsaDraft(client.googleCustomerId, payload.adGroupId, payload)
      executionRequestId = result.requestId
    } else {
      throw new Error('Type de changement non pris en charge.')
    }

    let reconciledState: Record<string, unknown>
    if (claimed.kind === 'campaign_status' || claimed.kind === 'campaign_budget') {
      const reconciled = await gateway.campaignMutationState(client.googleCustomerId, payloadBase.campaignId)
      reconciledState = claimed.kind === 'campaign_status'
        ? { resourceName: reconciled.campaignResourceName, status: reconciled.status }
        : {
            resourceName: reconciled.budgetResourceName,
            amountMicros: reconciled.budgetMicros,
            explicitlyShared: reconciled.budgetExplicitlyShared,
            referenceCount: reconciled.budgetReferenceCount,
          }
    } else if (claimed.kind === 'budget_reallocation') {
      const payload = z.object({ changes: z.array(z.object({ campaignId: z.string() })).min(2).max(50) }).parse(claimed.payload)
      const states = await Promise.all(payload.changes.map((change) => gateway.campaignMutationState(client.googleCustomerId, change.campaignId)))
      reconciledState = {
        atomic: true,
        changes: states.map((state) => ({
          campaignId: state.campaignId,
          resourceName: state.budgetResourceName,
          amountMicros: state.budgetMicros,
          explicitlyShared: state.budgetExplicitlyShared,
          referenceCount: state.budgetReferenceCount,
        })),
      }
    } else if (claimed.kind === 'atomic_change_batch') {
      const payload = z.object({ sources: z.array(storedAtomicBatchSourceSchema).min(2).max(20) }).parse(claimed.payload)
      const sources = await Promise.all(payload.sources.map((source) => currentAtomicBatchSource(gateway, client.googleCustomerId, source)))
      reconciledState = atomicChangeBatchState(sources, 'expectedState')
    } else if (claimed.kind === 'keyword_create_negative' || claimed.kind === 'keyword_create_positive') {
      const payload = keywordCreationPayloadSchema.parse(claimed.payload)
      reconciledState = (await currentKeywordCreationContext(gateway, client.googleCustomerId, payload)).approvalState
    } else if (claimed.kind === 'keyword_status') {
      const payload = z.object({ adGroupId: z.string(), criterionId: z.string() }).parse(claimed.payload)
      reconciledState = await gateway.keywordCriterionState(client.googleCustomerId, payload.adGroupId, payload.criterionId)
    } else if (claimed.kind === 'ad_status') {
      const payload = z.object({ adGroupId: z.string(), adId: z.string() }).parse(claimed.payload)
      reconciledState = await gateway.adGroupAdMutationState(client.googleCustomerId, payload.adGroupId, payload.adId)
    } else {
      const payload = z.object({ adGroupId: z.string(), headlines: z.array(z.string()), descriptions: z.array(z.string()), finalUrl: z.string() }).parse(claimed.payload)
      reconciledState = await gateway.rsaDraftState(client.googleCustomerId, payload.adGroupId, {
        headlines: payload.headlines,
        descriptions: payload.descriptions,
        finalUrls: [payload.finalUrl],
      })
    }
    const confirmed = Boolean(claimed.proposedState && stateHash(reconciledState) === stateHash(claimed.proposedState))
    const completedAt = new Date()

    await completeGoogleMutationExecution({
      workspaceId: workspace.id,
      actorUserId: session.userId,
      approval: claimed,
      client,
      executionId: execution.id,
      confirmed,
      reconciledState,
      executionRequestId,
      executionValidationRequestId,
      now: completedAt,
    })
    target = confirmed
      ? toUrl('/approvals', 'notice', 'Changement appliqué et réconcilié dans Google Ads.')
      : toUrl('/approvals', 'notice', 'Changement soumis à Google Ads. La réconciliation est en attente.')
  } catch (error) {
    if (workspaceId && actorUserId && (executionId || claimedId)) {
      const definitiveGoogleRejection = error instanceof GoogleAdsError && error.status >= 400 && error.status < 500 && error.status !== 429
      const ambiguous = mutationSubmitted && !definitiveGoogleRejection
      await failGoogleMutationExecution({
        workspaceId,
        actorUserId,
        executionId,
        approvalId: claimedId,
        ambiguous,
        errorMessage: message(error),
      })
    }
    target = error instanceof ApprovalVotePendingError
      ? toUrl('/approvals', 'notice', error.message)
      : toUrl('/approvals', 'error', message(error))
  }
  revalidatePath('/dashboard', 'layout')
  redirect(target)
}

export async function rejectGoogleAdsChange(formData: FormData) {
  let target: string
  try {
    const { workspace, session } = await requireWorkspacePermission('google:approve')
    const approvalId = z.string().uuid().parse(formData.get('approvalId'))
    await rejectGoogleApproval({ workspaceId: workspace.id, actorUserId: session.userId, approvalId })
    target = toUrl('/approvals', 'notice', 'Demande rejetée.')
  } catch (error) {
    target = toUrl('/approvals', 'error', message(error))
  }
  revalidatePath('/approvals')
  redirect(target)
}

export async function addApprovalComment(formData: FormData) {
  let target: string
  try {
    const { workspace, session } = await requireWorkspacePermission('workspace:read')
    const approvalId = z.string().uuid().parse(formData.get('approvalId'))
    const body = z.string().trim().min(2).max(2000).parse(formData.get('body'))
    await addGoogleApprovalComment({ workspaceId: workspace.id, actorUserId: session.userId, approvalId, body })
    target = toUrl('/approvals', 'notice', 'Commentaire ajouté.')
  } catch (error) {
    target = toUrl('/approvals', 'error', message(error))
  }
  revalidatePath('/approvals')
  redirect(target)
}

export async function disconnectGoogleAds() {
  let target: string
  try {
    const { workspace, session } = await requireWorkspacePermission('google:connect')
    const connection = await getWorkspaceConnection(workspace.id)
    if (!connection) throw new Error('Aucune connexion Google Ads active.')
    const revocation = await revokeGoogleRefreshToken(connection.encryptedRefreshToken)
    if (!revocation.ok) throw new Error('Google n’a pas confirmé la révocation du jeton.')
    await deleteWorkspaceGoogleConnection({
      workspaceId: workspace.id,
      actorUserId: session.userId,
      connectionId: connection.id,
      managerCustomerId: connection.managerCustomerId,
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
    'pacing_variance',
    'forecast_overrun',
  ]),
  clientId: z.union([z.literal('all'), z.string().uuid()]),
  threshold: z.coerce.number().min(0).max(1_000_000),
  reminderIntervalHours: z.preprocess(
    (value) => value === '' || value === undefined ? null : value,
    z.coerce.number().int().min(1).max(720).nullable(),
  ),
})

export async function createMonitoringAgent(formData: FormData) {
  let target: string
  try {
    const { workspace, session, entitlements } = await requireWorkspacePermission('monitoring:run')
    requireCapability(entitlements, 'monitoring')
    const input = monitoringAgentSchema.parse(Object.fromEntries(formData))
    const template = agentTemplatesForLocale(workspace.locale === 'en' ? 'en' : 'fr').find((item) => item.kind === input.kind)
    if (!template) throw new Error('Modèle de vigie inconnu.')
    if (input.clientId !== 'all') {
      const client = await getWorkspaceClient(workspace.id, input.clientId)
      if (!client || client.id !== input.clientId) throw new Error('Compte client introuvable.')
    }
    await createWorkspaceMonitoringAgent({
      workspaceId: workspace.id,
      actorUserId: session.userId,
      clientId: input.clientId === 'all' ? null : input.clientId,
      kind: input.kind,
      name: template.name,
      description: template.description,
      threshold: input.threshold,
      reminderIntervalHours: input.reminderIntervalHours,
      entitlements,
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
    const { workspace, session, entitlements } = await requireWorkspacePermission('monitoring:run')
    requireCapability(entitlements, 'monitoring')
    const id = z.string().uuid().parse(formData.get('agentId'))
    const enabled = z.enum(['true', 'false']).parse(formData.get('enabled')) === 'true'
    await setWorkspaceMonitoringAgentEnabled({ workspaceId: workspace.id, actorUserId: session.userId, agentId: id, enabled })
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
    const { workspace, session, entitlements } = await requireWorkspacePermission('monitoring:run')
    requireCapability(entitlements, 'monitoring')
    const rawId = formData.get('agentId')
    const agentId = rawId ? z.string().uuid().parse(rawId) : undefined
    const result = await runWorkspaceMonitoring(workspace.id, agentId)
    await recordWorkspaceMonitoringScan({ workspaceId: workspace.id, actorUserId: session.userId, result })
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
    const { workspace, session } = await requireWorkspacePermission('alerts:manage')
    const incidentId = z.string().uuid().parse(formData.get('incidentId'))
    await acknowledgeWorkspaceAlert({ workspaceId: workspace.id, actorUserId: session.userId, incidentId })
    target = toUrl('/alerts', 'notice', 'Alerte acquittée.')
  } catch (error) {
    target = toUrl('/alerts', 'error', message(error))
  }
  revalidatePath('/alerts')
  redirect(target)
}

const alertWorkflowSchema = z.object({
  incidentId: z.string().uuid(),
  operation: z.enum(['acknowledge', 'snooze_24h', 'resolve', 'reopen', 'assign_self', 'unassign']),
  comment: z.string().trim().max(2000).optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal('')),
})

export async function updateAlertWorkflow(formData: FormData) {
  let target: string
  try {
    const { workspace, session } = await requireWorkspacePermission('alerts:manage')
    const input = alertWorkflowSchema.parse(Object.fromEntries(formData))
    await updateWorkspaceAlertWorkflow({
      workspaceId: workspace.id,
      actorUserId: session.userId,
      incidentId: input.incidentId,
      operation: input.operation,
      comment: input.comment,
      dueDate: input.dueDate || undefined,
    })
    target = toUrl('/alerts', 'notice', 'Workflow de l’alerte mis à jour.')
  } catch (error) {
    target = toUrl('/alerts', 'error', message(error))
  }
  revalidatePath('/alerts')
  redirect(target)
}

const optionalTaskUuid = z.preprocess((value) => value === '' || value === null ? undefined : value, z.string().uuid().optional())
const optionalTaskText = (maximum: number) => z.preprocess(
  (value) => value === '' || value === null ? undefined : value,
  z.string().trim().max(maximum).optional(),
)

const createTaskSchema = z.object({
  sourceType: z.enum(['manual', 'alert', 'approval', 'report']).default('manual'),
  sourceEntityId: optionalTaskText(128),
  clientId: optionalTaskUuid,
  title: optionalTaskText(220),
  description: optionalTaskText(5000),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).default('normal'),
  dueDate: optionalTaskText(10).refine((value) => value === undefined || /^\d{4}-\d{2}-\d{2}$/.test(value), 'Date invalide.'),
  slaHours: z.preprocess((value) => value === '' || value === null ? undefined : value, z.coerce.number().int().min(1).max(24 * 365).optional()),
  assignSelf: z.preprocess((value) => value === 'on' || value === 'true', z.boolean()),
  returnTo: z.enum(['tasks', 'alerts', 'approvals']).default('tasks'),
})

export async function createWorkspaceTask(formData: FormData) {
  let target = '/tasks'
  try {
    const { workspace, session } = await requireWorkspacePermission('tasks:manage')
    const input = createTaskSchema.parse(Object.fromEntries(formData))
    await createTenantWorkspaceTask({
      workspaceId: workspace.id,
      actorUserId: session.userId,
      timezone: workspace.timezone,
      sourceType: input.sourceType,
      sourceEntityId: input.sourceEntityId,
      clientId: input.clientId,
      title: input.title,
      description: input.description,
      priority: input.priority,
      dueDate: input.dueDate,
      slaHours: input.slaHours,
      assignSelf: input.assignSelf,
    })
    target = toUrl(`/${input.returnTo}`, 'notice', 'Tâche créée.')
  } catch (error) {
    const requested = formData.get('returnTo')
    const path = requested === 'alerts' || requested === 'approvals' ? `/${requested}` : '/tasks'
    target = toUrl(path, 'error', message(error))
  }
  revalidatePath('/tasks')
  revalidatePath('/alerts')
  revalidatePath('/approvals')
  redirect(target)
}

const updateTaskSchema = z.object({
  taskId: z.string().uuid(),
  operation: z.enum(['start', 'block', 'complete', 'reopen', 'cancel', 'assign_self', 'unassign', 'update_due', 'clear_due']),
  dueDate: optionalTaskText(10).refine((value) => value === undefined || /^\d{4}-\d{2}-\d{2}$/.test(value), 'Date invalide.'),
})

export async function updateWorkspaceTask(formData: FormData) {
  let target: string
  try {
    const { workspace, session } = await requireWorkspacePermission('tasks:manage')
    const input = updateTaskSchema.parse(Object.fromEntries(formData))
    await updateTenantWorkspaceTask({
      workspaceId: workspace.id,
      actorUserId: session.userId,
      taskId: input.taskId,
      operation: input.operation,
      timezone: workspace.timezone,
      dueDate: input.dueDate,
    })
    target = toUrl('/tasks', 'notice', 'Tâche mise à jour.')
  } catch (error) {
    target = toUrl('/tasks', 'error', message(error))
  }
  revalidatePath('/tasks')
  redirect(target)
}

export async function addWorkspaceTaskComment(formData: FormData) {
  let target: string
  try {
    const { workspace, session } = await requireWorkspacePermission('tasks:comment')
    const taskId = z.string().uuid().parse(formData.get('taskId'))
    const body = z.string().trim().min(1).max(4000).parse(formData.get('body'))
    await addTenantWorkspaceTaskComment({
      workspaceId: workspace.id,
      actorUserId: session.userId,
      taskId,
      body,
      notificationsEnabled: featureEnabled('notifications'),
    })
    target = toUrl('/tasks', 'notice', 'Commentaire ajouté.')
  } catch (error) {
    target = toUrl('/tasks', 'error', message(error))
  }
  revalidatePath('/tasks')
  redirect(target)
}

export async function createShareLink(formData: FormData) {
  let target: string
  try {
    const { workspace, session, entitlements } = await requireWorkspacePermission('reports:manage')
    const clientId = z.string().uuid().parse(formData.get('clientId'))
    const label = z.string().trim().min(2).max(160).parse(formData.get('label'))
    const editorialComment = z.string().trim().max(5000).optional().parse(formData.get('editorialComment') || undefined)
    const actionPlan = z.string().trim().max(5000).optional().parse(formData.get('actionPlan') || undefined)
    const locale = z.enum(['fr', 'en']).default('fr').parse(formData.get('locale') || 'fr')
    const periodDays = z.coerce.number().int().refine((value) => [7, 30, 90].includes(value), 'Période invalide.').parse(formData.get('periodDays') || 30)
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
    target = `/reports?notice=${encodeURIComponent('Rapport créé. Révélez son URL dans les cinq prochaines minutes.')}&reveal=report-url`
  } catch (error) {
    target = toUrl('/reports', 'error', message(error))
  }
  revalidatePath('/reports')
  redirect(target)
}

export async function createReportTemplate(formData: FormData) {
  let target: string
  try {
    const { workspace, session } = await requireWorkspacePermission('reports:manage')
    const input = reportTemplateInputSchema.parse(Object.fromEntries(formData))
    await createWorkspaceReportTemplate({
      workspaceId: workspace.id,
      actorUserId: session.userId,
      ...input,
    })
    target = toUrl('/reports', 'notice', 'Modèle de rapport créé.')
  } catch (error) {
    target = toUrl('/reports', 'error', message(error))
  }
  revalidatePath('/reports')
  redirect(target)
}

const reportTemplateInputSchema = z.object({
  name: z.string().trim().min(2).max(160),
  locale: z.enum(['fr', 'en']).default('fr'),
  periodDays: z.coerce.number().int().refine((value) => [7, 30, 90].includes(value), 'Période invalide.'),
  editorialComment: z.string().trim().max(5000).optional(),
  actionPlan: z.string().trim().max(5000).optional(),
})

export async function updateReportTemplate(formData: FormData) {
  let target: string
  try {
    const { workspace, session } = await requireWorkspacePermission('reports:manage')
    const { templateId, expectedVersion, ...input } = reportTemplateInputSchema.extend({
      templateId: z.string().uuid(),
      expectedVersion: z.coerce.number().int().positive(),
    }).parse(Object.fromEntries(formData))
    await updateWorkspaceReportTemplate({
      workspaceId: workspace.id,
      actorUserId: session.userId,
      templateId,
      expectedVersion,
      ...input,
    })
    target = toUrl('/reports', 'notice', 'Nouvelle version du modèle enregistrée.')
  } catch (error) {
    target = toUrl('/reports', 'error', message(error))
  }
  revalidatePath('/reports')
  redirect(target)
}

export async function deactivateReportTemplate(formData: FormData) {
  let target: string
  try {
    const { workspace, session } = await requireWorkspacePermission('reports:manage')
    const templateId = z.string().uuid().parse(formData.get('templateId'))
    await deactivateWorkspaceReportTemplate({ workspaceId: workspace.id, actorUserId: session.userId, templateId })
    target = toUrl('/reports', 'notice', 'Modèle désactivé. Les rapports existants conservent leur snapshot.')
  } catch (error) {
    target = toUrl('/reports', 'error', message(error))
  }
  revalidatePath('/reports')
  redirect(target)
}

export async function createReportSchedule(formData: FormData) {
  let target: string
  try {
    const { workspace, session, entitlements } = await requireWorkspacePermission('reports:manage')
    const input = z.object({
      name: z.string().trim().min(2).max(160),
      clientId: z.string().uuid(),
      templateId: z.preprocess((value) => value === '' ? undefined : value, z.string().uuid().optional()),
      cadence: z.enum(['weekly', 'monthly']),
      scheduleWeekday: z.coerce.number().int().min(1).max(7).default(1),
      scheduleMonthday: z.coerce.number().int().min(1).max(28).default(1),
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
    target = toUrl('/reports', 'error', message(error))
  }
  revalidatePath('/reports')
  redirect(target)
}

export async function toggleReportSchedule(formData: FormData) {
  let target: string
  try {
    const { workspace, session, entitlements } = await requireWorkspacePermission('reports:manage')
    const scheduleId = z.string().uuid().parse(formData.get('scheduleId'))
    const enabled = z.enum(['enable', 'disable']).parse(formData.get('operation')) === 'enable'
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
    target = toUrl('/reports', 'error', message(error))
  }
  revalidatePath('/reports')
  redirect(target)
}

export async function rotateScheduledReportToken(formData: FormData) {
  let target: string
  try {
    const { workspace, session } = await requireWorkspacePermission('reports:manage')
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
    target = toUrl('/reports', 'error', message(error))
  }
  revalidatePath('/reports')
  redirect(target)
}

export async function createWorkspaceDomain(formData: FormData) {
  let target: string
  try {
    requireFeature('customDomains', 'Les domaines personnalisés sont temporairement désactivés.')
    const { workspace, session, entitlements } = await requireWorkspacePermission('workspace:admin')
    requireCapability(entitlements, 'custom_domain')
    const hostname = normalizeCustomHostname(z.string().trim().min(4).max(253).parse(formData.get('hostname')))
    const token = createDomainVerificationToken()
    const revelation = await createWorkspaceCustomDomain({ workspaceId: workspace.id, actorUserId: session.userId, hostname, token })
    const cookieStore = await cookies()
    cookieStore.set('yodev_secret_revelation', revelation.id, {
      httpOnly: true,
      sameSite: 'strict',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 10 * 60,
      path: '/api/secret-revelation',
    })
    target = `/settings?notice=${encodeURIComponent('Domaine enregistré. Publiez le TXT révélé avant de vérifier.')}&reveal=domain-dns`
  } catch (error) {
    target = toUrl('/settings', 'error', message(error))
  }
  revalidatePath('/settings')
  redirect(target)
}

export async function verifyWorkspaceDomain(formData: FormData) {
  let target: string
  try {
    requireFeature('customDomains', 'Les domaines personnalisés sont temporairement désactivés.')
    const { workspace, session, entitlements } = await requireWorkspacePermission('workspace:admin')
    requireCapability(entitlements, 'custom_domain')
    const domainId = z.string().uuid().parse(formData.get('domainId'))
    const result = await verifyWorkspaceCustomDomain({ workspaceId: workspace.id, actorUserId: session.userId, domainId })
    target = result.active
      ? toUrl('/settings', 'notice', 'Domaine vérifié, routé et actif pour les nouveaux liens de rapport.')
      : toUrl('/settings', 'notice', 'Propriété confirmée. Configurez les enregistrements indiqués puis relancez la vérification.')
  } catch (error) {
    target = toUrl('/settings', 'error', message(error))
  }
  revalidatePath('/settings')
  redirect(target)
}

export async function revokeWorkspaceDomain(formData: FormData) {
  let target: string
  try {
    requireFeature('customDomains', 'Les domaines personnalisés sont temporairement désactivés.')
    const { workspace, session, entitlements } = await requireWorkspacePermission('workspace:admin')
    requireCapability(entitlements, 'custom_domain')
    const domainId = z.string().uuid().parse(formData.get('domainId'))
    await revokeWorkspaceCustomDomain({ workspaceId: workspace.id, actorUserId: session.userId, domainId })
    target = toUrl('/settings', 'notice', 'Domaine retiré de Vercel et révoqué. Le domaine Yodev reste disponible.')
  } catch (error) {
    target = toUrl('/settings', 'error', message(error))
  }
  revalidatePath('/settings')
  redirect(target)
}

export async function revokeShareLink(formData: FormData) {
  let target: string
  try {
    const { workspace, session } = await requireWorkspacePermission('reports:manage')
    const shareId = z.string().uuid().parse(formData.get('shareId'))
    await revokeWorkspacePublicReport({ workspaceId: workspace.id, actorUserId: session.userId, shareId })
    target = toUrl('/reports', 'notice', 'Lien public révoqué immédiatement.')
  } catch (error) {
    target = toUrl('/reports', 'error', message(error))
  }
  revalidatePath('/reports')
  redirect(target)
}

export async function requestReportFeedbackOtp(formData: FormData) {
  const token = z.string().min(20).max(200).parse(formData.get('token'))
  let target = `/r/${encodeURIComponent(token)}`
  let english = false
  try {
    const email = z.string().trim().toLowerCase().email().max(254).parse(formData.get('email'))
    const requestHeaders = await headers()
    const shareResult = await getPublicShare(token, requestHeaders.get('x-forwarded-host') ?? requestHeaders.get('host'))
    if (!shareResult || !shareResult.share.allowFeedback) throw new Error('Ce rapport n’accepte pas de retours.')
    english = shareResult.share.locale === 'en'
    const ipLimit = await consumeRateLimit({ workspaceId: shareResult.share.workspaceId, namespace: 'report-otp-ip', identity: requestIp(requestHeaders), limit: 10, windowMs: 60 * 60_000 })
    if (!ipLimit.allowed) throw new Error(english ? 'Too many code requests. Try again later.' : 'Trop de demandes de code. Réessayez plus tard.')
    const tokenLimit = await consumeRateLimit({ workspaceId: shareResult.share.workspaceId, namespace: 'report-otp-token', identity: token, limit: 5, windowMs: 60 * 60_000 })
    if (!tokenLimit.allowed) throw new Error(english ? 'Too many code requests. Try again later.' : 'Trop de demandes de code. Réessayez plus tard.')
    const otp = createOtp()
    const recipient = await issuePublicReportOtp({
      workspaceId: shareResult.share.workspaceId,
      shareId: shareResult.share.id,
      email,
      otp,
    })
    await sendReportOtpEmail({ email, otp, clientName: shareResult.client.name, locale: shareResult.share.locale === 'en' ? 'en' : 'fr' })
    const cookieStore = await cookies()
    cookieStore.set('yodev_report_feedback_pending', recipient.id, {
      httpOnly: true,
      sameSite: 'strict',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 10 * 60,
      path: '/r',
    })
    target += `?notice=${encodeURIComponent(english ? 'A six-digit code has just been sent to you.' : 'Un code à six chiffres vient de vous être envoyé.')}&otp=1`
  } catch (error) {
    const errorMessage = message(error)
    target += `?error=${encodeURIComponent(english && errorMessage === 'Ce rapport n’accepte pas de retours.' ? 'This report does not accept feedback.' : errorMessage)}`
  }
  redirect(target)
}

export async function verifyReportFeedbackOtp(formData: FormData) {
  const token = z.string().min(20).max(200).parse(formData.get('token'))
  let target = `/r/${encodeURIComponent(token)}`
  let english = false
  try {
    const otp = z.string().regex(/^\d{6}$/).parse(formData.get('otp'))
    const requestHeaders = await headers()
    const shareResult = await getPublicShare(token, requestHeaders.get('x-forwarded-host') ?? requestHeaders.get('host'))
    if (!shareResult || !shareResult.share.allowFeedback) throw new Error('Rapport introuvable.')
    english = shareResult.share.locale === 'en'
    const cookieStore = await cookies()
    const recipientId = cookieStore.get('yodev_report_feedback_pending')?.value
    if (!recipientId) throw new Error(english ? 'Request a new code.' : 'Demandez un nouveau code.')
    const sessionToken = createReportFeedbackSessionToken()
    await verifyPublicReportOtp({
      workspaceId: shareResult.share.workspaceId,
      shareId: shareResult.share.id,
      recipientId,
      otp,
      sessionToken,
      english,
    })
    cookieStore.delete('yodev_report_feedback_pending')
    cookieStore.set('yodev_report_feedback_session', sessionToken, {
      httpOnly: true,
      sameSite: 'strict',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 60 * 60,
      path: '/r',
    })
    target += `?notice=${encodeURIComponent(english ? 'Email verified. You can now submit your decision.' : 'Email vérifié. Vous pouvez maintenant transmettre votre décision.')}`
  } catch (error) {
    const errorMessage = message(error)
    target += `?error=${encodeURIComponent(english && errorMessage === 'Rapport introuvable.' ? 'Report not found.' : errorMessage)}&otp=1`
  }
  redirect(target)
}

export async function submitClientApprovalFeedback(formData: FormData) {
  const token = z.string().min(20).max(200).parse(formData.get('token'))
  let target = `/r/${encodeURIComponent(token)}`
  let english = false
  try {
    const requestHeaders = await headers()
    const shareResult = await getPublicShare(token, requestHeaders.get('x-forwarded-host') ?? requestHeaders.get('host'))
    if (!shareResult || !shareResult.share.allowFeedback) throw new Error('Ce rapport n’accepte pas de retours.')
    english = shareResult.share.locale === 'en'
    const cookieStore = await cookies()
    const feedbackSession = cookieStore.get('yodev_report_feedback_session')?.value
    if (!feedbackSession) throw new Error(english ? 'Verify your email before submitting feedback.' : 'Vérifiez votre email avant de transmettre un retour.')
    const ipLimit = await consumeRateLimit({ workspaceId: shareResult.share.workspaceId, namespace: 'report-feedback-ip', identity: requestIp(requestHeaders), limit: 10, windowMs: 60 * 60_000 })
    if (!ipLimit.allowed) throw new Error(english ? 'Too many attempts. Try again later.' : 'Trop de tentatives. Réessayez plus tard.')
    const tokenLimit = await consumeRateLimit({ workspaceId: shareResult.share.workspaceId, namespace: 'report-feedback-token', identity: token, limit: 5, windowMs: 60 * 60_000 })
    if (!tokenLimit.allowed) throw new Error(english ? 'Too many attempts. Try again later.' : 'Trop de tentatives. Réessayez plus tard.')
    const input = z.object({
      approvalId: z.string().uuid(),
      authorName: z.string().trim().min(2).max(120),
      decision: z.enum(['approved', 'changes_requested']),
      comment: z.string().trim().max(2000),
    }).parse(Object.fromEntries(formData))
    await submitPublicReportFeedback({
      workspaceId: shareResult.share.workspaceId,
      shareId: shareResult.share.id,
      clientId: shareResult.share.clientId,
      sessionToken: feedbackSession,
      approvalId: input.approvalId,
      authorName: input.authorName,
      decision: input.decision,
      comment: input.comment,
      english,
    })
    target += `?notice=${encodeURIComponent(english ? 'Your feedback has been sent to the agency.' : 'Votre retour a été transmis à l’agence.')}`
  } catch (error) {
    const errorMessage = message(error)
    target += `?error=${encodeURIComponent(english && errorMessage === 'Ce rapport n’accepte pas de retours.' ? 'This report does not accept feedback.' : errorMessage)}`
  }
  revalidatePath(`/r/${token}`)
  redirect(target)
}

export async function createAgencyApiKey(formData: FormData) {
  let target: string
  try {
    const { workspace, session, entitlements } = await requireWorkspacePermission('api_keys:manage')
    requireCapability(entitlements, 'api.read')
    const name = z.string().trim().min(2).max(120).parse(formData.get('name'))
    const token = createApiToken()
    const scopes = entitlements.capabilities.has('api.propose')
      ? ['portfolio:read', 'performance:read', 'alerts:read', 'approvals:read', 'approvals:propose', 'reports:read', 'reports:write']
      : ['portfolio:read', 'performance:read', 'alerts:read', 'approvals:read', 'reports:read']
    const revelation = await createWorkspaceApiKey({
      workspaceId: workspace.id,
      actorUserId: session.userId,
      name,
      token,
      scopes,
      entitlements,
    })
    const cookieStore = await cookies()
    cookieStore.set('yodev_secret_revelation', revelation.id, {
      httpOnly: true,
      sameSite: 'strict',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 5 * 60,
      path: '/api/secret-revelation',
    })
    target = `/settings?notice=${encodeURIComponent('Clé créée. Révélez-la une seule fois dans les cinq prochaines minutes.')}&reveal=api-key`
  } catch (error) {
    target = toUrl('/settings', 'error', message(error))
  }
  revalidatePath('/settings')
  redirect(target)
}

export async function revokeAgencyApiKey(formData: FormData) {
  let target: string
  try {
    const { workspace, session } = await requireWorkspacePermission('api_keys:manage')
    const keyId = z.string().uuid().parse(formData.get('keyId'))
    await revokeWorkspaceApiKey({ workspaceId: workspace.id, actorUserId: session.userId, keyId })
    target = toUrl('/settings', 'notice', 'Clé API révoquée.')
  } catch (error) {
    target = toUrl('/settings', 'error', message(error))
  }
  revalidatePath('/settings')
  redirect(target)
}

const safetyRulesSchema = z.object({
  scope: z.enum(['workspace', 'client', 'campaign']),
  clientId: z.union([z.literal(''), z.string().uuid()]),
  campaignId: z.union([z.literal(''), z.string().regex(/^\d+$/).max(32)]),
  currencyCode: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/),
  maximumDailyBudget: z.union([z.literal(''), z.coerce.number().positive().max(10_000_000)]),
  maximumMonthlySpend: z.union([z.literal(''), z.coerce.number().positive().max(100_000_000)]),
  maximumVariationPercent: z.union([z.literal(''), z.coerce.number().positive().max(1000)]),
  notificationEmail: z.union([z.literal(''), z.string().trim().email().max(254)]),
})

export async function updateSafetyRules(formData: FormData) {
  let target: string
  try {
    const { workspace, session, entitlements } = await requireWorkspacePermission('workspace:admin')
    const input = safetyRulesSchema.parse(Object.fromEntries(formData))
    assertSafetyPolicyScope(entitlements.plan, input.scope)
    if (input.scope !== 'workspace' && !input.clientId) throw new Error('Sélectionnez le compte client concerné.')
    if (input.scope === 'campaign' && !input.campaignId) throw new Error('Saisissez l’identifiant de campagne concerné.')
    const scopedClientId = input.scope === 'workspace' ? null : input.clientId
    const scopedCampaignId = input.scope === 'campaign' ? input.campaignId : null
    const scopedClient = scopedClientId ? await getWorkspaceClient(workspace.id, scopedClientId) : null
    if (scopedClientId && (!scopedClient || scopedClient.isManager)) throw new Error('Compte client introuvable.')
    if (scopedClient && scopedClient.currencyCode !== input.currencyCode) throw new Error(`La devise de la règle doit être ${scopedClient.currencyCode} pour ce client.`)
    await saveWorkspaceSafetyPolicy({
      workspaceId: workspace.id,
      actorUserId: session.userId,
      scope: input.scope,
      clientId: scopedClientId,
      campaignId: scopedCampaignId,
      currencyCode: input.currencyCode,
      maximumDailyBudget: input.maximumDailyBudget,
      maximumMonthlySpend: input.maximumMonthlySpend,
      maximumVariationPercent: input.maximumVariationPercent,
      notificationEmail: input.notificationEmail,
    })
    target = toUrl('/settings', 'notice', 'Règles de sécurité enregistrées.')
  } catch (error) {
    target = toUrl('/settings', 'error', message(error))
  }
  revalidatePath('/settings')
  redirect(target)
}

const notificationChannelSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('email'),
    label: z.string().trim().min(2).max(120),
    destination: z.string().trim().email().max(254),
    minimumSeverity: z.enum(['warning', 'critical']),
  }),
  z.object({
    kind: z.enum(['slack', 'teams', 'webhook']),
    label: z.string().trim().min(2).max(120),
    destination: z.string().url().startsWith('https://').max(2000),
    minimumSeverity: z.enum(['warning', 'critical']),
  }),
])

export async function createNotificationChannel(formData: FormData) {
  let target: string
  try {
    const { workspace, session, entitlements } = await requireWorkspacePermission('workspace:admin')
    const input = notificationChannelSchema.parse(Object.fromEntries(formData))
    if (input.kind !== 'email') {
      requireCapability(entitlements, 'notifications.webhook')
      await assertSafeWebhookUrl(input.destination)
    }
    await createWorkspaceNotificationChannel({
      workspaceId: workspace.id,
      actorUserId: session.userId,
      kind: input.kind,
      label: input.label,
      destination: input.destination,
      minimumSeverity: input.minimumSeverity,
      entitlements,
    })
    target = toUrl('/settings', 'notice', 'Canal de notification ajouté.')
  } catch (error) {
    target = toUrl('/settings', 'error', message(error))
  }
  revalidatePath('/settings')
  redirect(target)
}

export async function disableNotificationChannel(formData: FormData) {
  let target: string
  try {
    const { workspace, session } = await requireWorkspacePermission('workspace:admin')
    const channelId = z.string().uuid().parse(formData.get('channelId'))
    await disableWorkspaceNotificationChannel({ workspaceId: workspace.id, actorUserId: session.userId, channelId })
    target = toUrl('/settings', 'notice', 'Canal désactivé.')
  } catch (error) {
    target = toUrl('/settings', 'error', message(error))
  }
  revalidatePath('/settings')
  redirect(target)
}

export async function completeTeamsNotificationConnection(formData: FormData) {
  let target: string
  try {
    const { workspace, session, entitlements } = await requireWorkspacePermission('workspace:admin')
    requireCapability(entitlements, 'notifications.webhook')
    const input = z.object({
      teamId: z.string().trim().min(1).max(128),
      channelId: z.string().trim().min(1).max(256),
    }).parse(Object.fromEntries(formData))
    const cookieStore = await cookies()
    const cookieName = 'yodev_ads_teams_session'
    const sealed = cookieStore.get(cookieName)?.value
    cookieStore.set(cookieName, '', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/settings/teams',
      expires: new Date(0),
    })
    if (!sealed) throw new Error('La session OAuth Teams a expiré. Relancez la connexion.')
    const state = openOAuthState(sealed, 'teams')
    const sessionId = state.payload.sessionId
    if (state.workspaceId !== workspace.id || state.userId !== session.userId || !sessionId) {
      throw new Error('La vérification de sécurité OAuth Teams a échoué.')
    }
    const { accessToken } = await accessTeamsOAuthSession({
      workspaceId: workspace.id,
      actorUserId: session.userId,
      sessionId,
    })
    const destination = await resolveTeamsDestination({ accessToken, ...input })
    await completeTeamsOAuthSession({
      workspaceId: workspace.id,
      actorUserId: session.userId,
      sessionId,
      entitlements,
      ...destination,
    })
    target = toUrl('/settings', 'notice', 'Microsoft Teams est connecté au canal sélectionné.')
  } catch (error) {
    target = toUrl('/settings', 'error', message(error))
  }
  revalidatePath('/settings')
  redirect(target)
}

export async function retryDeadLetterJob(formData: FormData) {
  let target: string
  try {
    const { workspace, session } = await requireWorkspacePermission('workspace:admin')
    const jobId = z.string().uuid().parse(formData.get('jobId'))
    await retryWorkspaceDeadLetterJob({ workspaceId: workspace.id, actorUserId: session.userId, jobId })
    target = toUrl('/settings', 'notice', 'Le job sera réexécuté par le prochain worker disponible.')
  } catch (error) {
    target = toUrl('/settings', 'error', message(error))
  }
  revalidatePath('/settings')
  redirect(target)
}

export async function createCheckoutSession(formData: FormData) {
  let target: string
  let reservedWorkspaceId: string | undefined
  let reservedAttemptId: string | undefined
  try {
    requireFeature('stripeCheckout', 'La souscription en ligne est temporairement désactivée.')
    const { workspace, session } = await requireWorkspacePermission('billing:manage')
    const tax = checkoutTaxConfiguration()
    const taxCopy = taxCheckoutCopy(tax.mode, workspace.locale === 'en' ? 'en' : 'fr')
    const checkoutInput = z.object({
      plan: z.string(),
      checkoutAttemptId: z.string().uuid(),
      customerType: z.enum(['individual', 'business']),
      billingEmail: z.string().trim().toLowerCase().email().max(254),
      countryCode: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/),
      acceptLegal: z.literal('on'),
      startImmediately: z.literal('on'),
    }).parse(Object.fromEntries(formData))
    requireCommercialLegalReadiness(checkoutInput.customerType)
    reservedWorkspaceId = workspace.id
    reservedAttemptId = checkoutInput.checkoutAttemptId
    const rawPlan = checkoutInput.plan
    if (!isPlanId(rawPlan)) throw new Error('Offre inconnue.')
    const plan: PlanId = rawPlan
    const price = priceIdForPlan(plan)
    if (!price) throw new Error(`Le tarif Stripe ${planCatalog[plan].name} n’est pas encore configuré.`)
    const stripe = getStripe()
    const requestHeaders = await headers()
    await reserveWorkspaceCheckout({
      workspaceId: workspace.id,
      actorUserId: session.userId,
      checkoutAttemptId: checkoutInput.checkoutAttemptId,
      customerType: checkoutInput.customerType,
      billingEmail: checkoutInput.billingEmail,
      countryCode: checkoutInput.countryCode,
      locale: workspace.locale,
      requestFingerprint: legalRequestFingerprint(requestHeaders),
    })
    let customerId = workspace.stripeCustomerId
    if (!customerId) {
      const customer = await stripe.customers.create({
        name: workspace.name,
        email: checkoutInput.billingEmail,
        address: { country: checkoutInput.countryCode },
        ...(taxCopy.invoiceFooter ? { invoice_settings: { footer: taxCopy.invoiceFooter } } : {}),
        metadata: { workspaceId: workspace.id, authOrganizationId: workspace.authOrganizationId ?? '', customerType: checkoutInput.customerType },
      }, { idempotencyKey: `customer:${workspace.id}` })
      customerId = customer.id
      await persistWorkspaceStripeCustomer({
        workspaceId: workspace.id,
        actorUserId: session.userId,
        stripeCustomerId: customerId,
      })
    } else {
      await stripe.customers.update(customerId, {
        email: checkoutInput.billingEmail,
        address: { country: checkoutInput.countryCode },
        invoice_settings: { footer: taxCopy.invoiceFooter },
        metadata: { workspaceId: workspace.id, authOrganizationId: workspace.authOrganizationId ?? '', customerType: checkoutInput.customerType },
      })
    }
    const origin = process.env.NEXT_PUBLIC_APP_URL ?? 'https://ads.yodev.fr'
    const checkout = await stripe.checkout.sessions.create({
      mode: 'subscription',
      branding_settings: {
        background_color: '#F7F5F0',
        border_style: 'rounded',
        button_color: '#19A58F',
        display_name: 'Ads by Yodev',
        font_family: 'inter',
      },
      customer: customerId,
      custom_text: { submit: { message: taxCopy.checkoutMessage } },
      integration_identifier: checkoutIntegrationIdentifier(),
      line_items: [{ price, quantity: 1 }],
      success_url: `${origin}/billing?notice=${encodeURIComponent('Abonnement activé.')}`,
      cancel_url: `${origin}/billing?error=${encodeURIComponent('Souscription annulée.')}`,
      allow_promotion_codes: true,
      automatic_tax: tax.automaticTax,
      tax_id_collection: { enabled: true },
      customer_update: { address: 'auto', name: 'auto' },
      ...(tax.mode === 'exempt_293b' ? { billing_address_collection: 'required' as const } : {}),
      client_reference_id: workspace.id,
      subscription_data: { metadata: { workspaceId: workspace.id, plan } },
      metadata: {
        workspaceId: workspace.id,
        plan,
        requestedBy: session.userId,
        termsVersion: LEGAL_VERSIONS.terms,
        privacyVersion: LEGAL_VERSIONS.privacy,
        customerType: checkoutInput.customerType,
        immediatePerformanceAccepted: 'true',
      },
    }, { idempotencyKey: `checkout:${workspace.id}:${checkoutInput.checkoutAttemptId}` })
    if (!checkout.url) throw new Error('Stripe n’a pas renvoyé d’URL de paiement.')
    target = checkout.url
  } catch (error) {
    if (reservedWorkspaceId && reservedAttemptId) {
      const workspaceId = reservedWorkspaceId
      const attemptId = reservedAttemptId
      try {
        await releaseWorkspaceCheckoutReservation({
          workspaceId,
          actorUserId: 'system:checkout-failure',
          checkoutAttemptId: attemptId,
        })
      } catch {
        // The stale reservation self-expires after 30 minutes and is also
        // cleared by a successful subscription webhook.
      }
    }
    target = toUrl('/billing', 'error', message(error))
  }
  redirect(target)
}

export async function openBillingPortal() {
  let target: string
  try {
    const { workspace } = await requireWorkspacePermission('billing:manage')
    if (!workspace.stripeCustomerId) throw new Error('Aucun client Stripe n’est associé à cet espace.')
    const origin = process.env.NEXT_PUBLIC_APP_URL ?? 'https://ads.yodev.fr'
    const session = await getStripe().billingPortal.sessions.create({
      customer: workspace.stripeCustomerId,
      return_url: `${origin}/billing`,
      ...(process.env.STRIPE_PORTAL_CONFIGURATION_ID
        ? { configuration: process.env.STRIPE_PORTAL_CONFIGURATION_ID }
        : {}),
    })
    target = session.url
  } catch (error) {
    target = toUrl('/billing', 'error', message(error))
  }
  redirect(target)
}

export async function cancelSubscriptionAtPeriodEnd() {
  let target: string
  try {
    const { workspace, session } = await requireWorkspacePermission('billing:manage')
    if (!workspace.stripeSubscriptionId || !subscriptionIsActive(workspace.subscriptionStatus)) {
      throw new Error('Aucun abonnement actif à résilier.')
    }
    const subscription = await getStripe().subscriptions.update(workspace.stripeSubscriptionId, { cancel_at_period_end: true })
    const cancellationReference = `${subscription.id}:${workspace.subscriptionCurrentPeriodEnd?.getTime() ?? 'unknown'}`
    await recordSubscriptionCancellationRequested({
      workspaceId: workspace.id,
      actorUserId: session.userId,
      subscriptionId: subscription.id,
      currentPeriodEnd: workspace.subscriptionCurrentPeriodEnd,
    })
    await enqueueJob({
      workspaceId: workspace.id,
      type: 'lifecycle.email',
      payload: {
        workspaceId: workspace.id,
        kind: 'cancellation_scheduled',
        referenceKey: cancellationReference,
        effectiveAt: workspace.subscriptionCurrentPeriodEnd?.toISOString() ?? null,
      },
      priority: 25,
      deduplicationKey: `lifecycle.email:${workspace.id}:cancellation_scheduled:${cancellationReference}`,
    })
    target = toUrl('/billing', 'notice', `Résiliation enregistrée. L’accès reste actif jusqu’au ${workspace.subscriptionCurrentPeriodEnd?.toLocaleDateString('fr-FR') ?? 'terme de la période'}.`)
  } catch (error) {
    target = toUrl('/billing', 'error', message(error))
  }
  redirect(target)
}

export async function reactivateSubscription() {
  let target: string
  try {
    const { workspace, session } = await requireWorkspacePermission('billing:manage')
    if (!workspace.stripeSubscriptionId || !subscriptionIsActive(workspace.subscriptionStatus)) throw new Error('Abonnement introuvable.')
    const subscription = await getStripe().subscriptions.retrieve(workspace.stripeSubscriptionId)
    if (!subscription.cancel_at_period_end) throw new Error('Cet abonnement n’est pas programmé pour résiliation.')
    await getStripe().subscriptions.update(workspace.stripeSubscriptionId, { cancel_at_period_end: false })
    await recordSubscriptionCancellationRevoked({ workspaceId: workspace.id, actorUserId: session.userId })
    target = toUrl('/billing', 'notice', 'Résiliation annulée. Le renouvellement reste actif.')
  } catch (error) {
    target = toUrl('/billing', 'error', message(error))
  }
  redirect(target)
}

export async function requestWorkspaceExport() {
  let target: string
  try {
    const { workspace, session } = await requireWorkspacePermission('workspace:export')
    const exportJob = await createWorkspaceExportRequest({ workspaceId: workspace.id, actorUserId: session.userId })
    await enqueueJob({
      workspaceId: workspace.id,
      type: 'workspace.export',
      payload: { workspaceId: workspace.id, exportJobId: exportJob.id },
      priority: 30,
      deduplicationKey: `workspace.export:${exportJob.id}`,
    })
    target = toUrl('/billing', 'notice', 'Export demandé. Le fichier ZIP sera disponible ici après traitement.')
  } catch (error) {
    target = toUrl('/billing', 'error', message(error))
  }
  revalidatePath('/billing')
  redirect(target)
}

export async function requestWorkspaceDeletion(formData: FormData) {
  let target: string
  try {
    const { workspace, session } = await requireWorkspacePermission('workspace:delete')
    z.literal('SUPPRIMER').parse(formData.get('confirmation'))
    if (workspace.accessState === 'internal') throw new Error('Un espace interne doit être supprimé par la procédure administrateur auditée.')
    if (workspace.accessState === 'deletion_pending') throw new Error('La suppression est déjà programmée.')
    const now = new Date()
    const purgeAt = new Date(now.getTime() + 30 * 24 * 60 * 60_000)
    const connection = await getWorkspaceConnection(workspace.id)
    let googleRevocationConfirmed = false
    if (connection) {
      try {
        googleRevocationConfirmed = (await revokeGoogleRefreshToken(connection.encryptedRefreshToken)).ok
      } catch {
        googleRevocationConfirmed = false
      }
    }

    let stripeCancellationQueued = false
    if (workspace.stripeSubscriptionId && subscriptionIsActive(workspace.subscriptionStatus)) {
      try {
        await getStripe().subscriptions.update(workspace.stripeSubscriptionId, { cancel_at_period_end: true })
      } catch {
        stripeCancellationQueued = true
      }
    }

    await markWorkspaceDeletionPending({
      workspaceId: workspace.id,
      actorUserId: session.userId,
      previousAccessState: z.enum(['internal', 'trial', 'active', 'grace', 'suspended', 'deletion_pending', 'deleted']).parse(workspace.accessState),
      googleRevocationConfirmed,
      stripeCancellationQueued,
      now,
    })
    await enqueueJob({
      workspaceId: null,
      type: 'workspace.purge',
      payload: { workspaceId: workspace.id },
      priority: 5,
      availableAt: purgeAt,
      deduplicationKey: `workspace.purge:${workspace.id}`,
    })
    await enqueueJob({
      workspaceId: workspace.id,
      type: 'lifecycle.email',
      payload: {
        workspaceId: workspace.id,
        kind: 'deletion_scheduled',
        referenceKey: now.toISOString(),
        effectiveAt: purgeAt.toISOString(),
      },
      priority: 5,
      deduplicationKey: `lifecycle.email:${workspace.id}:deletion_scheduled:${now.toISOString()}`,
    })
    if (stripeCancellationQueued && workspace.stripeSubscriptionId) {
      await enqueueJob({
        workspaceId: null,
        type: 'stripe.cancel_subscription',
        payload: { subscriptionId: workspace.stripeSubscriptionId },
        priority: 5,
        deduplicationKey: `stripe.cancel_subscription:${workspace.stripeSubscriptionId}`,
      })
    }
    target = toUrl('/billing', 'notice', `Suppression programmée au ${purgeAt.toLocaleDateString('fr-FR')}. Les accès et secrets ont été révoqués.`)
  } catch (error) {
    target = toUrl('/billing', 'error', message(error))
  }
  revalidatePath('/dashboard', 'layout')
  redirect(target)
}

export async function cancelWorkspaceDeletion() {
  let target: string
  try {
    const { workspace, session } = await requireWorkspacePermission('workspace:delete')
    if (workspace.accessState !== 'deletion_pending') throw new Error('La demande de suppression ne peut plus être annulée.')
    const request = await claimWorkspaceDeletionCancellation({ workspaceId: workspace.id, actorUserId: session.userId })
    if (workspace.stripeSubscriptionId && subscriptionIsActive(workspace.subscriptionStatus)) {
      await getStripe().subscriptions.update(workspace.stripeSubscriptionId, { cancel_at_period_end: false })
    }
    const now = new Date()
    await finalizeWorkspaceDeletionCancellation({
      workspaceId: workspace.id,
      actorUserId: session.userId,
      requestId: request.id,
      previousAccessState: z.enum(['internal', 'trial', 'active', 'grace', 'suspended', 'deletion_pending', 'deleted']).parse(request.previousAccessState),
      now,
    })
    await enqueueJob({
      workspaceId: workspace.id,
      type: 'lifecycle.email',
      payload: {
        workspaceId: workspace.id,
        kind: 'deletion_cancelled',
        referenceKey: request.id,
      },
      priority: 25,
      deduplicationKey: `lifecycle.email:${workspace.id}:deletion_cancelled:${request.id}`,
    })
    target = toUrl('/billing', 'notice', 'Suppression annulée. Reconnectez Google Ads et recréez les clés nécessaires.')
  } catch (error) {
    target = toUrl('/billing', 'error', message(error))
  }
  revalidatePath('/dashboard', 'layout')
  redirect(target)
}

const supportTicketSchema = z.object({
  subject: z.string().trim().min(4).max(220),
  category: z.enum(SUPPORT_CATEGORIES),
  priority: z.enum(SUPPORT_PRIORITIES),
  body: z.string().trim().min(10).max(8000),
})

export async function createSupportTicket(formData: FormData) {
  let target: string
  try {
    const { workspace, session } = await requireWorkspacePermission('support:contact')
    const input = supportTicketSchema.parse(Object.fromEntries(formData))
    const limit = await consumeRateLimit({
      workspaceId: workspace.id,
      namespace: 'support-ticket-create',
      identity: session.userId,
      limit: 10,
      windowMs: 60 * 60_000,
    })
    if (!limit.allowed) throw new Error(`Trop de demandes. Réessayez dans ${limit.retryAfterSeconds} secondes.`)
    await createTenantSupportTicket({
      workspaceId: workspace.id,
      actorUserId: session.userId,
      subject: input.subject,
      category: input.category,
      priority: input.priority,
      body: input.body,
    })
    target = toUrl('/support', 'notice', 'Demande transmise au support.')
  } catch (error) {
    target = toUrl('/support', 'error', message(error))
  }
  revalidatePath('/support')
  revalidatePath('/operations')
  redirect(target)
}

export async function addSupportMessage(formData: FormData) {
  let target: string
  try {
    const { workspace, session } = await requireWorkspacePermission('support:contact')
    const input = z.object({
      ticketId: z.string().uuid(),
      body: z.string().trim().min(1).max(8000),
    }).parse(Object.fromEntries(formData))
    const limit = await consumeRateLimit({
      workspaceId: workspace.id,
      namespace: 'support-ticket-message',
      identity: session.userId,
      limit: 30,
      windowMs: 60 * 60_000,
    })
    if (!limit.allowed) throw new Error(`Trop de messages. Réessayez dans ${limit.retryAfterSeconds} secondes.`)
    await addTenantSupportMessage({ workspaceId: workspace.id, actorUserId: session.userId, ...input })
    target = toUrl('/support', 'notice', 'Réponse envoyée au support.')
  } catch (error) {
    target = toUrl('/support', 'error', message(error))
  }
  revalidatePath('/support')
  revalidatePath('/operations')
  redirect(target)
}

async function requireInternalOperations() {
  const context = await requireWorkspacePermission('workspace:admin')
  if (context.workspace.accessState !== 'internal') throw new Error('Console réservée au workspace interne Yodev.')
  return context
}

export async function addInternalSupportReply(formData: FormData) {
  let target: string
  try {
    const { workspace: internalWorkspace, session } = await requireInternalOperations()
    const input = z.object({
      ticketId: z.string().uuid(),
      body: z.string().trim().min(1).max(8000),
      internal: z.preprocess((value) => value === 'on' || value === 'true', z.boolean()),
    }).parse(Object.fromEntries(formData))
    await addSystemSupportReply({
      internalWorkspaceId: internalWorkspace.id,
      actorUserId: session.userId,
      ...input,
    })
    target = toUrl('/operations', 'notice', input.internal ? 'Note interne ajoutée.' : 'Réponse envoyée au client.')
  } catch (error) {
    target = toUrl('/operations', 'error', message(error))
  }
  revalidatePath('/operations')
  revalidatePath('/support')
  redirect(target)
}

export async function updateInternalSupportTicket(formData: FormData) {
  let target: string
  try {
    const { workspace: internalWorkspace, session } = await requireInternalOperations()
    const input = z.object({
      ticketId: z.string().uuid(),
      status: z.enum(SUPPORT_STATUSES),
    }).parse(Object.fromEntries(formData))
    await updateSystemSupportTicket({
      internalWorkspaceId: internalWorkspace.id,
      actorUserId: session.userId,
      ...input,
    })
    target = toUrl('/operations', 'notice', 'Statut du ticket mis à jour.')
  } catch (error) {
    target = toUrl('/operations', 'error', message(error))
  }
  revalidatePath('/operations')
  revalidatePath('/support')
  redirect(target)
}

export async function createPlatformIncident(formData: FormData) {
  let target: string
  try {
    const { workspace, session } = await requireInternalOperations()
    const input = z.object({
      titleFr: z.string().trim().min(4).max(220),
      titleEn: z.string().trim().min(4).max(220),
      component: z.enum(PLATFORM_COMPONENTS),
      impact: z.enum(PLATFORM_IMPACTS),
      messageFr: z.string().trim().min(10).max(5000),
      messageEn: z.string().trim().min(10).max(5000),
    }).parse(Object.fromEntries(formData))
    await createSystemPlatformIncident({
      internalWorkspaceId: workspace.id,
      actorUserId: session.userId,
      ...input,
    })
    target = toUrl('/operations', 'notice', 'Incident public créé.')
  } catch (error) {
    target = toUrl('/operations', 'error', message(error))
  }
  revalidatePath('/operations')
  revalidatePath('/status')
  redirect(target)
}

export async function addPlatformIncidentUpdate(formData: FormData) {
  let target: string
  try {
    const { workspace, session } = await requireInternalOperations()
    const input = z.object({
      incidentId: z.string().uuid(),
      status: z.enum(PLATFORM_INCIDENT_STATUSES),
      messageFr: z.string().trim().min(10).max(5000),
      messageEn: z.string().trim().min(10).max(5000),
    }).parse(Object.fromEntries(formData))
    await addSystemPlatformIncidentUpdate({
      internalWorkspaceId: workspace.id,
      actorUserId: session.userId,
      ...input,
    })
    target = toUrl('/operations', 'notice', 'Mise à jour de statut publiée.')
  } catch (error) {
    target = toUrl('/operations', 'error', message(error))
  }
  revalidatePath('/operations')
  revalidatePath('/status')
  redirect(target)
}

export async function createSubprocessorChangeNotice(formData: FormData) {
  let target: string
  try {
    const { workspace, session } = await requireInternalOperations()
    const input = z.object({
      vendorName: z.string().trim().min(2).max(160),
      changeType: z.enum(SUBPROCESSOR_CHANGE_TYPES),
      summaryFr: z.string().trim().min(10).max(5000),
      summaryEn: z.string().trim().min(10).max(5000),
      effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    }).parse(Object.fromEntries(formData))
    await scheduleSubprocessorChangeNotice({
      internalWorkspaceId: workspace.id,
      actorUserId: session.userId,
      vendorName: input.vendorName,
      changeType: input.changeType,
      summaryFr: input.summaryFr,
      summaryEn: input.summaryEn,
      effectiveAt: new Date(`${input.effectiveDate}T23:59:59.999Z`),
    })
    target = toUrl('/operations', 'notice', 'Changement de sous-traitant programmé pour notification.')
  } catch (error) {
    target = toUrl('/operations', 'error', message(error))
  }
  revalidatePath('/operations')
  revalidatePath('/subprocessors')
  redirect(target)
}
