import 'server-only'

import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { auditEvents, jobs, supportMessages, supportTickets } from '@/db/schema'
import { withSystemTransaction, withTenantTransaction } from '@/db/transactions'
import {
  statusAfterSupportMessage,
  SUPPORT_CATEGORIES,
  SUPPORT_PRIORITIES,
  SUPPORT_STATUSES,
  supportLifecycleDates,
  supportStatusTransition,
  type SupportStatus,
} from '@/lib/support-workflow'

type SupportActorContext = { workspaceId: string; actorUserId: string }
type SupportCategory = (typeof SUPPORT_CATEGORIES)[number]
type SupportPriority = (typeof SUPPORT_PRIORITIES)[number]

function supportEmailJob(input: {
  workspaceId: string
  ticketId: string
  messageId?: string
  kind: 'new_ticket' | 'customer_reply' | 'support_reply' | 'status_changed'
  referenceKey: string
  priority: SupportPriority
}) {
  return {
    workspaceId: input.workspaceId,
    type: 'support.email' as const,
    payload: {
      ticketId: input.ticketId,
      ...(input.messageId ? { messageId: input.messageId } : {}),
      kind: input.kind,
      referenceKey: input.referenceKey,
    },
    priority: input.priority === 'urgent' ? 10 : 40,
    deduplicationKey: `support.email:${input.ticketId}:${input.kind}:${input.referenceKey}`,
  }
}

export function createTenantSupportTicket(input: SupportActorContext & {
  subject: string
  category: SupportCategory
  priority: SupportPriority
  body: string
  now?: Date
}) {
  const now = input.now ?? new Date()
  return withTenantTransaction({ workspaceId: input.workspaceId, userId: input.actorUserId }, async (db) => {
    const [ticket] = await db.insert(supportTickets).values({
      workspaceId: input.workspaceId,
      requestedBy: input.actorUserId,
      subject: input.subject,
      category: input.category,
      priority: input.priority,
      status: 'awaiting_support',
      lastMessageAt: now,
    }).returning({ id: supportTickets.id })
    if (!ticket) throw new Error('La création de la demande de support a échoué.')
    const [message] = await db.insert(supportMessages).values({
      workspaceId: input.workspaceId,
      ticketId: ticket.id,
      authorUserId: input.actorUserId,
      authorKind: 'customer',
      body: input.body,
    }).returning({ id: supportMessages.id })
    if (!message) throw new Error('La création du message de support a échoué.')
    await db.insert(auditEvents).values({
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      action: 'support.ticket_created',
      entityType: 'support_ticket',
      entityId: ticket.id,
      metadata: { category: input.category, priority: input.priority },
    })
    await db.insert(jobs).values(supportEmailJob({
      workspaceId: input.workspaceId,
      ticketId: ticket.id,
      messageId: message.id,
      kind: 'new_ticket',
      referenceKey: message.id,
      priority: input.priority,
    })).onConflictDoNothing({ target: jobs.deduplicationKey })
    return ticket
  })
}

export function addTenantSupportMessage(input: SupportActorContext & {
  ticketId: string
  body: string
  requesterOnly?: boolean
  now?: Date
}) {
  const now = input.now ?? new Date()
  return withTenantTransaction({ workspaceId: input.workspaceId, userId: input.actorUserId }, async (db) => {
    const ticket = await db.query.supportTickets.findFirst({
      where: and(
        eq(supportTickets.id, input.ticketId),
        eq(supportTickets.workspaceId, input.workspaceId),
        input.requesterOnly ? eq(supportTickets.requestedBy, input.actorUserId) : undefined,
      ),
    })
    if (!ticket) throw new Error('Demande de support introuvable.')
    const nextStatus = statusAfterSupportMessage(z.enum(SUPPORT_STATUSES).parse(ticket.status), 'customer')
    const [message] = await db.insert(supportMessages).values({
      workspaceId: input.workspaceId,
      ticketId: ticket.id,
      authorUserId: input.actorUserId,
      authorKind: 'customer',
      body: input.body,
    }).returning({ id: supportMessages.id })
    if (!message) throw new Error('La création du message de support a échoué.')
    await db.update(supportTickets).set({
      status: nextStatus,
      lastMessageAt: now,
      resolvedAt: null,
      updatedAt: now,
    }).where(and(eq(supportTickets.id, ticket.id), eq(supportTickets.workspaceId, input.workspaceId)))
    await db.insert(auditEvents).values({
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      action: 'support.customer_replied',
      entityType: 'support_ticket',
      entityId: ticket.id,
      metadata: { previousStatus: ticket.status, status: nextStatus },
    })
    await db.insert(jobs).values(supportEmailJob({
      workspaceId: input.workspaceId,
      ticketId: ticket.id,
      messageId: message.id,
      kind: 'customer_reply',
      referenceKey: message.id,
      priority: z.enum(SUPPORT_PRIORITIES).parse(ticket.priority),
    })).onConflictDoNothing({ target: jobs.deduplicationKey })
  })
}

