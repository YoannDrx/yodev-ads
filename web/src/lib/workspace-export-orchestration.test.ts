import { unzipSync, strFromU8 } from 'fflate'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { databaseDouble } from '../../test/fluent-db'

const mocks = vi.hoisted(() => ({
  databases: [] as unknown[],
  transaction: vi.fn(async (callback: (db: unknown) => unknown) => callback(mocks.databases.shift())),
  put: vi.fn(),
  del: vi.fn(),
}))

vi.mock('@/db/transactions', () => ({ withSystemTransaction: mocks.transaction }))
vi.mock('@vercel/blob', () => ({ put: mocks.put, del: mocks.del }))

import { deleteExpiredExportArtifacts, runWorkspaceExport } from './workspace-export'

const workspaceId = '00000000-0000-4000-8000-000000000001'
const exportJobId = '00000000-0000-4000-8000-000000000002'

function queryDouble(input: { workspace?: unknown; connection?: unknown; rows?: Record<string, unknown[]> } = {}) {
  const many = (name: string) => vi.fn(async () => input.rows?.[name] ?? [])
  return {
    workspaces: { findFirst: vi.fn(async () => input.workspace) },
    googleAdsConnections: { findFirst: vi.fn(async () => input.connection) },
    clients: { findMany: many('clients') }, clientGoals: { findMany: many('clientGoals') },
    monitoringAgents: { findMany: many('monitoringAgents') }, alertIncidents: { findMany: many('alerts') },
    activationMilestones: { findMany: many('activation') }, alertComments: { findMany: many('alertComments') },
    workspaceTasks: { findMany: many('tasks') }, taskComments: { findMany: many('taskComments') },
    supportTickets: { findMany: many('supportTickets') }, supportMessages: { findMany: many('supportMessages') },
    memberNotificationPreferences: { findMany: many('memberPreferences') }, approvalRequests: { findMany: many('approvals') },
    approvalVotes: { findMany: many('votes') }, approvalComments: { findMany: many('approvalComments') },
    clientApprovalFeedback: { findMany: many('feedback') }, mutationExecutions: { findMany: many('executions') },
    mutationObservations: { findMany: many('observations') }, auditEvents: { findMany: many('audit') },
    dailyAccountMetrics: { findMany: many('accountMetrics') }, dailyCampaignMetrics: { findMany: many('campaignMetrics') },
    performanceSnapshots: { findMany: many('legacy') }, googleChangeEvents: { findMany: many('changes') },
    conversionActionSnapshots: { findMany: many('conversions') }, offlineConversionDiagnostics: { findMany: many('offline') },
    safetyPolicies: { findMany: many('policies') }, shareLinks: { findMany: many('reports') },
    reportTemplates: { findMany: many('templates') }, reportTemplateVersions: { findMany: many('templateVersions') },
    reportSchedules: { findMany: many('schedules') }, apiKeys: { findMany: many('keys') },
    notificationChannels: { findMany: many('channels') }, legalAcceptances: { findMany: many('legal') },
  }
}

