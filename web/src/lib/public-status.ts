import 'server-only'

import { and, desc, eq, gte, ne, or } from 'drizzle-orm'
import { platformIncidentUpdates, platformIncidents } from '@/db/schema'
import { withSystemTransaction } from '@/db/transactions'
import { platformStatusSummary } from '@/lib/platform-status'

export async function getPublicPlatformStatus(now = new Date()) {
  return withSystemTransaction(async (db) => {
    const since = new Date(now.getTime() - 90 * 24 * 60 * 60_000)
    const incidents = await db.query.platformIncidents.findMany({
      where: and(
        eq(platformIncidents.public, true),
        or(ne(platformIncidents.status, 'resolved'), gte(platformIncidents.startedAt, since)),
      ),
      orderBy: [desc(platformIncidents.startedAt)],
      limit: 100,
    })
    const visibleIncidents = incidents.filter((incident) => incident.status !== 'resolved' || incident.startedAt >= since)
    const incidentIds = visibleIncidents.map((incident) => incident.id)
    const updates = incidentIds.length > 0
      ? await db.query.platformIncidentUpdates.findMany({
        where: or(...incidentIds.map((id) => eq(platformIncidentUpdates.incidentId, id))),
        orderBy: [desc(platformIncidentUpdates.createdAt)],
        limit: 1000,
      })
      : []
    const byIncident = new Map<string, typeof updates>()
    for (const update of updates) byIncident.set(update.incidentId, [...(byIncident.get(update.incidentId) ?? []), update])
    return {
      summary: platformStatusSummary(visibleIncidents),
      incidents: visibleIncidents.map((incident) => ({ incident, updates: byIncident.get(incident.id) ?? [] })),
      checkedAt: now,
    }
  })
}
