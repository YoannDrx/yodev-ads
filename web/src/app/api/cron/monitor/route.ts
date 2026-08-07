import { and, eq } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { getDb } from '@/db'
import { auditEvents, monitoringAgents } from '@/db/schema'
import { runWorkspaceMonitoring } from '@/lib/run-monitoring'
import { dispatchWeeklyDigest } from '@/lib/notifications'

export async function GET(request: Request) {
  if (process.env.MAINTENANCE_MODE === '1') {
    return NextResponse.json({ error: 'Maintenance mode' }, { status: 503, headers: { 'Retry-After': '900' } })
  }
  const startedAt = Date.now()
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const agents = await getDb().query.monitoringAgents.findMany({
    where: and(eq(monitoringAgents.enabled, true), eq(monitoringAgents.schedule, 'daily')),
    columns: { workspaceId: true },
  })
  const workspaceIds = [...new Set(agents.map((agent) => agent.workspaceId))]
  const results = []
  for (const workspaceId of workspaceIds) {
    try {
      const result = await runWorkspaceMonitoring(workspaceId)
      const digest = new Date().getUTCDay() === 1 ? await dispatchWeeklyDigest(workspaceId) : undefined
      await getDb().insert(auditEvents).values({
        workspaceId,
        actorUserId: 'system:vercel-cron',
        action: 'monitoring.scan_completed',
        entityType: 'workspace',
        entityId: workspaceId,
        metadata: result,
      })
      results.push({ workspaceId, ok: true, ...result, digest })
    } catch (error) {
      results.push({ workspaceId, ok: false, error: error instanceof Error ? error.message : 'Unknown error' })
    }
  }
  console.log(JSON.stringify({
    level: 'info',
    message: 'monitoring.cron.completed',
    processed: workspaceIds.length,
    failures: results.filter((result) => !result.ok).length,
    durationMs: Date.now() - startedAt,
  }))
  return NextResponse.json({ processed: workspaceIds.length, results })
}
