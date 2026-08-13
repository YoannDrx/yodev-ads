import 'server-only'

import { desc, inArray } from 'drizzle-orm'
import { auditEvents, subprocessorChangeNotices } from '@/db/schema'
import { withSystemTransaction } from '@/db/transactions'
import {
  assertSubprocessorNoticePeriod,
  type SubprocessorChangeType,
} from '@/lib/subprocessor-change-model'

export function scheduleSubprocessorChangeNotice(input: {
  internalWorkspaceId: string
  actorUserId: string
  vendorName: string
  changeType: SubprocessorChangeType
  summaryFr: string
  summaryEn: string
  effectiveAt: Date
  now?: Date
}) {
  const now = input.now ?? new Date()
  assertSubprocessorNoticePeriod(input.effectiveAt, now)
  return withSystemTransaction(async (db) => {
    const [notice] = await db.insert(subprocessorChangeNotices).values({
      createdBy: input.actorUserId,
      vendorName: input.vendorName,
      changeType: input.changeType,
      summaryFr: input.summaryFr,
      summaryEn: input.summaryEn,
      effectiveAt: input.effectiveAt,
      createdAt: now,
      updatedAt: now,
    }).returning({ id: subprocessorChangeNotices.id })
    if (!notice) throw new Error('La programmation du changement de sous-traitant a échoué.')
    await db.insert(auditEvents).values({
      workspaceId: input.internalWorkspaceId,
      actorUserId: input.actorUserId,
      action: 'subprocessor.notice_scheduled',
      entityType: 'subprocessor_change_notice',
      entityId: notice.id,
      metadata: {
        vendorName: input.vendorName,
        changeType: input.changeType,
        effectiveAt: input.effectiveAt.toISOString(),
      },
    })
    return notice
  })
}

export function getPublishedSubprocessorChangeNotices() {
  return withSystemTransaction((db) => db.query.subprocessorChangeNotices.findMany({
    where: inArray(subprocessorChangeNotices.status, ['scheduled', 'completed']),
    orderBy: [desc(subprocessorChangeNotices.createdAt)],
    limit: 20,
    columns: {
      id: true,
      vendorName: true,
      changeType: true,
      summaryFr: true,
      summaryEn: true,
      effectiveAt: true,
    },
  }))
}
