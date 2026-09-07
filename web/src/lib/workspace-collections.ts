import 'server-only'

import { and, count, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm'
import { withTenantTransaction, type DatabaseTransaction } from '@/db/transactions'
import { alertIncidents, approvalRequests, auditEvents, clients, monitoringAgents, supportTickets, workspaceTasks, approvalComments, taskComments, supportMessages, alertComments, clientApprovalFeedback, mutationObservations } from '@/db/schema'
import { cleanCollectionQuery, collectionScope, collectionWhere, collectionWindow, exactTimestamp, finishCollectionPage, invalidCollectionPage, searchPattern, COLLECTION_PAGE_SIZE, type CollectionQuery } from '@/lib/collection-pagination'
import { qualifiedMutationObservation } from '@/lib/mutation-observation'

const read = <T>(workspaceId: string, operation: (db: DatabaseTransaction) => Promise<T>) => withTenantTransaction({ workspaceId, userId: 'system:collection-read' }, operation)
const validId = (value?: string) => value && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value) ? value : undefined
export const COLLECTION_STATUSES = {
  alerts: ['open', 'reopened', 'acknowledged', 'snoozed', 'resolved'],
  approvals: ['pending', 'approved', 'executed', 'rejected', 'failed', 'expired'],
  tasks: ['open', 'todo', 'in_progress', 'blocked', 'done', 'cancelled'],
  support: ['open', 'awaiting_support', 'awaiting_customer', 'resolved', 'closed'],
} as const
function filters(kind: keyof typeof COLLECTION_STATUSES, raw: CollectionQuery) {
  const query = cleanCollectionQuery(raw)
  return { ...query, status: (COLLECTION_STATUSES[kind] as readonly string[]).includes(query.status ?? '') ? query.status : undefined, client: validId(query.client) }
}
function scope(workspaceId: string, kind: string, query: CollectionQuery, extra: Record<string, unknown> = {}) {
  const { cursor: _cursor, ...criteria } = query
  void _cursor
  return collectionScope(workspaceId, kind, { ...criteria, ...extra })
}

export type DiscussionKind = 'tasks' | 'approvals' | 'support' | 'alerts'
function discussionTables(kind: DiscussionKind) {
  if (kind === 'tasks') return { parent: workspaceTasks, child: taskComments, parentId: taskComments.taskId }
  if (kind === 'approvals') return { parent: approvalRequests, child: approvalComments, parentId: approvalComments.approvalId }
  if (kind === 'support') return { parent: supportTickets, child: supportMessages, parentId: supportMessages.ticketId }
  return { parent: alertIncidents, child: alertComments, parentId: alertComments.incidentId }
}
function discussionFields(kind: DiscussionKind) {
  const { child } = discussionTables(kind)
  return { id: child.id, body: child.body, authorUserId: child.authorUserId, createdAt: child.createdAt,
    at: exactTimestamp(child.createdAt).as('cursor_at'),
    mentions: (kind === 'tasks' ? sql<string[]>`${taskComments.mentions}` : sql<string[]>`'{}'::text[]`).as('mentions'),
    authorKind: (kind === 'support' ? sql<string>`${supportMessages.authorKind}` : sql<string>`'member'`).as('author_kind'),
  }
}
async function discussionPreviews(db: DatabaseTransaction, workspaceId: string, kind: DiscussionKind, ids: string[]) {
  const { parent, child, parentId } = discussionTables(kind)
  const recent = db.select(discussionFields(kind)).from(child).where(and(eq(child.workspaceId, workspaceId), eq(parentId, parent.id), kind === 'support' ? eq(supportMessages.internal, false) : undefined)).orderBy(desc(child.createdAt), desc(child.id)).limit(6).as('recent')
  const rows = ids.length ? await db.select({ parentId: parent.id, comment: { id: recent.id, body: recent.body, authorUserId: recent.authorUserId, createdAt: recent.createdAt, at: recent.at, mentions: recent.mentions, authorKind: recent.authorKind } }).from(parent).leftJoinLateral(recent, sql`true`).where(and(eq(parent.workspaceId, workspaceId), inArray(parent.id, ids))).orderBy(desc(recent.createdAt), desc(recent.id)) : []
  const grouped = new Map<string, NonNullable<(typeof rows)[number]['comment']>[]>()
  for (const row of rows) if (row.comment) grouped.set(row.parentId, [...(grouped.get(row.parentId) ?? []), row.comment])
  return (id: string) => ({ comments: (grouped.get(id) ?? []).slice(0, 5).reverse(), hasMoreComments: (grouped.get(id)?.length ?? 0) > 5 })
}

