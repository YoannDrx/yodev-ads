import 'server-only'

import { eq } from 'drizzle-orm'
import { auditEvents, platformIncidentUpdates, platformIncidents } from '@/db/schema'
import { withSystemTransaction } from '@/db/transactions'
import type { PLATFORM_COMPONENTS, PLATFORM_IMPACTS, PLATFORM_INCIDENT_STATUSES } from '@/lib/platform-status'

type PlatformComponent = (typeof PLATFORM_COMPONENTS)[number]
type PlatformImpact = (typeof PLATFORM_IMPACTS)[number]
type PlatformIncidentStatus = (typeof PLATFORM_INCIDENT_STATUSES)[number]
type PlatformActorContext = { internalWorkspaceId: string; actorUserId: string }

export function createSystemPlatformIncident(input: PlatformActorContext & {
  titleFr: string
  titleEn: string
  component: PlatformComponent
  impact: PlatformImpact
  messageFr: string
  messageEn: string
}) {
  return withSystemTransaction(async (db) => {
    const [incident] = await db.insert(platformIncidents).values({
      createdBy: input.actorUserId,
      titleFr: input.titleFr,
      titleEn: input.titleEn,
      component: input.component,
      impact: input.impact,
      status: 'investigating',
    }).returning({ id: platformIncidents.id })
    if (!incident) throw new Error('La création de l’incident de plateforme a échoué.')
    await db.insert(platformIncidentUpdates).values({
      incidentId: incident.id,
      createdBy: input.actorUserId,
      status: 'investigating',
      messageFr: input.messageFr,
      messageEn: input.messageEn,
    })
    await db.insert(auditEvents).values({
      workspaceId: input.internalWorkspaceId,
      actorUserId: input.actorUserId,
      action: 'platform.incident_created',
      entityType: 'platform_incident',
      entityId: incident.id,
      metadata: { component: input.component, impact: input.impact },
    })
    return incident
  })
}

export function addSystemPlatformIncidentUpdate(input: PlatformActorContext & {
  incidentId: string
  status: PlatformIncidentStatus
  messageFr: string
  messageEn: string
  now?: Date
}) {
  const now = input.now ?? new Date()
  return withSystemTransaction(async (db) => {
    const incident = await db.query.platformIncidents.findFirst({ where: eq(platformIncidents.id, input.incidentId) })
    if (!incident) throw new Error('Incident de plateforme introuvable.')
    await db.insert(platformIncidentUpdates).values({
      incidentId: incident.id,
      createdBy: input.actorUserId,
      status: input.status,
      messageFr: input.messageFr,
      messageEn: input.messageEn,
    })
    await db.update(platformIncidents).set({
      status: input.status,
      resolvedAt: input.status === 'resolved' ? now : null,
      updatedAt: now,
    }).where(eq(platformIncidents.id, incident.id))
    await db.insert(auditEvents).values({
      workspaceId: input.internalWorkspaceId,
      actorUserId: input.actorUserId,
      action: 'platform.incident_updated',
      entityType: 'platform_incident',
      entityId: incident.id,
      metadata: { previousStatus: incident.status, status: input.status },
    })
  })
}
