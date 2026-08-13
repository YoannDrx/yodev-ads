import { beforeEach, describe, expect, it, vi } from 'vitest'
import { databaseDouble } from '../../test/fluent-db'

const mocks = vi.hoisted(() => ({
  databases: [] as unknown[],
  tenantContexts: [] as unknown[],
  tenant: vi.fn(async (context: unknown, callback: (db: unknown) => unknown) => {
    mocks.tenantContexts.push(context)
    return callback(mocks.databases.shift())
  }),
  system: vi.fn(async (callback: (db: unknown) => unknown) => callback(mocks.databases.shift())),
  cookieValue: undefined as string | undefined,
  cookies: vi.fn(async () => ({ get: () => mocks.cookieValue ? { value: mocks.cookieValue } : undefined })),
}))

vi.mock('@/db/transactions', () => ({
  withTenantTransaction: mocks.tenant,
  withSystemTransaction: mocks.system,
}))
vi.mock('next/headers', () => ({ cookies: mocks.cookies }))

import * as repository from './data'

const workspaceId = '00000000-0000-4000-8000-000000000001'
const clientId = '00000000-0000-4000-8000-000000000002'

function queryMap(input: Record<string, { first?: unknown; many?: unknown[] }> = {}) {
  return new Proxy({}, {
    get(_target, table) {
      const result = input[String(table)] ?? {}
      return {
        findFirst: vi.fn(async () => result.first),
        findMany: vi.fn(async () => result.many ?? []),
      }
    },
  }) as Record<string, Record<string, (...args: unknown[]) => unknown>>
}

function queryDatabase(input: Record<string, { first?: unknown; many?: unknown[] }>) {
  return databaseDouble({ query: queryMap(input) })
}