export async function listAuditPage(workspaceId: string, raw: CollectionQuery = {}) {
  const query = cleanCollectionQuery(raw)
  return read(workspaceId, async (db) => {
    const window = await collectionWindow(db, scope(workspaceId, 'audit', query), query, auditEvents)
    type Row = typeof auditEvents.$inferSelect & { at: string }
    if (!window) return invalidCollectionPage<Row>()
    const base = and(eq(auditEvents.workspaceId, workspaceId), validId(query.id) ? eq(auditEvents.id, query.id!) : undefined, query.q ? or(ilike(auditEvents.action, searchPattern(query.q)), ilike(auditEvents.actorUserId, searchPattern(query.q)), ilike(auditEvents.entityId, searchPattern(query.q))) : undefined)
    const [{ total }] = await db.select({ total: count() }).from(auditEvents).where(collectionWhere(base, window, false))
    const rows = await db.select({ event: auditEvents, at: exactTimestamp(auditEvents.createdAt) }).from(auditEvents).where(collectionWhere(base, window)).orderBy(desc(auditEvents.createdAt), desc(auditEvents.id)).limit(COLLECTION_PAGE_SIZE + 1)
    return finishCollectionPage(rows.map(({ event, at }) => ({ ...event, at })), total, window, (row) => row, Boolean(query.cursor))
  })
}

export async function listAlertPage(workspaceId: string, raw: CollectionQuery = {}) {
  const query = filters('alerts', raw)
  return read(workspaceId, async (db) => {
    const window = await collectionWindow(db, scope(workspaceId, 'alerts', query), query, alertIncidents)
    type Row = { incident: typeof alertIncidents.$inferSelect; client: typeof clients.$inferSelect; agent: typeof monitoringAgents.$inferSelect; at: string }
    const emptySummary = { open: 0, critical: 0, resolved: 0 }
    if (!window) return { ...invalidCollectionPage<Row>(), summary: emptySummary }
    const base = and(eq(alertIncidents.workspaceId, workspaceId), validId(query.id) ? eq(alertIncidents.id, query.id!) : undefined, query.status ? eq(alertIncidents.status, query.status) : undefined, query.client ? eq(alertIncidents.clientId, query.client) : undefined,
      query.assignee ? eq(alertIncidents.assignedTo, query.assignee) : undefined, query.severity ? eq(alertIncidents.severity, query.severity) : undefined,
      query.q ? or(ilike(alertIncidents.title, searchPattern(query.q)), ilike(alertIncidents.description, searchPattern(query.q))) : undefined)
    const [summary] = await db.select({ total: count(), open: sql<number>`count(*) filter (where ${alertIncidents.status} in ('open','reopened'))`.mapWith(Number), critical: sql<number>`count(*) filter (where ${alertIncidents.status} in ('open','reopened') and ${alertIncidents.severity}='critical')`.mapWith(Number), resolved: sql<number>`count(*) filter (where ${alertIncidents.status}='resolved')`.mapWith(Number) }).from(alertIncidents).where(collectionWhere(base, window, false))
    const rows = await db.select({ incident: alertIncidents, client: clients, agent: monitoringAgents, at: exactTimestamp(alertIncidents.createdAt) }).from(alertIncidents)
      .innerJoin(clients, and(eq(clients.id, alertIncidents.clientId), eq(clients.workspaceId, workspaceId))).innerJoin(monitoringAgents, and(eq(monitoringAgents.id, alertIncidents.agentId), eq(monitoringAgents.workspaceId, workspaceId)))
      .where(collectionWhere(base, window)).orderBy(desc(alertIncidents.createdAt), desc(alertIncidents.id)).limit(COLLECTION_PAGE_SIZE + 1)
    return { ...finishCollectionPage(rows, summary.total, window, (row) => ({ id: row.incident.id, at: row.at }), Boolean(query.cursor)), summary }
  })
}

