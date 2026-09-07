import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { databaseDouble } from '../../test/fluent-db'
import type { ClaimedJob } from './jobs'

const mocks = vi.hoisted(() => ({ databases: [] as unknown[], transaction: vi.fn(async (callback: (db: unknown) => unknown) => callback(mocks.databases.shift())), send: vi.fn(), edition: vi.fn(), enabled: vi.fn(() => true) }))
vi.mock('@/db/transactions', () => ({ withSystemTransaction: mocks.transaction }))
vi.mock('@/lib/crypto', () => ({ decryptSecret: (value: string) => value }))
vi.mock('@/lib/tokens', () => ({ hashToken: () => 'token-hash' }))
vi.mock('@/lib/report-editions', () => ({ createReportEditionInTransaction: mocks.edition, ReportDataUnavailable: class extends Error {} }))
vi.mock('@/lib/transactional-email', () => ({ sendTransactionalEmail: mocks.send }))
vi.mock('@/lib/feature-flags', () => ({ featureEnabled: mocks.enabled }))
import { deliverScheduledReport } from './scheduled-reports'

const workspaceId = '00000000-0000-4000-8000-000000000001'
const scheduleId = '00000000-0000-4000-8000-000000000002'
const now = new Date('2026-09-07T08:00:00Z')
const runKey = 'weekly:2026-09-06'
const job: ClaimedJob = { id: '00000000-0000-4000-8000-000000000003', workspaceId, leaseOwner: 'worker-1', attemptCount: 2, type: 'report.schedule_deliver', createdAt: new Date('2026-09-06T08:00:00Z'), payload: { scheduleId, runKey }, updatedAt: now, lastError: null, status: 'running', priority: 100, deduplicationKey: null, availableAt: now, leaseExpiresAt: new Date(now.getTime() + 300_000), maximumAttempts: 5, completedAt: null, deadLetteredAt: null }
const schedule = { id: scheduleId, workspaceId, clientId: 'client-1', shareId: 'share-1', templateId: 'template-1', enabled: true, lastRunKey: null, recipientEmails: ['new@example.test'], deliveryLeaseUntil: null, encryptedReportToken: 'token', name: 'New template' }
const frozenDelivery = { from: 'Original <original@example.test>', to: ['original@example.test'], subject: 'Original report', html: '<p>Original edition</p>' }
const issued = { edition: { id: 'edition-1', shareId: 'share-1', sourceVersion: 'abc123', encryptedDelivery: JSON.stringify(frozenDelivery), deliveryTokenHash: 'token-hash', expiresAt: new Date('2026-11-01') } }
function context(input: { schedule?: object; client?: object; share?: object; workspace?: object; job?: unknown[] } = {}) {
  return databaseDouble({ statementResults: [[], [{ ...schedule, ...input.schedule }], input.job ?? [job]], query: {
    workspaces: { findFirst: async () => ({ id: workspaceId, accessState: 'active', plan: 'agency', ...input.workspace }) },
    clients: { findFirst: async () => ({ id: 'client-1', active: true, isManager: false, ...input.client }) },
    shareLinks: { findFirst: async () => ({ id: 'share-1', clientId: 'client-1', active: true, tokenHash: 'token-hash', expiresAt: new Date('2026-11-01'), periodDays: 30, ...input.share }) },
    reportTemplates: { findFirst: async () => ({ active: true, locale: 'en', periodDays: 90, editorialComment: null, actionPlan: null }) },
    workspaceDomains: { findFirst: async () => ({ hostname: 'reports.example.test' }) },
  } })
}
function prepare(input: Parameters<typeof context>[0] = {}) {
  const first = context(input)
  const admission = () => context({ schedule: { deliveryLeaseOwner: (first.capture.sets[1] as { deliveryLeaseOwner: string }).deliveryLeaseOwner, deliveryLeaseUntil: new Date(now.getTime() + 300_000) } })
  const success = databaseDouble({ statementResults: [[], [job], [{ id: scheduleId }]] })
  // Resolve the admission database after the first transaction has stored its lease owner.
  let admissionDatabase: ReturnType<typeof context> | undefined
  mocks.databases.push(first.db, new Proxy({}, { get: (_target, key) => { admissionDatabase ??= admission(); return Reflect.get(admissionDatabase.db, key) } }), success.db)
  return { first, success }
}