describe('workspace export orchestration', () => {
  beforeEach(() => {
    mocks.databases = []
    vi.clearAllMocks()
    mocks.put.mockResolvedValue({ pathname: `exports/${workspaceId}/${exportJobId}.zip` })
    mocks.del.mockResolvedValue(undefined)
  })

  it('claims, collects, redacts, archives and completes a private export', async () => {
    const claim = databaseDouble({ statementResults: [[{ id: exportJobId, workspaceId }]] })
    const workspace = { id: workspaceId, name: 'ACME', slug: 'acme', plan: 'agency', accessState: 'active' }
    const connection = { id: 'connection', managerCustomerId: '9999999999', googleEmail: 'ads@example.test', scopes: ['adwords'], status: 'active' }
    const collection = databaseDouble({ query: queryDouble({
      workspace,
      connection,
      rows: {
        clients: [{ id: 'client-1', name: 'Client' }],
        approvals: [{ id: 'approval-1', title: 'Pause' }],
        observations: [{ id: 'observation-1' }],
        audit: [{ id: 'audit-1' }],
        accountMetrics: [{ metricDate: '2026-08-12', costMicros: '10' }],
        campaignMetrics: [{ campaignId: '1', metricDate: '2026-08-12' }],
        offline: [{ uploadClient: 'API' }],
        alerts: [{ id: 'alert-1' }], activation: [{ milestone: 'first_report' }],
        tasks: [{ id: 'task-1' }], taskComments: [{ id: 'comment-1' }],
        supportTickets: [{ id: 'ticket-1' }], supportMessages: [{ id: 'message-1', internal: false }],
        memberPreferences: [{ id: 'preference-1', mentionHandle: 'owner' }],
        templates: [{ id: 'template-1', name: 'Monthly' }],
        templateVersions: [{ templateId: 'template-1', version: 1, snapshot: { name: 'Monthly' } }],
        schedules: [{ id: 'schedule-1' }], keys: [{ tokenPrefix: 'ak_test' }],
        channels: [{ destinationHint: 'o***@example.test' }], legal: [{ termsVersion: 'v1' }],
      },
    }) })
    const progress = databaseDouble()
    const completed = databaseDouble()
    mocks.databases.push(claim.db, collection.db, progress.db, completed.db)

    const result = await runWorkspaceExport(exportJobId, workspaceId)
    expect(result).toMatchObject({ exportJobId, bytes: expect.any(Number), artifactHash: expect.stringMatching(/^[a-f0-9]{64}$/) })
    expect(mocks.put).toHaveBeenCalledWith(
      `exports/${workspaceId}/${exportJobId}.zip`, expect.any(Buffer),
      expect.objectContaining({ access: 'private', allowOverwrite: true, contentType: 'application/zip' }),
    )
    const archive = unzipSync(new Uint8Array(mocks.put.mock.calls[0][1] as Buffer))
    const raw = strFromU8(archive['raw.json'])
    expect(raw).toContain('"googleAdsConnection"')
    expect(raw).not.toContain('encryptedRefreshToken')
    expect(raw).not.toContain('tokenHash')
    expect(strFromU8(archive['reports/template-versions.csv'])).toContain('templateId,version,snapshot')
    expect(strFromU8(archive['README.txt'])).toContain('secrets OAuth')
    expect(progress.capture.sets[0]).toMatchObject({ progress: 55 })
    expect(completed.capture.sets[0]).toMatchObject({ status: 'completed', progress: 100, artifactKey: `exports/${workspaceId}/${exportJobId}.zip` })
  })

  it('refuses stale claims and marks collection failures without publishing', async () => {
    mocks.databases.push(databaseDouble({ statementResults: [[]] }).db)
    await expect(runWorkspaceExport(exportJobId, workspaceId)).rejects.toThrow('unavailable')
    expect(mocks.put).not.toHaveBeenCalled()

    const claim = databaseDouble({ statementResults: [[{ id: exportJobId, workspaceId }]] })
    const missing = databaseDouble({ query: queryDouble() })
    const failed = databaseDouble()
    mocks.databases.push(claim.db, missing.db, failed.db)
    await expect(runWorkspaceExport(exportJobId, workspaceId)).rejects.toThrow('target not found')
    expect(failed.capture.sets[0]).toMatchObject({ status: 'failed', errorMessage: 'Workspace export target not found' })
  })

  it('deletes expired artifacts and tombstones their database pointers', async () => {
    const now = new Date('2026-08-12T12:00:00Z')
    const select = databaseDouble({ statementResults: [[
      { id: 'one', artifactKey: 'exports/one.zip' },
      { id: 'two', artifactKey: null },
    ]] })
    const update = databaseDouble()
    mocks.databases.push(select.db, update.db)
    await expect(deleteExpiredExportArtifacts(now)).resolves.toEqual({ expired: 2 })
    expect(mocks.del).toHaveBeenCalledOnce()
    expect(mocks.del).toHaveBeenCalledWith('exports/one.zip')
    expect(update.capture.sets[0]).toMatchObject({ status: 'expired', artifactKey: null, artifactHash: null, updatedAt: now })

    mocks.databases.push(databaseDouble({ statementResults: [[]] }).db)
    await expect(deleteExpiredExportArtifacts(now)).resolves.toEqual({ expired: 0 })
  })
})