export async function listTaskPage(workspaceId: string, raw: CollectionQuery = {}) {
  const query = filters('tasks', raw)
  return read(workspaceId, async (db) => {
    const window = await collectionWindow(db, scope(workspaceId, 'tasks', query), query, workspaceTasks)
    const previews = async (ids: string[]) => discussionPreviews(db, workspaceId, 'tasks', ids)
    type Row = { task: typeof workspaceTasks.$inferSelect; client: typeof clients.$inferSelect | null; at: string } & ReturnType<Awaited<ReturnType<typeof previews>>>
    if (!window) return { ...invalidCollectionPage<Row>(), summary: { open: 0, overdue: 0, dueSoon: 0 } }
    const base = and(eq(workspaceTasks.workspaceId, workspaceId), validId(query.id) ? eq(workspaceTasks.id, query.id!) : undefined, query.status === 'open' ? inArray(workspaceTasks.status, ['todo', 'in_progress', 'blocked']) : query.status ? eq(workspaceTasks.status, query.status) : undefined,
      query.client ? eq(workspaceTasks.clientId, query.client) : undefined, query.assignee ? eq(workspaceTasks.assignedTo, query.assignee) : undefined,
      query.q ? or(ilike(workspaceTasks.title, searchPattern(query.q)), ilike(workspaceTasks.description, searchPattern(query.q))) : undefined)
    const [summary] = await db.select({ total: count(), open: sql<number>`count(*) filter (where ${workspaceTasks.status} not in ('done','cancelled'))`.mapWith(Number), overdue: sql<number>`count(*) filter (where ${workspaceTasks.status} not in ('done','cancelled') and ${workspaceTasks.dueAt} <= now())`.mapWith(Number), dueSoon: sql<number>`count(*) filter (where ${workspaceTasks.status} not in ('done','cancelled') and ${workspaceTasks.dueAt} > now() and ${workspaceTasks.dueAt} <= now()+interval '24 hours')`.mapWith(Number) }).from(workspaceTasks).where(collectionWhere(base, window, false))
    const rows = await db.select({ task: workspaceTasks, client: clients, at: exactTimestamp(workspaceTasks.createdAt) }).from(workspaceTasks).leftJoin(clients, and(eq(clients.id, workspaceTasks.clientId), eq(clients.workspaceId, workspaceId)))
      .where(collectionWhere(base, window)).orderBy(desc(workspaceTasks.createdAt), desc(workspaceTasks.id)).limit(COLLECTION_PAGE_SIZE + 1)
    const page = finishCollectionPage(rows, summary.total, window, (row) => ({ id: row.task.id, at: row.at }), Boolean(query.cursor))
    const preview = await previews(page.items.map((row) => row.task.id))
    return { ...page, items: page.items.map((row) => ({ ...row, ...preview(row.task.id) })), summary }
  })
}

export async function listSupportPage(workspaceId: string, requestedBy: string | undefined, raw: CollectionQuery = {}) {
  const query = filters('support', raw)
  return read(workspaceId, async (db) => {
    const window = await collectionWindow(db, scope(workspaceId, 'support', query, { requestedBy }), query, supportTickets)
    const previews = async (ids: string[]) => discussionPreviews(db, workspaceId, 'support', ids)
    type Row = { ticket: typeof supportTickets.$inferSelect; at: string; messages: ReturnType<Awaited<ReturnType<typeof previews>>>['comments']; hasMoreComments: boolean }
    if (!window) return { ...invalidCollectionPage<Row>(), open: 0 }
    const base = and(eq(supportTickets.workspaceId, workspaceId), validId(query.id) ? eq(supportTickets.id, query.id!) : undefined, requestedBy ? eq(supportTickets.requestedBy, requestedBy) : undefined, query.status ? eq(supportTickets.status, query.status) : undefined, query.q ? ilike(supportTickets.subject, searchPattern(query.q)) : undefined)
    const [summary] = await db.select({ total: count(), open: sql<number>`count(*) filter (where ${supportTickets.status} not in ('resolved','closed'))`.mapWith(Number) }).from(supportTickets).where(collectionWhere(base, window, false))
    const rows = await db.select({ ticket: supportTickets, at: exactTimestamp(supportTickets.createdAt) }).from(supportTickets).where(collectionWhere(base, window)).orderBy(desc(supportTickets.createdAt), desc(supportTickets.id)).limit(COLLECTION_PAGE_SIZE + 1)
    const page = finishCollectionPage(rows, summary.total, window, (row) => ({ id: row.ticket.id, at: row.at }), Boolean(query.cursor))
    const preview = await previews(page.items.map((row) => row.ticket.id))
    return { ...page, items: page.items.map((row) => { const value = preview(row.ticket.id); return { ...row, messages: value.comments, hasMoreComments: value.hasMoreComments } }), open: summary.open }
  })
}

