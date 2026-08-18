import 'server-only'

import { and, asc, eq, inArray, isNull, lt, lte, notInArray, or, sql } from 'drizzle-orm'
import { jobAttempts, jobs } from '@/db/schema'
import { withSystemTransaction } from '@/db/transactions'

export const JOB_BACKOFF_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 60 * 60_000, 12 * 60 * 60_000] as const
export const DEFAULT_JOB_LEASE_MS = 5 * 60_000

export type JobType =
  | 'auth.email_deliver'
  | 'auth.invitation_deliver'
  | 'monitoring.scan'
  | 'monitoring.weekly_digest'
  | 'report.schedule_deliver'
  | 'task.mention_deliver'
  | 'task.personal_digest'
  | 'lifecycle.email'
  | 'support.email'
  | 'subprocessor.notice_fanout'
  | 'subprocessor.notice_deliver'
  | 'operations.alert'
  | 'google.mutation.reconcile'
  | 'mutation.observe'
  | 'notification.deliver'
  | 'metrics.daily_sync'
  | 'google.accounts_sync'
  | 'google.read_drill'
  | 'google.change_sync'
  | 'conversion.actions_sync'
  | 'workspace.export'
  | 'workspace.purge'
  | 'workspace.external_cleanup'
  | 'google.revoke_connection'
  | 'stripe.cancel_subscription'
  | 'stripe.reconcile'
  | 'retention.run'
  | 'secrets.rotate'

export const NOTIFICATION_JOB_TYPES: JobType[] = [
  'auth.email_deliver',
  'auth.invitation_deliver',
  'monitoring.weekly_digest',
  'report.schedule_deliver',
  'task.mention_deliver',
  'task.personal_digest',
  'lifecycle.email',
  'support.email',
  'subprocessor.notice_fanout',
  'subprocessor.notice_deliver',
  'operations.alert',
  'notification.deliver',
]

export const GOOGLE_READ_JOB_TYPES: JobType[] = [
  'monitoring.scan',
  'monitoring.weekly_digest',
  'google.mutation.reconcile',
  'mutation.observe',
  'metrics.daily_sync',
  'google.accounts_sync',
  'google.read_drill',
  'google.change_sync',
  'conversion.actions_sync',
]

export type ClaimedJob = typeof jobs.$inferSelect
export type EnqueueJobInput = {
  workspaceId?: string | null
  type: JobType
  payload?: Record<string, unknown>
  priority?: number
  availableAt?: Date
  deduplicationKey: string
  maximumAttempts?: number
}

export class NonRetryableJobError extends Error {}

export function jobRetryDelay(attempt: number) {
  if (!Number.isInteger(attempt) || attempt < 1) throw new Error('Job attempt must be a positive integer')
  return JOB_BACKOFF_MS[Math.min(attempt - 1, JOB_BACKOFF_MS.length - 1)]
}

export async function enqueueJob(input: EnqueueJobInput) {
  if (input.deduplicationKey.length > 240) throw new Error('Job deduplication key is too long')
  return withSystemTransaction(async (db) => {
    const [created] = await db
      .insert(jobs)
      .values({
        workspaceId: input.workspaceId ?? null,
        type: input.type,
        payload: input.payload ?? {},
        priority: input.priority ?? 100,
        availableAt: input.availableAt ?? new Date(),
        deduplicationKey: input.deduplicationKey,
        maximumAttempts: input.maximumAttempts ?? 5,
      })
      .onConflictDoNothing({ target: jobs.deduplicationKey })
      .returning()
    if (created) return { job: created, created: true }
    const [existing] = await db.select().from(jobs).where(eq(jobs.deduplicationKey, input.deduplicationKey)).limit(1)
    if (!existing) throw new Error('Unable to resolve deduplicated job')
    return { job: existing, created: false }
  })
}

export async function enqueueJobs(inputs: EnqueueJobInput[]) {
  if (inputs.length === 0) return { requested: 0, created: 0 }
  for (const input of inputs) {
    if (input.deduplicationKey.length > 240) throw new Error('Job deduplication key is too long')
  }
  return withSystemTransaction(async (db) => {
    const created = await db
      .insert(jobs)
      .values(inputs.map((input) => ({
        workspaceId: input.workspaceId ?? null,
        type: input.type,
        payload: input.payload ?? {},
        priority: input.priority ?? 100,
        availableAt: input.availableAt ?? new Date(),
        deduplicationKey: input.deduplicationKey,
        maximumAttempts: input.maximumAttempts ?? 5,
      })))
      .onConflictDoNothing({ target: jobs.deduplicationKey })
      .returning({ id: jobs.id })
    return { requested: inputs.length, created: created.length }
  })
}

