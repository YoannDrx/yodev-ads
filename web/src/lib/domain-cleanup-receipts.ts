import 'server-only'

import { and, eq } from 'drizzle-orm'
import { domainCleanupAttempts } from '@/db/schema'
import { withSystemTransaction, type DatabaseTransaction } from '@/db/transactions'
import { type ClaimedJob } from '@/lib/jobs'
import { removeVercelProjectDomain } from '@/lib/vercel-domains'
import { hashToken } from '@/lib/tokens'

export function domainCleanupProviderScope() {
  return hashToken(JSON.stringify([process.env.VERCEL_PROJECT_ID ?? null, process.env.VERCEL_TEAM_ID ?? null]))
}

export class DomainCleanupAttemptUnresolved extends Error {
  constructor() { super('Domain cleanup attempt is already recorded; resume with a new job attempt or reconcile its result') }
}

type RemovalContext = {
  hostname: string
  workspaceHash: string
  job: ClaimedJob
  admitInTransaction: (db: DatabaseTransaction) => Promise<void>
}

async function finishAttempt(id: string, state: 'confirmed' | 'ambiguous' | 'not_submitted', alreadyAbsent: boolean | null = null) {
  await withSystemTransaction(async (db) => {
    const [saved] = await db.update(domainCleanupAttempts).set({ state, alreadyAbsent, finishedAt: new Date() })
      .where(and(eq(domainCleanupAttempts.id, id), eq(domainCleanupAttempts.state, 'submitting'))).returning({ id: domainCleanupAttempts.id })
    if (!saved) throw new Error('Domain cleanup receipt could not be recorded')
  })
}

export async function removeDomainWithCleanupReceipt(input: RemovalContext) {
  const providerScopeHash = domainCleanupProviderScope()
  const attempt = await withSystemTransaction(async (db) => {
    await input.admitInTransaction(db)
    const previous = await db.query.domainCleanupAttempts.findMany({ where: and(
      eq(domainCleanupAttempts.jobId, input.job.id), eq(domainCleanupAttempts.workspaceHash, input.workspaceHash),
      eq(domainCleanupAttempts.hostname, input.hostname),
    ) })
    if (previous.some((row) => row.state !== 'not_submitted' && row.providerScopeHash !== providerScopeHash)) throw new Error('Domain cleanup provider configuration changed; reconciliation required')
    const confirmed = previous.find((row) => row.state === 'confirmed')
    if (confirmed) return { id: confirmed.id, confirmed: true as const }
    const [created] = await db.insert(domainCleanupAttempts).values({
      hostname: input.hostname, workspaceHash: input.workspaceHash, jobId: input.job.id,
      jobAttempt: input.job.attemptCount, leaseOwner: input.job.leaseOwner!, providerScopeHash,
    }).onConflictDoNothing().returning({ id: domainCleanupAttempts.id })
    if (!created) throw new DomainCleanupAttemptUnresolved()
    // The insert may wait on another invocation of this attempt.
    await input.admitInTransaction(db)
    return { id: created.id, confirmed: false as const }
  })
  if (attempt.confirmed) return { reconciled: true, attemptId: attempt.id }
  let submitted = false
  let result: Awaited<ReturnType<typeof removeVercelProjectDomain>>
  try {
    result = await removeVercelProjectDomain(input.hostname, async () => {
      await withSystemTransaction(input.admitInTransaction)
      if (domainCleanupProviderScope() !== providerScopeHash) throw new Error('Domain cleanup provider configuration changed; reconciliation required')
      submitted = true
    })
  } catch (error) {
    // A prepared but unsubmitted operation is distinct from a request whose outcome is unknown.
    // Failed receipt persistence leaves "submitting" as unresolved evidence; never invent confirmation.
    await finishAttempt(attempt.id, submitted ? 'ambiguous' : 'not_submitted').catch(() => {})
    throw error
  }
  // Record the response of this admitted dispatch even when its worker has since lost the lease.
  // This receipt does not finish the job, release the hostname, or change a successor's tombstone.
  await finishAttempt(attempt.id, 'confirmed', result.alreadyAbsent)
  return { reconciled: false, attemptId: attempt.id }
}
