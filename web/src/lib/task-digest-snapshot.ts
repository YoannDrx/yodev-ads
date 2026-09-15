import 'server-only'

import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import { workspaceTasks } from '@/db/schema'
import type { DatabaseTransaction } from '@/db/transactions'

export const TASK_DIGEST_PREVIEW_LIMIT = 50

/** Count and preview share one PostgreSQL statement snapshot. */
export async function personalTaskDigestSnapshot(db: DatabaseTransaction, workspaceId: string, userId: string) {
  const rows = await db.select({ id: workspaceTasks.id, title: workspaceTasks.title, status: workspaceTasks.status, dueAt: workspaceTasks.dueAt,
    total: sql<number>`count(*) over ()`.mapWith(Number),
  }).from(workspaceTasks).where(and(eq(workspaceTasks.workspaceId, workspaceId), eq(workspaceTasks.assignedTo, userId),
    inArray(workspaceTasks.status, ['todo', 'in_progress', 'blocked'])))
    .orderBy(sql`${workspaceTasks.dueAt} asc nulls last`, asc(workspaceTasks.createdAt), asc(workspaceTasks.id)).limit(TASK_DIGEST_PREVIEW_LIMIT)
  return { total: rows[0]?.total ?? 0, tasks: rows.map(({ total: _total, ...task }) => { void _total; return task }) }
}
