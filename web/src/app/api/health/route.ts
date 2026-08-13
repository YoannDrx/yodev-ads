import { verifyDatabaseReachability } from '@/lib/system-health'

export async function GET() {
  try {
    await verifyDatabaseReachability()
    return Response.json({ status: 'ok', database: 'connected', timestamp: new Date().toISOString() })
  } catch {
    return Response.json({ status: 'degraded', database: 'unavailable', timestamp: new Date().toISOString() }, { status: 503 })
  }
}
