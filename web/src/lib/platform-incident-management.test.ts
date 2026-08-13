import { beforeEach, describe, expect, it, vi } from 'vitest'
import { databaseDouble } from '../../test/fluent-db'

const mocks = vi.hoisted(() => ({
  databases: [] as unknown[],
  transaction: vi.fn(async (callback: (db: unknown) => unknown) => callback(mocks.databases.shift())),
}))

vi.mock('@/db/transactions', () => ({ withSystemTransaction: mocks.transaction }))

import { addSystemPlatformIncidentUpdate, createSystemPlatformIncident } from './platform-incident-management'

const internalWorkspaceId = '00000000-0000-4000-8000-000000000001'
const incidentId = '00000000-0000-4000-8000-000000000002'
const actorUserId = 'user-1'
const now = new Date('2026-08-12T08:00:00.000Z')

function incidentDatabase(input: { statementResults?: unknown[]; incident?: unknown } = {}) {
  return databaseDouble({
    statementResults: input.statementResults,
    query: { platformIncidents: { findFirst: vi.fn(async () => input.incident) } },
  })
}

describe('platform incident management', () => {
  beforeEach(() => {
    mocks.databases = []
    vi.clearAllMocks()
  })

  it('creates an incident, its first bilingual update and audit evidence atomically', async () => {
    const database = incidentDatabase({ statementResults: [[{ id: incidentId }]] })
    mocks.databases.push(database.db)
    await createSystemPlatformIncident({
      internalWorkspaceId,
      actorUserId,
      titleFr: 'Incident Google Ads',
      titleEn: 'Google Ads incident',
      component: 'google_ads',
      impact: 'degraded',
      messageFr: 'Investigation en cours.',
      messageEn: 'Investigation in progress.',
    })
    expect(database.capture.values).toEqual(expect.arrayContaining([
      expect.objectContaining({ component: 'google_ads', impact: 'degraded', status: 'investigating' }),
      expect.objectContaining({ incidentId, status: 'investigating', messageEn: 'Investigation in progress.' }),
      expect.objectContaining({ workspaceId: internalWorkspaceId, action: 'platform.incident_created', entityId: incidentId }),
    ]))
  })

  it('fails closed when incident creation or update target is missing', async () => {
    mocks.databases.push(incidentDatabase({ statementResults: [[]] }).db, incidentDatabase().db)
    await expect(createSystemPlatformIncident({
      internalWorkspaceId, actorUserId, titleFr: 'Incident', titleEn: 'Incident', component: 'application',
      impact: 'maintenance', messageFr: 'Maintenance planifiée.', messageEn: 'Scheduled maintenance.',
    })).rejects.toThrow('création de l’incident')
    await expect(addSystemPlatformIncidentUpdate({
      internalWorkspaceId, actorUserId, incidentId, status: 'resolved', messageFr: 'Incident résolu.', messageEn: 'Incident resolved.',
    })).rejects.toThrow('introuvable')
  })

  it('publishes a bilingual update and resolves the incident with audit evidence', async () => {
    const database = incidentDatabase({ incident: { id: incidentId, status: 'monitoring' } })
    mocks.databases.push(database.db)
    await addSystemPlatformIncidentUpdate({
      internalWorkspaceId, actorUserId, incidentId, status: 'resolved',
      messageFr: 'Le service est rétabli.', messageEn: 'Service has recovered.', now,
    })
    expect(database.capture.sets[0]).toEqual({ status: 'resolved', resolvedAt: now, updatedAt: now })
    expect(database.capture.values).toContainEqual(expect.objectContaining({
      action: 'platform.incident_updated', metadata: { previousStatus: 'monitoring', status: 'resolved' },
    }))
  })
})
