import 'server-only'

import { and, count, eq, gt, isNotNull, isNull, sql } from 'drizzle-orm'
import {
  approvalRequests,
  auditEvents,
  clientApprovalFeedback,
  reportRecipients,
  reportSchedules,
  secretRevelations,
  shareLinks,
  workspaceDomains,
} from '@/db/schema'
import { withTenantTransaction } from '@/db/transactions'
import { insertActivationMilestone } from '@/lib/activation'
import { encryptSecret } from '@/lib/crypto'
import { requireQuota, type EntitlementContext } from '@/lib/entitlements'
import { hashOtp, hashToken } from '@/lib/tokens'
import { lockWorkspaceEntitlements } from '@/lib/workspace-transaction-guard'

type ActorContext = { workspaceId: string; actorUserId: string }

export function createWorkspacePublicReport(input: ActorContext & {
  clientId: string
  label: string
  editorialComment?: string
  actionPlan?: string
  locale: 'fr' | 'en'
  periodDays: number
  token: string
  entitlements: EntitlementContext
  fallbackOrigin: string
  now?: Date
}) {
  const now = input.now ?? new Date()
  return withTenantTransaction({ workspaceId: input.workspaceId, userId: input.actorUserId }, async (transaction) => {
    const entitlements = await lockWorkspaceEntitlements(transaction, input.workspaceId, 'monitoring')
    await transaction.execute(sql`select pg_advisory_xact_lock(hashtext(${`${input.workspaceId}:reports`}))`)
    const [usage] = await transaction.select({ count: count() }).from(shareLinks).where(and(
      eq(shareLinks.workspaceId, input.workspaceId), eq(shareLinks.active, true),
    ))
    requireQuota(entitlements, 'reports', usage.count)
    const [share] = await transaction.insert(shareLinks).values({
      workspaceId: input.workspaceId,
      clientId: input.clientId,
      createdBy: input.actorUserId,
      label: input.label,
      editorialComment: input.editorialComment || null,
      actionPlan: input.actionPlan || null,
      locale: input.locale,
      periodDays: input.periodDays,
      tokenHash: hashToken(input.token),
      tokenPrefix: input.token.slice(0, 12),
      expiresAt: new Date(now.getTime() + 90 * 24 * 60 * 60_000),
    }).returning({ id: shareLinks.id })
    if (!share) throw new Error('La création du rapport a échoué.')
    await transaction.insert(auditEvents).values({
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      action: 'report.link_created',
      entityType: 'share_link',
      entityId: share.id,
      metadata: { clientId: input.clientId, locale: input.locale, periodDays: input.periodDays },
    })
    await insertActivationMilestone(transaction, {
      workspaceId: input.workspaceId,
      milestone: 'first_report',
      actorUserId: input.actorUserId,
      sourceEntityId: share.id,
    })
    const customDomain = entitlements.capabilities.has('custom_domain')
      ? await transaction.query.workspaceDomains.findFirst({
          where: and(
            eq(workspaceDomains.workspaceId, input.workspaceId),
            eq(workspaceDomains.verificationStatus, 'active'),
            isNull(workspaceDomains.revokedAt),
          ),
        })
      : undefined
    const origin = customDomain ? `https://${customDomain.hostname}` : input.fallbackOrigin
    const [revelation] = await transaction.insert(secretRevelations).values({
      workspaceId: input.workspaceId,
      userId: input.actorUserId,
      kind: 'report_url',
      encryptedSecret: encryptSecret(`${origin}/r/${input.token}`),
      expiresAt: new Date(now.getTime() + 5 * 60_000),
    }).returning({ id: secretRevelations.id })
    if (!revelation) throw new Error('La révélation one-shot du rapport a échoué.')
    return revelation
  })
}

export function revokeWorkspacePublicReport(input: ActorContext & { shareId: string; now?: Date }) {
  const now = input.now ?? new Date()
  return withTenantTransaction({ workspaceId: input.workspaceId, userId: input.actorUserId }, async (db) => {
    const schedule = await db.query.reportSchedules.findFirst({
      where: and(eq(reportSchedules.workspaceId, input.workspaceId), eq(reportSchedules.shareId, input.shareId)),
    })
    if (schedule?.deliveryLeaseUntil && schedule.deliveryLeaseUntil > now) throw new Error('Un envoi est en cours. Réessayez dans quelques minutes.')
    const [share] = await db.update(shareLinks).set({ active: false, expiresAt: now, updatedAt: now }).where(and(
      eq(shareLinks.id, input.shareId), eq(shareLinks.workspaceId, input.workspaceId), eq(shareLinks.active, true),
    )).returning({ id: shareLinks.id })
    if (!share) throw new Error('Lien introuvable.')
    await db.update(reportSchedules).set({ enabled: false, updatedAt: now }).where(and(
      eq(reportSchedules.workspaceId, input.workspaceId), eq(reportSchedules.shareId, input.shareId),
    ))
    await db.insert(auditEvents).values({
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      action: 'report.link_revoked',
      entityType: 'share_link',
      entityId: share.id,
      metadata: {},
    })
    return share
  })
}

