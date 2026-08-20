import 'server-only'

import { and, desc, eq, lte, or } from 'drizzle-orm'
import { operationalLeases, operationalRuns } from '@/db/schema'
import { withSystemTransaction } from '@/db/transactions'

export type OperationalComponent = 'scheduler' | 'retention' | 'stripe_reconciliation'

const operationalComponents: OperationalComponent[] = ['scheduler', 'retention', 'stripe_reconciliation']

function normalizedError(error: unknown) {
  return (error instanceof Error ? error.message : String(error)).slice(0, 2000)
}

export function acquireOperationalLease(input: {
  component: OperationalComponent
  owner: string
  now?: Date
  leaseMs?: number
}) {
  if (!input.owner || input.owner.length > 160) throw new Error('Invalid operational lease owner')
  const now = input.now ?? new Date()
  const leaseMs = input.leaseMs ?? 75_000
  if (!Number.isInteger(leaseMs) || leaseMs < 5_000 || leaseMs > 15 * 60_000) {
    throw new Error('Invalid operational lease duration')
  }
  const leaseExpiresAt = new Date(now.getTime() + leaseMs)
  return withSystemTransaction(async (db) => {
    const [lease] = await db.insert(operationalLeases).values({
      component: input.component,
      owner: input.owner,
      leaseExpiresAt,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: operationalLeases.component,
      set: { owner: input.owner, leaseExpiresAt, updatedAt: now },
      setWhere: or(
        lte(operationalLeases.leaseExpiresAt, now),
        eq(operationalLeases.owner, input.owner),
      ),
    }).returning({ owner: operationalLeases.owner, leaseExpiresAt: operationalLeases.leaseExpiresAt })
    return lease?.owner === input.owner ? lease : null
  })
}

export function releaseOperationalLease(input: {
  component: OperationalComponent
  owner: string
  now?: Date
}) {
  const now = input.now ?? new Date()
  return withSystemTransaction((db) => db.update(operationalLeases).set({
    leaseExpiresAt: now,
    updatedAt: now,
  }).where(and(
    eq(operationalLeases.component, input.component),
    eq(operationalLeases.owner, input.owner),
  )))
}

export function startOperationalRun(input: {
  component: OperationalComponent
  runKey: string
  startedAt?: Date
  nextExpectedAt?: Date | null
}) {
  const startedAt = input.startedAt ?? new Date()
  return withSystemTransaction((db) => db.insert(operationalRuns).values({
    component: input.component,
    runKey: input.runKey,
    status: 'running',
    startedAt,
    nextExpectedAt: input.nextExpectedAt ?? null,
  }).onConflictDoNothing({
    target: [operationalRuns.component, operationalRuns.runKey],
  }).returning({ id: operationalRuns.id }))
}

export function completeOperationalRun(input: {
  component: OperationalComponent
  runKey: string
  startedAt: Date
  workCount: number
  details?: Record<string, unknown>
  completedAt?: Date
  nextExpectedAt?: Date | null
}) {
  const completedAt = input.completedAt ?? new Date()
  return withSystemTransaction((db) => db.update(operationalRuns).set({
    status: 'completed',
    completedAt,
    durationMs: Math.max(0, completedAt.getTime() - input.startedAt.getTime()),
    workCount: Math.max(0, input.workCount),
    details: input.details ?? {},
    errorMessage: null,
    nextExpectedAt: input.nextExpectedAt ?? null,
  }).where(and(eq(operationalRuns.component, input.component), eq(operationalRuns.runKey, input.runKey))))
}

export function failOperationalRun(input: {
  component: OperationalComponent
  runKey: string
  startedAt: Date
  error: unknown
  failedAt?: Date
  nextExpectedAt?: Date | null
}) {
  const failedAt = input.failedAt ?? new Date()
  return withSystemTransaction((db) => db.update(operationalRuns).set({
    status: 'failed',
    completedAt: failedAt,
    durationMs: Math.max(0, failedAt.getTime() - input.startedAt.getTime()),
    errorMessage: normalizedError(input.error),
    nextExpectedAt: input.nextExpectedAt ?? null,
  }).where(and(eq(operationalRuns.component, input.component), eq(operationalRuns.runKey, input.runKey))))
}

export function latestOperationalRuns() {
  return withSystemTransaction(async (db) => {
    const latest: Partial<Record<OperationalComponent, typeof operationalRuns.$inferSelect>> = {}
    for (const component of operationalComponents) {
      const row = await db.query.operationalRuns.findFirst({
        where: eq(operationalRuns.component, component),
        orderBy: [desc(operationalRuns.startedAt)],
      })
      if (row) latest[component] = row
    }
    return latest
  })
}
