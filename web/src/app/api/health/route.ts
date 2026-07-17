import { sql } from 'drizzle-orm'
import { getDb } from '@/db'

export async function GET() {
  try {
    await getDb().execute(sql`select 1`)
    return Response.json({ status: 'ok', database: 'connected', timestamp: new Date().toISOString() })
  } catch {
    return Response.json({ status: 'degraded', database: 'unavailable', timestamp: new Date().toISOString() }, { status: 503 })
  }
}