export function issuePublicReportOtp(input: {
  workspaceId: string
  shareId: string
  email: string
  otp: string
  now?: Date
}) {
  const now = input.now ?? new Date()
  return withTenantTransaction({ workspaceId: input.workspaceId, userId: 'public:report-otp' }, async (db) => {
    const [recipient] = await db.insert(reportRecipients).values({
      workspaceId: input.workspaceId,
      shareId: input.shareId,
      email: input.email,
      otpExpiresAt: new Date(now.getTime() + 10 * 60_000),
    }).onConflictDoUpdate({
      target: [reportRecipients.shareId, reportRecipients.email],
      set: {
        otpExpiresAt: new Date(now.getTime() + 10 * 60_000),
        otpAttemptCount: 0,
        verifiedAt: null,
        sessionTokenHash: null,
        sessionExpiresAt: null,
        updatedAt: now,
      },
    }).returning({ id: reportRecipients.id })
    if (!recipient) throw new Error('La création du code OTP a échoué.')
    await db.update(reportRecipients).set({ otpHash: hashOtp(recipient.id, input.otp), updatedAt: now }).where(and(
      eq(reportRecipients.id, recipient.id), eq(reportRecipients.workspaceId, input.workspaceId),
    ))
    await db.insert(auditEvents).values({
      workspaceId: input.workspaceId,
      actorUserId: 'public:report-otp',
      action: 'report.feedback_otp_requested',
      entityType: 'report_recipient',
      entityId: recipient.id,
      metadata: { shareId: input.shareId },
    })
    return recipient
  })
}

export async function verifyPublicReportOtp(input: {
  workspaceId: string
  shareId: string
  recipientId: string
  otp: string
  sessionToken: string
  english: boolean
  now?: Date
}) {
  const now = input.now ?? new Date()
  const result = await withTenantTransaction({ workspaceId: input.workspaceId, userId: 'public:report-otp' }, async (db) => {
    const recipient = await db.query.reportRecipients.findFirst({
      where: and(
        eq(reportRecipients.id, input.recipientId),
        eq(reportRecipients.workspaceId, input.workspaceId),
        eq(reportRecipients.shareId, input.shareId),
        gt(reportRecipients.otpExpiresAt, now),
      ),
    })
    if (!recipient) return { verified: false as const }
    if (recipient.otpAttemptCount >= 5 || recipient.otpHash !== hashOtp(input.recipientId, input.otp)) {
      await db.update(reportRecipients).set({
        otpAttemptCount: sql`${reportRecipients.otpAttemptCount} + 1`, updatedAt: now,
      }).where(and(eq(reportRecipients.id, recipient.id), eq(reportRecipients.workspaceId, input.workspaceId)))
      return { verified: false as const }
    }
    await db.update(reportRecipients).set({
      otpHash: null,
      otpExpiresAt: null,
      verifiedAt: now,
      sessionTokenHash: hashToken(input.sessionToken),
      sessionExpiresAt: new Date(now.getTime() + 60 * 60_000),
      updatedAt: now,
    }).where(and(eq(reportRecipients.id, recipient.id), eq(reportRecipients.workspaceId, input.workspaceId)))
    await db.insert(auditEvents).values({
      workspaceId: input.workspaceId,
      actorUserId: `report-recipient:${recipient.id}`,
      action: 'report.feedback_email_verified',
      entityType: 'report_recipient',
      entityId: recipient.id,
      metadata: { shareId: input.shareId },
    })
    return { verified: true as const, recipientId: recipient.id }
  })
  if (!result.verified) throw new Error(input.english ? 'Incorrect or expired code.' : 'Code incorrect ou expiré.')
  return result
}

export function submitPublicReportFeedback(input: {
  workspaceId: string
  shareId: string
  clientId: string
  sessionToken: string
  approvalId: string
  authorName: string
  decision: 'approved' | 'changes_requested'
  comment: string
  english: boolean
  now?: Date
}) {
  const now = input.now ?? new Date()
  return withTenantTransaction({ workspaceId: input.workspaceId, userId: 'public:report-feedback' }, async (db) => {
    const recipient = await db.query.reportRecipients.findFirst({
      where: and(
        eq(reportRecipients.workspaceId, input.workspaceId),
        eq(reportRecipients.shareId, input.shareId),
        eq(reportRecipients.sessionTokenHash, hashToken(input.sessionToken)),
        isNotNull(reportRecipients.verifiedAt),
        gt(reportRecipients.sessionExpiresAt, now),
      ),
    })
    if (!recipient) throw new Error(input.english
      ? 'Your verification has expired. Request a new code.'
      : 'Votre vérification a expiré. Demandez un nouveau code.')
    const approval = await db.query.approvalRequests.findFirst({
      where: and(
        eq(approvalRequests.id, input.approvalId),
        eq(approvalRequests.workspaceId, input.workspaceId),
        eq(approvalRequests.clientId, input.clientId),
        eq(approvalRequests.status, 'pending'),
      ),
    })
    if (!approval) throw new Error(input.english
      ? 'This proposal is no longer pending.'
      : 'Cette proposition n’est plus en attente.')
    await db.insert(clientApprovalFeedback).values({
      workspaceId: input.workspaceId,
      shareId: input.shareId,
      approvalId: approval.id,
      authorName: input.authorName,
      decision: input.decision,
      comment: input.comment || null,
    }).onConflictDoUpdate({
      target: [clientApprovalFeedback.shareId, clientApprovalFeedback.approvalId],
      set: { authorName: input.authorName, decision: input.decision, comment: input.comment || null, updatedAt: now },
    })
    await db.insert(auditEvents).values({
      workspaceId: input.workspaceId,
      actorUserId: `report-recipient:${recipient.id}`,
      action: 'approval.client_feedback_received',
      entityType: 'approval_request',
      entityId: approval.id,
      metadata: { decision: input.decision, shareId: input.shareId },
    })
    await db.update(reportRecipients).set({ decision: input.decision, decisionAt: now, updatedAt: now }).where(and(
      eq(reportRecipients.id, recipient.id), eq(reportRecipients.workspaceId, input.workspaceId),
    ))
    return { recipient, approval }
  })
}
