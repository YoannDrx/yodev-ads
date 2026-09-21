import { NextResponse } from 'next/server'
import { featureEnabled } from '@/lib/feature-flags'
import { runAvailableJobs, seedScheduledJobs } from '@/lib/job-runner'
import { withWorkDeadline } from '@/lib/work-deadline'
import { recoverExpiredJobs } from '@/lib/jobs'
import {
  acquireOperationalLease,
  completeOperationalRun,
  failOperationalRun,
  releaseOperationalLease,
  startOperationalRun,
} from '@/lib/operational-runs'

export const maxDuration = 60

export async function GET(request: Request) {
  if (!featureEnabled('scheduler')) {
    return NextResponse.json({ error: 'Scheduler disabled' }, { status: 503, headers: { 'Retry-After': '300' } })
  }
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const startedAt = new Date()
  return withWorkDeadline(startedAt.getTime() + 55_000, () => runScheduler(request, startedAt))
}

async function runScheduler(request: Request, startedAt: Date) {
  const requestId = request.headers.get('x-vercel-id') ?? crypto.randomUUID()
  const nextExpectedAt = new Date(startedAt.getTime() + 15 * 60_000)
  const leaseOwner = `scheduler:${requestId}`
  const lease = await acquireOperationalLease({ component: 'scheduler', owner: leaseOwner, now: startedAt })
  if (!lease) {
    return NextResponse.json({ error: 'Scheduler already running' }, {
      status: 409,
      headers: { 'Retry-After': '30' },
    })
  }
  try {
    await startOperationalRun({ component: 'scheduler', runKey: requestId, startedAt, nextExpectedAt })
    const { recovery, seeded, execution } = await withWorkDeadline(startedAt.getTime() + 45_000, async () => {
      const recovery = await recoverExpiredJobs()
      const seeded = await seedScheduledJobs()
      const configuredMaximumJobs = Number(process.env.SCHEDULER_MAX_JOBS_PER_RUN ?? 25)
      const maximumJobs = Number.isInteger(configuredMaximumJobs) && configuredMaximumJobs >= 1 && configuredMaximumJobs <= 25
        ? configuredMaximumJobs
        : 25
      const execution = await runAvailableJobs({ workerId: `vercel-cron:${requestId}`, maximumJobs, maximumRuntimeMs: Math.max(0, 45_000 - (Date.now() - startedAt.getTime())) })
      return { recovery, seeded, execution }
    })
    const deadLetters = execution.results.filter((result) => result.status === 'dead_letter').length
    await completeOperationalRun({
      component: 'scheduler',
      runKey: requestId,
      startedAt,
      nextExpectedAt,
      workCount: execution.processed,
      details: { seeded: seeded.created, requested: seeded.requested, deadLetters, recovery },
    })
    console.log(JSON.stringify({
      level: deadLetters > 0 ? 'error' : 'info',
      message: 'scheduler.run.completed',
      requestId,
      seeded,
      processed: execution.processed,
      durationMs: execution.durationMs,
      deadLetters,
    }))
    return NextResponse.json({ data: { seeded, execution }, meta: { requestId } })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown scheduler error'
    try {
      await failOperationalRun({ component: 'scheduler', runKey: requestId, startedAt, nextExpectedAt, error })
    } catch (heartbeatError) {
      console.error(JSON.stringify({
        level: 'error', message: 'scheduler.heartbeat.failed', requestId,
        error: heartbeatError instanceof Error ? heartbeatError.message : String(heartbeatError),
      }))
    }
    console.error(JSON.stringify({ level: 'error', message: 'scheduler.run.failed', requestId, error: message }))
    return NextResponse.json({ error: { code: 'SCHEDULER_FAILED', message, requestId, details: {} } }, { status: 500 })
  } finally {
    try {
      await releaseOperationalLease({ component: 'scheduler', owner: leaseOwner })
    } catch (leaseError) {
      console.error(JSON.stringify({
        level: 'error', message: 'scheduler.lease_release_failed', requestId,
        error: leaseError instanceof Error ? leaseError.message : String(leaseError),
      }))
    }
  }
}
