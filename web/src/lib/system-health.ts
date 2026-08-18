import 'server-only'

import { sql } from 'drizzle-orm'
import { withSystemTransaction } from '@/db/transactions'
import { latestOperationalRuns } from '@/lib/operational-runs'

export async function verifyDatabaseReachability() {
  await withSystemTransaction((db) => db.execute(sql`select 1`))
}

function releaseOperationsRequired() {
  return ['staging', 'private_beta', 'public'].includes(process.env.RELEASE_TARGET ?? '')
    || process.env.VERCEL_ENV === 'production'
}

export async function systemHealthSnapshot(now = new Date()) {
  await verifyDatabaseReachability()
  const operations = await latestOperationalRuns()
  const scheduler = operations.scheduler
  const retention = operations.retention
  const maintenance = process.env.MAINTENANCE_MODE === '1'
  const schedulerEnabled = process.env.SCHEDULER_ENABLED === '1'
  const workersRequired = releaseOperationsRequired()
  const schedulerOverdue = schedulerEnabled && (
    !scheduler
    || scheduler.status !== 'completed'
    || !scheduler.nextExpectedAt
    || scheduler.nextExpectedAt.getTime() + 5 * 60_000 < now.getTime()
  )
  const retentionOverdue = schedulerEnabled && (
    !retention
    || retention.status !== 'completed'
    || !retention.nextExpectedAt
    || retention.nextExpectedAt.getTime() + 24 * 60 * 60_000 < now.getTime()
  )
  const disabledForRelease = workersRequired && !schedulerEnabled
  const status = maintenance
    ? 'maintenance' as const
    : disabledForRelease || schedulerOverdue || retentionOverdue
      ? 'degraded' as const
      : 'ok' as const
  return {
    status,
    database: 'connected' as const,
    release: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 40) || 'local',
    scheduler: schedulerEnabled ? {
      status: scheduler?.status ?? 'missing',
      lastStartedAt: scheduler?.startedAt?.toISOString() ?? null,
      nextExpectedAt: scheduler?.nextExpectedAt?.toISOString() ?? null,
      overdue: schedulerOverdue,
    } : { status: 'disabled', lastStartedAt: null, nextExpectedAt: null, overdue: disabledForRelease },
    retention: schedulerEnabled ? {
      status: retention?.status ?? 'missing',
      lastStartedAt: retention?.startedAt?.toISOString() ?? null,
      nextExpectedAt: retention?.nextExpectedAt?.toISOString() ?? null,
      overdue: retentionOverdue,
    } : { status: 'disabled', lastStartedAt: null, nextExpectedAt: null, overdue: disabledForRelease },
    timestamp: now.toISOString(),
  }
}