export async function claimNextJob(
  workerId: string,
  now = new Date(),
  leaseMs = DEFAULT_JOB_LEASE_MS,
  excludedTypes: JobType[] = [],
) {
  if (!workerId || workerId.length > 128) throw new Error('Invalid worker ID')
  return withSystemTransaction(async (db) => {
    const [candidate] = await db
      .select()
      .from(jobs)
      .where(
        and(
          lte(jobs.availableAt, now),
          lt(jobs.attemptCount, jobs.maximumAttempts),
          or(
            inArray(jobs.status, ['queued', 'retrying']),
            and(eq(jobs.status, 'running'), or(isNull(jobs.leaseExpiresAt), lte(jobs.leaseExpiresAt, now))),
          ),
          excludedTypes.length > 0 ? notInArray(jobs.type, excludedTypes) : undefined,
        ),
      )
      .orderBy(asc(jobs.priority), asc(jobs.availableAt), asc(jobs.createdAt))
      .limit(1)
      .for('update', { skipLocked: true })

    if (!candidate) return null
    const leaseExpiresAt = new Date(now.getTime() + leaseMs)
    const [claimed] = await db
      .update(jobs)
      .set({
        status: 'running',
        leaseOwner: workerId,
        leaseExpiresAt,
        attemptCount: sql`${jobs.attemptCount} + 1`,
        updatedAt: now,
      })
      .where(eq(jobs.id, candidate.id))
      .returning()
    if (!claimed) return null
    await db.insert(jobAttempts).values({
      workspaceId: claimed.workspaceId,
      jobId: claimed.id,
      attempt: claimed.attemptCount,
      state: 'running',
      workerId,
    })
    return claimed
  })
}

export async function completeJob(job: ClaimedJob, workerId: string, now = new Date(), providerMessageId?: string | null) {
  return withSystemTransaction(async (db) => {
    const [completed] = await db
      .update(jobs)
      .set({
        status: 'completed',
        leaseOwner: null,
        leaseExpiresAt: null,
        completedAt: now,
        lastError: null,
        updatedAt: now,
      })
      .where(and(eq(jobs.id, job.id), eq(jobs.status, 'running'), eq(jobs.leaseOwner, workerId)))
      .returning({ id: jobs.id })
    if (!completed) return false
    await db
      .update(jobAttempts)
      .set({ state: 'completed', finishedAt: now, providerMessageId: providerMessageId ?? null })
      .where(and(eq(jobAttempts.jobId, job.id), eq(jobAttempts.attempt, job.attemptCount)))
    return true
  })
}

export async function failJob(
  job: ClaimedJob,
  workerId: string,
  error: unknown,
  options: { forceDeadLetter?: boolean; now?: Date; retryAttemptOffset?: number } = {},
) {
  const now = options.now ?? new Date()
  const errorMessage = (error instanceof Error ? error.message : String(error)).slice(0, 4000)
  const deadLettered = options.forceDeadLetter === true || job.attemptCount >= job.maximumAttempts
  const nextAttemptAt = new Date(
    now.getTime() + jobRetryDelay(job.attemptCount + (options.retryAttemptOffset ?? 0)),
  )
  return withSystemTransaction(async (db) => {
    const [failed] = await db
      .update(jobs)
      .set({
        status: deadLettered ? 'dead_letter' : 'retrying',
        leaseOwner: null,
        leaseExpiresAt: null,
        availableAt: deadLettered ? job.availableAt : nextAttemptAt,
        lastError: errorMessage,
        deadLetteredAt: deadLettered ? now : null,
        updatedAt: now,
      })
      .where(and(eq(jobs.id, job.id), eq(jobs.status, 'running'), eq(jobs.leaseOwner, workerId)))
      .returning({ id: jobs.id })
    if (!failed) return { updated: false, deadLettered }
    await db
      .update(jobAttempts)
      .set({ state: deadLettered ? 'dead_letter' : 'failed', errorMessage, finishedAt: now })
      .where(and(eq(jobAttempts.jobId, job.id), eq(jobAttempts.attempt, job.attemptCount)))
    return { updated: true, deadLettered, nextAttemptAt: deadLettered ? null : nextAttemptAt }
  })
}
