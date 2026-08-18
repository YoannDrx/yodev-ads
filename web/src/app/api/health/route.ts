import { systemHealthSnapshot } from '@/lib/system-health'

export async function GET() {
  try {
    const health = await systemHealthSnapshot()
    return Response.json(health, { status: health.status === 'ok' ? 200 : 503 })
  } catch {
    return Response.json({ status: 'degraded', database: 'unavailable', timestamp: new Date().toISOString() }, { status: 503 })
  }
}
