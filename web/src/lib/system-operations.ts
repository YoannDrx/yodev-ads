import 'server-only'

import { count, desc, eq, inArray, notInArray, sql } from 'drizzle-orm'
import {
  activationMilestones,
  jobs,
  mutationExecutions,
  platformIncidentUpdates,
  platformIncidents,
  stripeWebhookEvents,
  subprocessorChangeNotices,
  supportMessages,
  supportTickets,
  workspaces,
} from '@/db/schema'
import { withSystemTransaction } from '@/db/transactions'
import { activationCohorts } from '@/lib/activation-analytics'

export async function getSystemOperationsSnapshot() {
  return withSystemTransaction(async (db) => {
    const workspaceStates = await db.select({ state: workspaces.accessState, total: count() }).from(workspaces).groupBy(workspaces.accessState)
    const commercialWorkspaces = await db.select({ id: workspaces.id, createdAt: workspaces.createdAt }).from(workspaces).where(notInArray(workspaces.accessState, ['internal', 'deleted']))
    const milestones = await db.select({ milestone: activationMilestones.milestone, total: sql<number>`count(distinct ${activationMilestones.workspaceId})::int` })
      .from(activationMilestones)
      .innerJoin(workspaces, eq(workspaces.id, activationMilestones.workspaceId))
      .where(notInArray(workspaces.accessState, ['internal', 'deleted']))
      .groupBy(activationMilestones.milestone)
    const activationEvents = await db.select({ workspaceId: activationMilestones.workspaceId, milestone: activationMilestones.milestone, occurredAt: activationMilestones.occurredAt })
      .from(activationMilestones)
      .innerJoin(workspaces, eq(workspaces.id, activationMilestones.workspaceId))
      .where(notInArray(workspaces.accessState, ['internal', 'deleted']))
    const supportStatusCounts = await db.select({ status: supportTickets.status, total: count() }).from(supportTickets).groupBy(supportTickets.status)
    const tickets = await db.select({ ticket: supportTickets, workspace: { id: workspaces.id, name: workspaces.name, accessState: workspaces.accessState, plan: workspaces.plan } })
      .from(supportTickets)
      .innerJoin(workspaces, eq(workspaces.id, supportTickets.workspaceId))
      .orderBy(supportTickets.status, desc(supportTickets.lastMessageAt))
      .limit(50)
    const messages = await db.query.supportMessages.findMany({ orderBy: [supportMessages.createdAt], limit: 2000 })
    const incidents = await db.query.platformIncidents.findMany({ orderBy: [desc(platformIncidents.startedAt)], limit: 100 })
    const incidentUpdates = await db.query.platformIncidentUpdates.findMany({ orderBy: [platformIncidentUpdates.createdAt], limit: 1000 })
    const subprocessorNotices = await db.query.subprocessorChangeNotices.findMany({ orderBy: [desc(subprocessorChangeNotices.createdAt)], limit: 100 })
    const deadLetterCount = await db.select({ total: count() }).from(jobs).where(eq(jobs.status, 'dead_letter'))
    const deadLetters = await db.select({ job: jobs, workspace: { id: workspaces.id, name: workspaces.name } })
      .from(jobs)
      .leftJoin(workspaces, eq(workspaces.id, jobs.workspaceId))
      .where(eq(jobs.status, 'dead_letter'))
      .orderBy(desc(jobs.deadLetteredAt))
      .limit(100)
    const failedStripeCount = await db.select({ total: count() }).from(stripeWebhookEvents).where(eq(stripeWebhookEvents.status, 'failed'))
    const failedStripeEvents = await db.query.stripeWebhookEvents.findMany({ where: eq(stripeWebhookEvents.status, 'failed'), orderBy: [desc(stripeWebhookEvents.updatedAt)], limit: 100 })
    const ambiguousMutationCount = await db.select({ total: count() }).from(mutationExecutions).where(inArray(mutationExecutions.state, ['ambiguous', 'failed']))
    const ambiguousMutations = await db.select({ execution: mutationExecutions, workspace: { id: workspaces.id, name: workspaces.name } })
      .from(mutationExecutions)
      .innerJoin(workspaces, eq(workspaces.id, mutationExecutions.workspaceId))
      .where(inArray(mutationExecutions.state, ['ambiguous', 'failed']))
      .orderBy(desc(mutationExecutions.updatedAt))
      .limit(100)
    const messagesByTicket = new Map<string, typeof messages>()
    for (const supportMessage of messages) messagesByTicket.set(supportMessage.ticketId, [...(messagesByTicket.get(supportMessage.ticketId) ?? []), supportMessage])
    const updatesByIncident = new Map<string, typeof incidentUpdates>()
    for (const update of incidentUpdates) updatesByIncident.set(update.incidentId, [...(updatesByIncident.get(update.incidentId) ?? []), update])
    return {
      workspaceStates: Object.fromEntries(workspaceStates.map((row) => [row.state, row.total])),
      activationFunnel: Object.fromEntries(milestones.map((row) => [row.milestone, row.total])),
      activationCohorts: activationCohorts(commercialWorkspaces, activationEvents),
      supportStatusCounts: Object.fromEntries(supportStatusCounts.map((row) => [row.status, row.total])),
      tickets: tickets.map((row) => ({ ...row, messages: messagesByTicket.get(row.ticket.id) ?? [] })),
      incidents: incidents.map((incident) => ({ incident, updates: updatesByIncident.get(incident.id) ?? [] })),
      subprocessorNotices,
      deadLetters,
      deadLetterCount: deadLetterCount[0]?.total ?? 0,
      failedStripeEvents,
      failedStripeCount: failedStripeCount[0]?.total ?? 0,
      ambiguousMutations,
      ambiguousMutationCount: ambiguousMutationCount[0]?.total ?? 0,
      checkedAt: new Date(),
    }
  })
}
