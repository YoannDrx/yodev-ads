import 'server-only'

import { and, count, desc, eq, inArray, isNull, notInArray, sql } from 'drizzle-orm'
import {
  activationMilestones,
  auditEvents,
  jobs,
  mutationExecutions,
  platformIncidentUpdates,
  platformIncidents,
  stripeWebhookEvents,
  subprocessorChangeNotices,
  supportMessages,
  supportTickets,
  transactionalEmailDeliveries,
  workspaces,
} from '@/db/schema'
import { withSystemTransaction } from '@/db/transactions'
import { activationCohorts } from '@/lib/activation-analytics'

export async function scheduleStripeReconciliation(input: {
  workspaceId: string
  actorUserId: string
  generation: string
  now?: Date
}) {
  const now = input.now ?? new Date()
  return withSystemTransaction(async (db) => {
    const workspace = await db.query.workspaces.findFirst({
      where: eq(workspaces.id, input.workspaceId),
      columns: { id: true, stripeSubscriptionId: true },
    })
    if (!workspace?.stripeSubscriptionId) throw new Error('Workspace Stripe subscription missing')
    const [job] = await db.insert(jobs).values({
      workspaceId: workspace.id,
      type: 'stripe.reconcile',
      payload: { workspaceId: workspace.id },
      priority: 5,
      deduplicationKey: `stripe.reconcile:${workspace.id}:manual:${input.generation}`,
      maximumAttempts: 3,
    }).returning({ id: jobs.id })
    await db.insert(auditEvents).values({
      workspaceId: workspace.id,
      actorUserId: input.actorUserId,
      action: 'billing.reconciliation_requested',
      entityType: 'workspace',
      entityId: workspace.id,
      metadata: { jobId: job?.id ?? null, requestedAt: now.toISOString() },
    })
    return job
  })
}

export async function retryGlobalDeadLetter(input: {
  operatorWorkspaceId: string
  actorUserId: string
  jobId: string
  now?: Date
}) {
  const now = input.now ?? new Date()
  return withSystemTransaction(async (db) => {
    const [job] = await db.update(jobs).set({
      status: 'queued',
      payload: sql`coalesce(${jobs.payload}, '{}'::jsonb) || jsonb_build_object(
        'manualRetryGeneration',
        coalesce((${jobs.payload}->>'manualRetryGeneration')::int, 0) + 1
      )`,
      availableAt: now,
      maximumAttempts: sql`${jobs.attemptCount} + 5`,
      leaseOwner: null,
      leaseExpiresAt: null,
      deadLetteredAt: null,
      lastError: null,
      updatedAt: now,
    }).where(and(eq(jobs.id, input.jobId), isNull(jobs.workspaceId), eq(jobs.status, 'dead_letter')))
      .returning({ id: jobs.id, type: jobs.type, payload: jobs.payload })
    if (!job) throw new Error('Job système en dead-letter introuvable.')
    await db.insert(auditEvents).values({
      workspaceId: input.operatorWorkspaceId,
      actorUserId: input.actorUserId,
      action: 'system_job.manual_retry_requested',
      entityType: 'job',
      entityId: job.id,
      metadata: {
        type: job.type,
        manualRetryGeneration: job.payload && typeof job.payload === 'object' && 'manualRetryGeneration' in job.payload
          ? job.payload.manualRetryGeneration
          : null,
      },
    })
    return job
  })
}

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
    const billingReconciliationCount = await db.select({ total: count() }).from(workspaces).where(eq(workspaces.billingReconciliationRequired, true))
    const billingReconciliations = await db.query.workspaces.findMany({
      where: eq(workspaces.billingReconciliationRequired, true),
      columns: { id: true, name: true, billingReconciliationReason: true, updatedAt: true },
      orderBy: [desc(workspaces.updatedAt)],
      limit: 100,
    })
    const failedEmailCount = await db.select({ total: count() }).from(transactionalEmailDeliveries).where(inArray(transactionalEmailDeliveries.status, ['failed', 'hard_bounced', 'complained', 'ambiguous']))
    const failedEmailDeliveries = await db.query.transactionalEmailDeliveries.findMany({
      where: inArray(transactionalEmailDeliveries.status, ['failed', 'hard_bounced', 'complained', 'ambiguous']),
      orderBy: [desc(transactionalEmailDeliveries.updatedAt)],
      limit: 100,
    })
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
      billingReconciliations,
      billingReconciliationCount: billingReconciliationCount[0]?.total ?? 0,
      failedEmailDeliveries,
      failedEmailCount: failedEmailCount[0]?.total ?? 0,
      ambiguousMutations,
      ambiguousMutationCount: ambiguousMutationCount[0]?.total ?? 0,
      checkedAt: new Date(),
    }
  })
}