export function addSystemSupportReply(input: {
  internalWorkspaceId: string
  actorUserId: string
  ticketId: string
  body: string
  internal: boolean
  now?: Date
}) {
  const now = input.now ?? new Date()
  return withSystemTransaction(async (db) => {
    const ticket = await db.query.supportTickets.findFirst({ where: eq(supportTickets.id, input.ticketId) })
    if (!ticket) throw new Error('Demande de support introuvable.')
    const nextStatus = input.internal
      ? z.enum(SUPPORT_STATUSES).parse(ticket.status)
      : statusAfterSupportMessage(z.enum(SUPPORT_STATUSES).parse(ticket.status), 'support')
    const [message] = await db.insert(supportMessages).values({
      workspaceId: ticket.workspaceId,
      ticketId: ticket.id,
      authorUserId: input.actorUserId,
      authorKind: 'support',
      body: input.body,
      internal: input.internal,
    }).returning({ id: supportMessages.id })
    if (!message) throw new Error('La création du message de support a échoué.')
    await db.update(supportTickets).set({
      status: nextStatus,
      assignedTo: input.actorUserId,
      lastMessageAt: input.internal ? ticket.lastMessageAt : now,
      updatedAt: now,
    }).where(eq(supportTickets.id, ticket.id))
    await db.insert(auditEvents).values({
      workspaceId: ticket.workspaceId,
      actorUserId: input.actorUserId,
      action: input.internal ? 'support.internal_note_added' : 'support.support_replied',
      entityType: 'support_ticket',
      entityId: ticket.id,
      metadata: {
        internal: input.internal,
        previousStatus: ticket.status,
        status: nextStatus,
        internalWorkspaceId: input.internalWorkspaceId,
      },
    })
    if (!input.internal) await db.insert(jobs).values(supportEmailJob({
      workspaceId: ticket.workspaceId,
      ticketId: ticket.id,
      messageId: message.id,
      kind: 'support_reply',
      referenceKey: message.id,
      priority: z.enum(SUPPORT_PRIORITIES).parse(ticket.priority),
    })).onConflictDoNothing({ target: jobs.deduplicationKey })
  })
}

export function updateSystemSupportTicket(input: {
  internalWorkspaceId: string
  actorUserId: string
  ticketId: string
  status: SupportStatus
  now?: Date
}) {
  const now = input.now ?? new Date()
  return withSystemTransaction(async (db) => {
    const ticket = await db.query.supportTickets.findFirst({ where: eq(supportTickets.id, input.ticketId) })
    if (!ticket) throw new Error('Demande de support introuvable.')
    const status = supportStatusTransition(z.enum(SUPPORT_STATUSES).parse(ticket.status), input.status)
    const lifecycle = supportLifecycleDates(status, now)
    await db.update(supportTickets).set({
      status,
      ...lifecycle,
      assignedTo: input.actorUserId,
      updatedAt: now,
    }).where(eq(supportTickets.id, ticket.id))
    await db.insert(auditEvents).values({
      workspaceId: ticket.workspaceId,
      actorUserId: input.actorUserId,
      action: 'support.status_changed',
      entityType: 'support_ticket',
      entityId: ticket.id,
      metadata: { previousStatus: ticket.status, status, internalWorkspaceId: input.internalWorkspaceId },
    })
    const referenceKey = `${ticket.id}:${status}:${now.toISOString()}`
    await db.insert(jobs).values(supportEmailJob({
      workspaceId: ticket.workspaceId,
      ticketId: ticket.id,
      kind: 'status_changed',
      referenceKey,
      priority: z.enum(SUPPORT_PRIORITIES).parse(ticket.priority),
    })).onConflictDoNothing({ target: jobs.deduplicationKey })
  })
}
