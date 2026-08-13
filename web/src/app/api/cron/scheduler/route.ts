import { NextResponse } from 'next/server'
import { featureEnabled } from '@/lib/feature-flags'
import { runAvailableJobs, seedScheduledJobs } from '@/lib/job-runner'

export const maxDuration = 60

export async function GET(request: Request) {
  if (process.env.MAINTENANCE_MODE === '1' || !featureEnabled('scheduler')) {
    return NextResponse.json({ error: 'Scheduler disabled' }, { status: 503, headers: { 'Retry-After': '300' } })
  }
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const requestId = request.headers.get('x-vercel-id') ?? crypto.randomUUID()
  try {
    const seeded = await seedScheduledJobs()
    const execution = await runAvailableJobs({ workerId: `vercel-cron:${requestId}` })
    console.log(JSON.stringify({
      level: execution.results.some((result) => result.status === 'dead_letter') ? 'error' : 'info',
      message: 'scheduler.run.completed',
      requestId,
      seeded,
      processed: execution.processed,
      durationMs: execution.durationMs,
      deadLetters: execution.results.filter((result) => result.status === 'dead_letter').length,
    }))
    return NextResponse.json({ data: { seeded, execution }, meta: { requestId } })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown scheduler error'
    console.error(JSON.stringify({ level: 'error', message: 'scheduler.run.failed', requestId, error: message }))
    return NextResponse.json({ error: { code: 'SCHEDULER_FAILED', message, requestId, details: {} } }, { status: 500 })
  }
}
