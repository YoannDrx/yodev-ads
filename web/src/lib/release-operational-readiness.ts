import 'server-only'

import { and, count, eq, inArray, lte } from 'drizzle-orm'
import {
  jobs,
  mutationExecutions,
  stripeWebhookEvents,
  transactionalEmailDeliveries,
  workspaces,
} from '@/db/schema'
import { withSystemTransaction } from '@/db/transactions'
import type { ReadinessIssue } from '@/lib/production-readiness'

export async function releaseOperationalIssues(now = new Date()): Promise<ReadinessIssue[]> {
  const evidence = await withSystemTransaction(async (db) => {
    const deadLetters = await db.select({ total: count() }).from(jobs).where(eq(jobs.status, 'dead_letter'))
    const dueJobs = await db.select({ total: count() }).from(jobs).where(and(
      inArray(jobs.status, ['queued', 'retrying', 'running']),
      lte(jobs.availableAt, now),
    ))
    const failedStripe = await db.select({ total: count() }).from(stripeWebhookEvents).where(eq(stripeWebhookEvents.status, 'failed'))
    const billingReconciliations = await db.select({ total: count() }).from(workspaces).where(eq(workspaces.billingReconciliationRequired, true))
    const failedEmail = await db.select({ total: count() }).from(transactionalEmailDeliveries).where(
      inArray(transactionalEmailDeliveries.status, ['failed', 'hard_bounced', 'complained', 'ambiguous']),
    )
    const ambiguousMutations = await db.select({ total: count() }).from(mutationExecutions).where(inArray(mutationExecutions.state, ['ambiguous', 'failed']))
    return {
      deadLetters: deadLetters[0]?.total ?? 0,
      dueJobs: dueJobs[0]?.total ?? 0,
      failedStripe: failedStripe[0]?.total ?? 0,
      billingReconciliations: billingReconciliations[0]?.total ?? 0,
      failedEmail: failedEmail[0]?.total ?? 0,
      ambiguousMutations: ambiguousMutations[0]?.total ?? 0,
    }
  })

  const issues: ReadinessIssue[] = []
  if (evidence.deadLetters > 0) {
    issues.push({ code: 'queue.dead_letters', message: 'All dead-letter jobs must be resolved or explicitly cancelled' })
  }
  if (evidence.dueJobs > 0) {
    issues.push({ code: 'queue.due_jobs', message: 'All due jobs must be drained or explicitly cancelled' })
  }
  if (evidence.failedStripe > 0) {
    issues.push({ code: 'stripe.failed_webhooks', message: 'All failed Stripe webhook events must be reconciled' })
  }
  if (evidence.billingReconciliations > 0) {
    issues.push({ code: 'stripe.reconciliation_required', message: 'All billing reconciliation flags must be cleared' })
  }
  if (evidence.failedEmail > 0) {
    issues.push({ code: 'email.unresolved_deliveries', message: 'All failed, bounced, complained or ambiguous email deliveries must be reviewed' })
  }
  if (evidence.ambiguousMutations > 0) {
    issues.push({ code: 'google.unresolved_mutations', message: 'All failed or ambiguous Google mutations must be reconciled' })
  }
  return issues
}