export async function listApprovalPage(workspaceId: string, raw: CollectionQuery = {}) {
  const query = filters('approvals', raw)
  return read(workspaceId, async (db) => {
    const window = await collectionWindow(db, scope(workspaceId, 'approvals', query), query, approvalRequests)
    const previews = async (ids: string[]) => discussionPreviews(db, workspaceId, 'approvals', ids)
    type Row = { request: typeof approvalRequests.$inferSelect; client: typeof clients.$inferSelect; at: string; clientFeedback?: typeof clientApprovalFeedback.$inferSelect; observation?: typeof mutationObservations.$inferSelect } & ReturnType<Awaited<ReturnType<typeof previews>>>
    if (!window) return invalidCollectionPage<Row>()
    const base = and(eq(approvalRequests.workspaceId, workspaceId), validId(query.id) ? eq(approvalRequests.id, query.id!) : undefined, query.status ? eq(approvalRequests.status, query.status) : undefined, query.client ? eq(approvalRequests.clientId, query.client) : undefined,
      query.q ? or(ilike(approvalRequests.title, searchPattern(query.q)), ilike(approvalRequests.kind, searchPattern(query.q))) : undefined)
    const [{ total }] = await db.select({ total: count() }).from(approvalRequests).where(collectionWhere(base, window, false))
    const rows = await db.select({ request: approvalRequests, client: clients, at: exactTimestamp(approvalRequests.createdAt) }).from(approvalRequests).innerJoin(clients, and(eq(clients.id, approvalRequests.clientId), eq(clients.workspaceId, workspaceId)))
      .where(collectionWhere(base, window)).orderBy(desc(approvalRequests.createdAt), desc(approvalRequests.id)).limit(COLLECTION_PAGE_SIZE + 1)
    const page = finishCollectionPage(rows, total, window, (row) => ({ id: row.request.id, at: row.at }), Boolean(query.cursor)), ids = page.items.map((row) => row.request.id)
    const preview = await previews(ids)
    const feedback = ids.length ? await db.selectDistinctOn([clientApprovalFeedback.approvalId]).from(clientApprovalFeedback).where(and(eq(clientApprovalFeedback.workspaceId, workspaceId), inArray(clientApprovalFeedback.approvalId, ids))).orderBy(clientApprovalFeedback.approvalId, desc(clientApprovalFeedback.createdAt), desc(clientApprovalFeedback.id)) : []
    const observations = ids.length ? await db.selectDistinctOn([mutationObservations.approvalId]).from(mutationObservations).where(and(eq(mutationObservations.workspaceId, workspaceId), inArray(mutationObservations.approvalId, ids))).orderBy(mutationObservations.approvalId, desc(mutationObservations.createdAt), desc(mutationObservations.id)) : []
    return { ...page, items: page.items.map((row) => { const observation = observations.find((item) => item.approvalId === row.request.id); return { ...row, ...preview(row.request.id), clientFeedback: feedback.find((item) => item.approvalId === row.request.id), observation: observation ? qualifiedMutationObservation(observation) : undefined } }) }
  })
}

export async function listDiscussionPage(workspaceId: string, kind: DiscussionKind, id: string, requestedBy?: string, raw: CollectionQuery = {}) {
  if (!validId(id)) return null
  const query = cleanCollectionQuery(raw), { parent, child, parentId } = discussionTables(kind)
  return read(workspaceId, async (db) => {
    const title = kind === 'support' ? supportTickets.subject : kind === 'tasks' ? workspaceTasks.title : kind === 'approvals' ? approvalRequests.title : alertIncidents.title
    const [record] = await db.select({ id: parent.id, title }).from(parent).where(and(eq(parent.workspaceId, workspaceId), eq(parent.id, id), kind === 'support' && requestedBy ? eq(supportTickets.requestedBy, requestedBy) : undefined)).limit(1)
    if (!record) return null
    const window = await collectionWindow(db, scope(workspaceId, `discussion:${kind}`, query, { parentId: id, requestedBy }), query, child)
    const selected = discussionFields(kind)
    if (!window) return { record, ...invalidCollectionPage<{ id: string; body: string; authorUserId: string; createdAt: Date; at: string; mentions: string[]; authorKind: string }>() }
    const base = and(eq(child.workspaceId, workspaceId), eq(parentId, id), kind === 'support' ? eq(supportMessages.internal, false) : undefined, query.q ? ilike(child.body, searchPattern(query.q)) : undefined)
    const [{ total }] = await db.select({ total: count() }).from(child).where(collectionWhere(base, window, false))
    const rows = await db.select(selected).from(child).where(collectionWhere(base, window)).orderBy(desc(child.createdAt), desc(child.id)).limit(COLLECTION_PAGE_SIZE + 1)
    return { record, ...finishCollectionPage(rows, total, window, (row) => row, Boolean(query.cursor)) }
  })
}
