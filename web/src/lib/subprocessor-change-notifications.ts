import 'server-only'

import { and, eq, inArray, isNull } from 'drizzle-orm'
import { auditEvents, subprocessorChangeNotices, workspaces } from '@/db/schema'
import { withSystemTransaction } from '@/db/transactions'
import { enqueueJobs } from '@/lib/jobs'
import { NonRetryableJobError } from '@/lib/jobs'
import {
  SUBPROCESSOR_CHANGE_TYPES,
  subprocessorChangeEmail,
  type SubprocessorChangeType,
} from '@/lib/subprocessor-change-model'
import { verifiedAuthUserEmail } from '@/lib/auth-identities'
import { sendTransactionalEmail } from '@/lib/transactional-email'

export const SUBPROCESSOR_NOTICE_ACCESS_STATES = ['trial', 'active', 'grace', 'suspended'] as const

async function verifiedOwnerEmail(ownerUserId: string) {
  return verifiedAuthUserEmail(ownerUserId)
}

function verifiedChangeType(value: string): SubprocessorChangeType {
  if (!SUBPROCESSOR_CHANGE_TYPES.includes(value as SubprocessorChangeType)) {
    throw new NonRetryableJobError('Type de changement de sous-traitant invalide.')
  }
  return value as SubprocessorChangeType
}

export async function fanOutSubprocessorChangeNotice(noticeId: string, now = new Date()) {
  const context = await withSystemTransaction(async (db) => {
    const notice = await db.query.subprocessorChangeNotices.findFirst({
      where: eq(subprocessorChangeNotices.id, noticeId),
    })
    if (!notice) throw new NonRetryableJobError('Notification de sous-traitant introuvable.')
    if (notice.status === 'cancelled') throw new NonRetryableJobError('Notification de sous-traitant annulée.')
    if (notice.notifiedAt) return { notice, workspaceIds: [] as string[], alreadyFannedOut: true }
    const recipients = await db.select({ id: workspaces.id }).from(workspaces).where(
      inArray(workspaces.accessState, [...SUBPROCESSOR_NOTICE_ACCESS_STATES]),
    )
    return { notice, workspaceIds: recipients.map((workspace) => workspace.id), alreadyFannedOut: false }
  })
  if (context.alreadyFannedOut) return { requested: 0, created: 0, alreadyFannedOut: true }

  const queued = await enqueueJobs(context.workspaceIds.map((workspaceId) => ({
    workspaceId,
    type: 'subprocessor.notice_deliver' as const,
    payload: { noticeId, workspaceId },
    priority: 25,
    deduplicationKey: `subprocessor.notice_deliver:${noticeId}:${workspaceId}`,
  })))
  await withSystemTransaction(async (db) => {
    await db.update(subprocessorChangeNotices).set({
      status: 'completed',
      notifiedAt: now,
      updatedAt: now,
    }).where(and(
      eq(subprocessorChangeNotices.id, noticeId),
      eq(subprocessorChangeNotices.status, 'scheduled'),
      isNull(subprocessorChangeNotices.notifiedAt),
    ))
  })
  return { ...queued, alreadyFannedOut: false }
}

export async function deliverSubprocessorChangeNotice(input: { noticeId: string; workspaceId: string }) {
  const context = await withSystemTransaction(async (db) => {
    const notice = await db.query.subprocessorChangeNotices.findFirst({
      where: eq(subprocessorChangeNotices.id, input.noticeId),
    })
    const workspace = await db.query.workspaces.findFirst({
      where: and(
        eq(workspaces.id, input.workspaceId),
        inArray(workspaces.accessState, [...SUBPROCESSOR_NOTICE_ACCESS_STATES]),
      ),
    })
    return { notice, workspace }
  })
  if (!context.notice || context.notice.status === 'cancelled') {
    throw new NonRetryableJobError('Notification de sous-traitant indisponible.')
  }
  if (!context.workspace) throw new NonRetryableJobError('Workspace destinataire indisponible.')
  const recipient = context.workspace.billingEmail?.trim().toLowerCase()
    || await verifiedOwnerEmail(context.workspace.ownerUserId)
  if (!recipient) throw new NonRetryableJobError('Aucun email propriétaire vérifié pour cet espace.')

  const origin = process.env.NEXT_PUBLIC_APP_URL ?? 'https://ads.yodev.fr'
  const email = subprocessorChangeEmail({
    locale: context.workspace.locale,
    workspaceName: context.workspace.name,
    vendorName: context.notice.vendorName,
    changeType: verifiedChangeType(context.notice.changeType),
    summaryFr: context.notice.summaryFr,
    summaryEn: context.notice.summaryEn,
    effectiveAt: context.notice.effectiveAt,
    url: `${origin}/subprocessors`,
    timezone: context.workspace.timezone,
  })
  const idempotencyKey = `subprocessor:${context.notice.id}:${context.workspace.id}`
  const result = await sendTransactionalEmail({
    from: process.env.LIFECYCLE_FROM_EMAIL ?? process.env.NOTIFICATION_FROM_EMAIL ?? 'Ads by Yodev <ads@yodev.fr>',
    to: recipient,
    subject: email.subject,
    html: email.html,
    idempotencyKey,
    tag: 'subprocessor_change',
  })

  await withSystemTransaction((db) => db.insert(auditEvents).values({
    workspaceId: context.workspace!.id,
    actorUserId: 'system:subprocessor-notice',
    action: 'subprocessor.notice_delivered',
    entityType: 'subprocessor_change_notice',
    entityId: context.notice!.id,
    metadata: {
      vendorName: context.notice!.vendorName,
      changeType: context.notice!.changeType,
      effectiveAt: context.notice!.effectiveAt.toISOString(),
      providerMessageId: result.providerMessageId,
    },
  }))
  return { delivered: true, providerMessageId: result.providerMessageId }
}