describe('immutable scheduled report delivery', () => {
  afterEach(() => vi.useRealTimers())
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(now); vi.clearAllMocks(); mocks.databases = []; mocks.enabled.mockReturnValue(true); mocks.edition.mockResolvedValue(issued); mocks.send.mockResolvedValue({ providerMessageId: 'email-1' }) })
  it('reuses frozen recipients and body on retry, anchors to persisted enqueue time and audits the edition', async () => {
    const { first, success } = prepare()
    await expect(deliverScheduledReport(scheduleId, runKey, job)).resolves.toMatchObject({ delivered: true, recipientCount: 1 })
    expect(mocks.edition).toHaveBeenCalledWith(first.db, expect.objectContaining({ anchorAt: job.createdAt, periodSource: expect.objectContaining({ periodDays: 90 }) }))
    expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({ ...frozenDelivery, idempotencyKey: `report-schedule:${scheduleId}:${runKey}` }))
    expect(first.capture.sets[0]).not.toHaveProperty('editorialComment')
    expect(success.capture.values[0]).toMatchObject({ action: 'report.schedule_delivered', metadata: expect.objectContaining({ editionId: 'edition-1' }) })
  })
  it.each([[{ client: { active: false } }, 'account_inactive'], [{ schedule: { enabled: false } }, 'disabled'], [{ schedule: { lastRunKey: runKey } }, 'already_delivered']] as const)('skips ineligible context %j', async (input, reason) => {
    mocks.databases.push(context(input).db)
    await expect(deliverScheduledReport(scheduleId, runKey, job)).resolves.toEqual({ skipped: true, reason })
    expect(mocks.edition).not.toHaveBeenCalled(); expect(mocks.send).not.toHaveBeenCalled()
  })
  it('rejects a replaced job lease before publication', async () => {
    mocks.databases.push(context({ job: [] }).db)
    await expect(deliverScheduledReport(scheduleId, runKey, job)).rejects.toThrow('lease lost')
    expect(mocks.edition).not.toHaveBeenCalled()
  })
  it('does not send a frozen edition after its token was replaced', async () => {
    mocks.edition.mockResolvedValue({ edition: { ...issued.edition, deliveryTokenHash: 'old-token-hash' } })
    mocks.databases.push(context().db)
    await expect(deliverScheduledReport(scheduleId, runKey, job)).rejects.toThrow('révoqué')
    expect(mocks.send).not.toHaveBeenCalled()
  })
  it('rolls publication back on incomplete history before acquiring any delivery lease', async () => {
    const first = context(); mocks.databases.push(first.db); mocks.edition.mockRejectedValue(new Error('coverage incomplete'))
    await expect(deliverScheduledReport(scheduleId, runKey, job)).rejects.toThrow('coverage incomplete')
    expect(first.capture.sets).toEqual([]); expect(mocks.send).not.toHaveBeenCalled()
  })
  it('rejects a worker replaced between publication and transport admission', async () => {
    const first = context(); const failed = databaseDouble()
    mocks.databases.push(first.db, context({ schedule: { deliveryLeaseOwner: 'successor', deliveryLeaseUntil: new Date(now.getTime() + 300_000) } }).db, failed.db)
    await expect(deliverScheduledReport(scheduleId, runKey, job)).rejects.toThrow('lease lost')
    expect(mocks.send).not.toHaveBeenCalled()
    expect(failed.capture.sets[0]).toMatchObject({ deliveryLeaseOwner: null })
  })
  it('preserves publication and records only a safe failure message after an ambiguous transport', async () => {
    const { success } = prepare(); mocks.send.mockRejectedValue(new Error('SQL secret recipient@example.test'))
    await expect(deliverScheduledReport(scheduleId, runKey, job)).rejects.toThrow('SQL secret')
    expect(success.capture.sets[0]).toMatchObject({ lastError: expect.stringContaining('même édition'), deliveryLeaseOwner: null })
    expect(JSON.stringify(success.capture.sets)).not.toContain('recipient@example.test')
  })
  it('stops before database access when notifications are disabled or identity is absent', async () => {
    mocks.enabled.mockReturnValue(false)
    await expect(deliverScheduledReport(scheduleId, runKey, job)).rejects.toThrow('désactivés')
    await expect(deliverScheduledReport(scheduleId, runKey, { ...job, workspaceId: null })).rejects.toThrow('workspace')
    expect(mocks.transaction).not.toHaveBeenCalled()
  })
})