describe('tenant-aware data repository', () => {
  beforeEach(() => {
    mocks.databases = []
    mocks.tenantContexts = []
    mocks.cookieValue = undefined
    vi.clearAllMocks()
    delete process.env.NEXT_PUBLIC_APP_URL
  })

  it('routes simple tenant reads through an explicit workspace context', async () => {
    const rows = [{ id: 'row-1' }]
    const calls: Array<() => Promise<unknown>> = [
      () => repository.getWorkspaceConnection(workspaceId),
      () => repository.listWorkspaceClients(workspaceId),
      () => repository.listWorkspaceExports(workspaceId),
      () => repository.listWorkspaceDeadLetters(workspaceId),
      () => repository.listWorkspaceDomains(workspaceId),
      () => repository.listDailyAccountHistory(workspaceId, clientId, 30),
      () => repository.listAuditEvents(workspaceId),
      () => repository.getMyTaskNotificationPreferences(workspaceId, 'user-1'),
      () => repository.listTaskMentionDirectory(workspaceId),
      () => repository.listApiKeys(workspaceId),
      () => repository.listNotificationChannels(workspaceId),
      () => repository.getWorkspaceSafetyPolicy(workspaceId),
    ]
    for (const call of calls) {
      mocks.databases.push(queryDatabase(new Proxy({}, {
        get: () => ({ first: rows[0], many: rows }),
      }) as Record<string, { first?: unknown; many?: unknown[] }>).db)
      await expect(call()).resolves.toBeDefined()
    }
    expect(mocks.tenantContexts).toHaveLength(calls.length)
    expect(mocks.tenantContexts.every((context) =>
      (context as { workspaceId?: string; userId?: string }).workspaceId === workspaceId &&
      (context as { workspaceId?: string; userId?: string }).userId === 'repository:read')).toBe(true)
  })

  it('resolves active origins and validates public hosts without trusting forwarded-port syntax', async () => {
    mocks.databases.push(queryDatabase({
      workspaces: { first: { accessState: 'active', plan: 'agency' } },
      workspaceDomains: { first: { hostname: 'reports.acme.test' } },
    }).db)
    await expect(repository.activeWorkspaceOrigin(workspaceId)).resolves.toBe('https://reports.acme.test')
    mocks.databases.push(queryDatabase({
      workspaces: { first: { accessState: 'active', plan: 'solo' } },
      workspaceDomains: { first: { hostname: 'reports.acme.test' } },
    }).db)
    await expect(repository.activeWorkspaceOrigin(workspaceId)).resolves.toBe('https://ads.yodev.fr')

    process.env.NEXT_PUBLIC_APP_URL = 'https://ads.example.test'
    await expect(repository.publicHostBelongsToWorkspace('ADS.EXAMPLE.TEST:443', workspaceId)).resolves.toBe(true)
    mocks.databases.push(queryDatabase({
      workspaces: { first: { accessState: 'active', plan: 'agency' } },
      workspaceDomains: { first: { id: 'domain-1' } },
    }).db)
    await expect(repository.publicHostBelongsToWorkspace('reports.acme.test, proxy.local', workspaceId)).resolves.toBe(true)
    mocks.databases.push(queryDatabase({
      workspaces: { first: { accessState: 'active', plan: 'solo' } },
      workspaceDomains: { first: { id: 'domain-1' } },
    }).db)
    await expect(repository.publicHostBelongsToWorkspace('reports.acme.test', workspaceId)).resolves.toBe(false)
  })

  it('uses an explicitly selected active client and falls back to the first advertiser', async () => {
    const selected = { id: clientId, name: 'Selected' }
    mocks.databases.push(queryDatabase({ clients: { first: selected } }).db)
    await expect(repository.getWorkspaceClient(workspaceId, clientId)).resolves.toEqual(selected)

    const fallback = { id: 'fallback', name: 'Fallback' }
    mocks.databases.push(queryDatabase({ clients: {} }).db, queryDatabase({ clients: { first: fallback } }).db)
    await expect(repository.getWorkspaceClient(workspaceId, 'missing')).resolves.toEqual(fallback)
  })

  it('deduplicates latest conversion and offline diagnostic snapshots by resource identity', async () => {
    const conversions = [
      { resourceName: 'conversion/1', snapshotDate: '2026-08-12' },
      { resourceName: 'conversion/1', snapshotDate: '2026-08-11' },
      { resourceName: 'conversion/2', snapshotDate: '2026-08-12' },
    ]
    mocks.databases.push(queryDatabase({ conversionActionSnapshots: { many: conversions } }).db)
    await expect(repository.listLatestConversionActionSnapshots(workspaceId, clientId)).resolves.toEqual([conversions[0], conversions[2]])

    const diagnostics = [
      { uploadClient: 'API', snapshotDate: '2026-08-12' },
      { uploadClient: 'API', snapshotDate: '2026-08-11' },
      { uploadClient: 'WEB', snapshotDate: '2026-08-12' },
    ]
    mocks.databases.push(queryDatabase({ offlineConversionDiagnostics: { many: diagnostics } }).db)
    await expect(repository.listLatestOfflineConversionDiagnostics(workspaceId, clientId)).resolves.toEqual([diagnostics[0], diagnostics[2]])
  })

  it('builds a unified client timeline from external and internal changes', async () => {
    const changes = [{ id: 'change-1' }]
    const internal = [{ audit: { id: 'audit-1' }, approval: { id: 'approval-1' } }]
    mocks.databases.push(databaseDouble({
      statementResults: [internal],
      query: queryMap({ googleChangeEvents: { many: changes } }),
    }).db)
    await expect(repository.listClientTimeline(workspaceId, clientId)).resolves.toEqual({ changes, internal })
  })

  it('enriches approvals with comments, client feedback and mutation observations', async () => {
    const request = { id: 'approval-1' }
    const rows = [{ request, client: { id: clientId } }]
    const comments = [{ id: 'comment-1', approvalId: request.id }, { id: 'comment-2', approvalId: request.id }]
    const feedback = [{ id: 'feedback-1', approvalId: request.id }]
    const observations = [{ id: 'observation-1', approvalId: request.id }]
    mocks.databases.push(databaseDouble({
      statementResults: [rows],
      query: queryMap({
        approvalComments: { many: comments }, clientApprovalFeedback: { many: feedback }, mutationObservations: { many: observations },
      }),
    }).db)
    await expect(repository.listApprovals(workspaceId)).resolves.toEqual([{
      ...rows[0], comments, clientFeedback: feedback[0], observation: observations[0],
    }])
  })

  it('returns joined monitoring, alert, share and public-approval views', async () => {
    const joined = [{ id: 'joined' }]
    for (const call of [
      () => repository.listMonitoringAgents(workspaceId),
      () => repository.listAlertIncidents(workspaceId),
      () => repository.listShareLinks(workspaceId),
      () => repository.listPublicClientApprovals(workspaceId, clientId, 'share-1'),
    ]) {
      mocks.databases.push(databaseDouble({ statementResults: [joined] }).db)
      await expect(call()).resolves.toEqual(joined)
    }
  })

  it('groups task comments and public support messages under their parent records', async () => {
    const taskRows = [{ task: { id: 'task-1' }, client: null }, { task: { id: 'task-2' }, client: null }]
    const taskComments = [{ id: 'comment-1', taskId: 'task-1' }]
    mocks.databases.push(databaseDouble({
      statementResults: [taskRows], query: queryMap({ taskComments: { many: taskComments } }),
    }).db)
    await expect(repository.listWorkspaceTasks(workspaceId)).resolves.toEqual([
      { ...taskRows[0], comments: taskComments }, { ...taskRows[1], comments: [] },
    ])

    const tickets = [{ id: 'ticket-1' }, { id: 'ticket-2' }]
    const messages = [{ id: 'message-1', ticketId: 'ticket-1', internal: false }]
    mocks.databases.push(queryDatabase({ supportTickets: { many: tickets }, supportMessages: { many: messages } }).db)
    await expect(repository.listWorkspaceSupportTickets(workspaceId)).resolves.toEqual([
      { ticket: tickets[0], messages }, { ticket: tickets[1], messages: [] },
    ])
  })

  it('loads active report templates and their joined schedules together', async () => {
    const templates = [{ id: 'template-1', name: 'Monthly' }]
    const schedules = [{ schedule: { id: 'schedule-1' }, client: { id: clientId }, template: templates[0] }]
    mocks.databases.push(databaseDouble({
      statementResults: [schedules], query: queryMap({ reportTemplates: { many: templates } }),
    }).db)
    await expect(repository.listReportAutomation(workspaceId)).resolves.toEqual({ templates, schedules })
  })

  it('validates public report expiry and custom-domain ownership', async () => {
    const result = {
      share: { id: 'share-1', workspaceId, expiresAt: new Date(Date.now() + 60_000) },
      client: { id: clientId }, connection: { id: 'connection' }, workspace: { id: workspaceId, accessState: 'active' },
    }
    mocks.databases.push(databaseDouble({ statementResults: [[result]] }).db)
    await expect(repository.getPublicShare('token')).resolves.toEqual(result)

    mocks.databases.push(databaseDouble({ statementResults: [[{ ...result, share: { ...result.share, expiresAt: new Date(0) } }]] }).db)
    await expect(repository.getPublicShare('token')).resolves.toBeUndefined()

    mocks.databases.push(databaseDouble({ statementResults: [[{ ...result, workspace: { ...result.workspace, accessState: 'suspended' } }]] }).db)
    await expect(repository.getPublicShare('token')).resolves.toBeUndefined()

    mocks.databases.push(
      databaseDouble({ statementResults: [[result]] }).db,
      queryDatabase({ workspaceDomains: {} }).db,
    )
    await expect(repository.getPublicShare('token', 'unverified.example')).resolves.toBeUndefined()
  })

  it('requires an authenticated OTP feedback cookie before reading a recipient', async () => {
    await expect(repository.getVerifiedReportRecipient(workspaceId, 'share-1')).resolves.toBeUndefined()
    expect(mocks.tenant).not.toHaveBeenCalled()

    mocks.cookieValue = 'session-token'
    const recipient = { id: 'recipient-1', email: 'client@example.test', verifiedAt: new Date() }
    mocks.databases.push(queryDatabase({ reportRecipients: { first: recipient } }).db)
    await expect(repository.getVerifiedReportRecipient(workspaceId, 'share-1')).resolves.toEqual(recipient)
  })

  it('returns missing goals explicitly and calculates pacing from tenant daily metrics', async () => {
    mocks.databases.push(queryDatabase({ clientGoals: {} }).db)
    await expect(repository.getClientGoalAndPacing(workspaceId, clientId, 'Europe/Paris')).resolves.toEqual({ goal: undefined, pacing: undefined })

    const goal = { monthlyBudgetMicros: '31000000' }
    mocks.databases.push(databaseDouble({
      statementResults: [[{ observedDays: 10, spendMicros: '10000000' }]],
      query: queryMap({ clientGoals: { first: goal } }),
    }).db)
    await expect(repository.getClientGoalAndPacing(workspaceId, clientId, 'Europe/Paris')).resolves.toMatchObject({
      goal, observedDays: 10, pacing: expect.objectContaining({ actualSpendMicros: 10000000 }),
    })
  })
})
