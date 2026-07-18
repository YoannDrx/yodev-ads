import { and, eq } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { getDb } from '@/db'
import { auditEvents, monitoringAgents } from '@/db/schema'
import { runWorkspaceMonitoring } from '@/lib/run-monitoring'

export async function GET(request: Request) {
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
      await getDb().insert(auditEvents).values({
        workspaceId,
        actorUserId: 'system:vercel-cron',
        action: 'monitoring.scan_completed',
        entityType: 'workspace',
        entityId: workspaceId,
        metadata: result,
      })
      results.push({ workspaceId, ok: true, ...result })
    } catch (error) {
      results.push({ workspaceId, ok: false, error: error instanceof Error ? error.message : 'Unknown error' })
    }
  }
  return NextResponse.json({ processed: workspaceIds.length, results })
}
