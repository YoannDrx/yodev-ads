import { NextResponse } from 'next/server'
import { featureEnabled } from '@/lib/feature-flags'
import { runAvailableJobs, seedScheduledJobs } from '@/lib/job-runner'
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

  const requestId = request.headers.get('x-vercel-id') ?? crypto.randomUUID()
  const startedAt = new Date()
  const nextExpectedAt = new Date(startedAt.getTime() + 5 * 60_000)
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
    const seeded = await seedScheduledJobs()
    const configuredMaximumJobs = Number(process.env.SCHEDULER_MAX_JOBS_PER_RUN ?? 25)
    const maximumJobs = Number.isInteger(configuredMaximumJobs) && configuredMaximumJobs >= 1 && configuredMaximumJobs <= 25
      ? configuredMaximumJobs
      : 25
    const execution = await runAvailableJobs({ workerId: `vercel-cron:${requestId}`, maximumJobs })
    const deadLetters = execution.results.filter((result) => result.status === 'dead_letter').length
    await completeOperationalRun({
      component: 'scheduler',
      runKey: requestId,
      startedAt,
      nextExpectedAt,
      workCount: execution.processed,
      details: { seeded: seeded.created, requested: seeded.requested, deadLetters },
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
