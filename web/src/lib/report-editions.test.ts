import { beforeEach, describe, expect, it, vi } from 'vitest'
import { databaseDouble } from '../../test/fluent-db'
import { buildClientReportModel, serializeClientReport } from './client-report-model'
import { calendarDates } from './calendar-window'

const mocks = vi.hoisted(() => ({ db: undefined as unknown, guard: vi.fn(), transaction: vi.fn(async (callback: (db: unknown) => unknown) => callback(mocks.db)), tenant: vi.fn(async (_context: unknown, callback: (db: unknown) => unknown) => callback(mocks.db)) }))
vi.mock('@/db/transactions', () => ({ withSystemTransaction: mocks.transaction, withTenantTransaction: mocks.tenant }))
vi.mock('@/lib/workspace-transaction-guard', () => ({ lockWorkspaceEntitlements: mocks.guard }))
vi.mock('@/lib/crypto', () => ({ encryptSecret: (value: string) => `encrypted:${value}` }))
import { createReportEditionInTransaction, getPublicReportEdition, listWorkspaceReportEditions, ReportDataUnavailable } from './report-editions'

const workspaceId = '00000000-0000-4000-8000-000000000001', shareId = '00000000-0000-4000-8000-000000000002', editionId = '00000000-0000-4000-8000-000000000003'
const now = new Date('2026-09-08T12:00:00Z')
const window = { from: '2026-09-01', through: '2026-09-07', timezone: 'Europe/Paris' }
const model = buildClientReportModel({ generatedAt: now, window, sourceVersion: 'a'.repeat(64), brandName: 'Original', clientName: 'Original client', currencyCode: 'EUR', campaigns: [], editorialComment: 'Old commentary', actionPlan: 'Old plan' })
const existing = { id: editionId, shareId, workspaceId, editionNumber: 1, modelVersion: 1, generatedAt: now, expiresAt: new Date('2026-12-01'), periodFrom: window.from, periodThrough: window.through, timezone: window.timezone, currencyCode: 'EUR', sourceVersion: model.sourceVersion, payload: serializeClientReport(model) }
const rows = calendarDates(window).map((metricDate) => ({ metricDate, timezone: window.timezone, currencyCode: 'EUR', coverageStatus: 'complete', sourceVersion: 'v1', costMicros: '2000000', impressions: '100', clicks: '10', conversions: '0.3000', conversionValueMicros: '4000000' }))
const aggregate = { campaign_id: '42', name: 'Removed campaign', channel_type: 'SEARCH', status: 'REMOVED', currency_valid: true, cost_micros: '7000000', impressions: '350', clicks: '35', conversions: '0.7000', conversion_value_micros: '14000000' }
function database(input: { share?: object | null; client?: object | null; workspace?: object | null; rows?: unknown[]; aggregates?: unknown[]; editions?: unknown[] } = {}) {
  const editions = [...(input.editions ?? [undefined, undefined, undefined])]
  const share = input.share === null ? null : { id: shareId, clientId: 'client-1', mode: 'fixed', active: true, periodDays: 7, locale: 'fr', editorialComment: 'Current', actionPlan: 'Current plan', ...input.share }
  const result = databaseDouble({ statementResults: [share ? [share] : [], [], { rows: input.aggregates ?? [aggregate] }, [existing]], query: {
    clients: { findFirst: async () => input.client === null ? null : { id: 'client-1', timezone: window.timezone, currencyCode: 'EUR', name: 'Current client', ...input.client } },
    workspaces: { findFirst: async () => input.workspace === null ? null : { id: workspaceId, plan: 'agency', brandName: 'Current agency', ...input.workspace } },
    dailyAccountMetrics: { findMany: async () => input.rows ?? rows },
    reportEditions: { findFirst: async () => editions.shift(), findMany: async () => [existing] },
  } })
  mocks.db = result.db
  return result
}
const input = { workspaceId, shareId, actorUserId: 'owner', kind: 'initial' as const, now }
async function publish(options: Parameters<typeof database>[0] = {}, overrides: Partial<Parameters<typeof createReportEditionInTransaction>[1]> = {}) {
  const db = database(options)
  // The test double implements the fluent transaction surface; real SQL behavior is verified in the disposable PostgreSQL suite.
  const result = await createReportEditionInTransaction(db.db as unknown as Parameters<typeof createReportEditionInTransaction>[0], { ...input, ...overrides })
  return { result, capture: db.capture }
}

describe('report edition publication decisions', () => {
  beforeEach(() => { vi.clearAllMocks() })
  it('uses exact account totals, keeps removed campaigns and persists provenance', async () => {
    const { result, capture } = await publish()
    expect(result.model.totals).toMatchObject({ costMicros: '14000000', clicks: '70', conversions: 2.1 })
    expect(result.model.campaigns[0]).toMatchObject({ status: 'REMOVED', costMicros: '7000000' })
    expect(capture.values[0]).toMatchObject({ periodFrom: window.from, periodThrough: window.through, sourceVersion: expect.stringMatching(/^[a-f0-9]{64}$/), editionNumber: 1, kind: 'initial', encryptedDelivery: null })
    expect(capture.values[1]).toMatchObject({ action: 'report.edition_created' })
  })
  it.each(['solo', 'studio', 'agency'])('applies publication branding for %s', async (plan) => {
    const { result } = await publish({ workspace: { plan }, aggregates: [] })
    expect(result.model.brandName).toBe(plan === 'solo' ? 'Ads by Yodev' : 'Current agency')
    expect(result.model.poweredByYodev).toBe(plan === 'studio')
    expect(result.model.campaigns).toEqual([])
  })
  it('returns an existing scheduled edition before interpreting a changed invalid template', async () => {
    const build = vi.fn()
    const { result, capture } = await publish({ editions: [existing] }, { kind: 'scheduled', periodSource: { periodDays: 45 }, delivery: { scheduleId: 'schedule-1', runKey: 'weekly:2026-09-08', tokenHash: 'hash', build } })
    expect(result.created).toBe(false); expect(build).not.toHaveBeenCalled(); expect(capture.values).toEqual([])
  })
  it('freezes a new scheduled payload and allows an explicit empty editorial template', async () => {
    const build = vi.fn(() => ({ from: 'a@example.test', to: ['b@example.test'], subject: 'Edition', html: 'Original' }))
    const { result, capture } = await publish({}, { kind: 'scheduled', editorial: { locale: 'en', editorialComment: null, actionPlan: null }, delivery: { scheduleId: 'schedule-1', runKey: 'weekly:2026-09-08', tokenHash: 'hash', build } })
    expect(build).toHaveBeenCalledOnce(); expect(result.model.editorialComment).toBeNull(); expect(result.model.actionPlan).toBeNull()
    expect(capture.values[0]).toMatchObject({ encryptedDelivery: expect.stringContaining('Original'), deliveryTokenHash: 'hash' })
  })
  it('revisions retain the old window, names and editorial content while recalculating metrics', async () => {
    const { result, capture } = await publish({ editions: [existing, undefined, { editionNumber: 4 }] }, { kind: 'revision', previousEditionId: editionId })
    expect(result.model).toMatchObject({ brandName: 'Original', clientName: 'Original client', editorialComment: 'Old commentary', actionPlan: 'Old plan', window })
    expect(capture.values[0]).toMatchObject({ editionNumber: 5, previousEditionId: editionId })
  })
  it('reuses an unchanged dynamic publication', async () => {
    const { result, capture } = await publish({ share: { mode: 'dynamic' }, editions: [existing] }, { kind: 'dynamic' })
    expect(result.created).toBe(false); expect(capture.values).toEqual([])
  })
  it.each([{ share: null }, { client: null }, { workspace: null }, { rows: [] }, { rows: rows.map((row) => ({ ...row, coverageStatus: 'legacy' })) }, { aggregates: [{ ...aggregate, currency_valid: false }] }, { rows: rows.map((row) => ({ ...row, conversions: 'not-a-number' })) }])('fails closed for unavailable or unqualified data %j', async (options) => {
    await expect(publish(options)).rejects.toBeInstanceOf(ReportDataUnavailable)
  })
  it.each([{ client: { timezone: 'UTC' } }, { client: { currencyCode: 'USD' } }])('rejects revision after account metadata drift %j', async (options) => {
    await expect(publish({ ...options, editions: [existing] }, { kind: 'revision', previousEditionId: editionId })).rejects.toBeInstanceOf(ReportDataUnavailable)
  })
  it('rejects a missing previous edition', async () => {
    await expect(publish({}, { kind: 'revision', previousEditionId: editionId })).rejects.toBeInstanceOf(ReportDataUnavailable)
  })
  it('rejects oversized editorial content and inconsistent scheduled inputs', async () => {
    await expect(publish({ share: { editorialComment: 'x'.repeat(15_000_001) } })).rejects.toBeInstanceOf(ReportDataUnavailable)
    await expect(publish({}, { kind: 'scheduled' })).rejects.toThrow('Invalid scheduled')
  })
})

describe('public edition reads', () => {
  it('loads the fixed initial edition and scopes historical metadata to a tenant', async () => {
    database({ editions: [existing] })
    await expect(getPublicReportEdition({ workspaceId, shareId, now })).resolves.toMatchObject({ edition: { id: editionId }, created: false })
    await expect(listWorkspaceReportEditions(workspaceId)).resolves.toEqual([existing])
    expect(mocks.tenant).toHaveBeenCalledWith({ workspaceId, userId: 'repository:report-editions' }, expect.any(Function))
  })
  it.each([{ modelVersion: 2 }, { expiresAt: now }, { periodFrom: '2026-08-01' }, { timezone: 'UTC' }, { currencyCode: 'USD' }, { sourceVersion: 'changed' }, { generatedAt: new Date('2026-09-08T11:00:00Z') }])('rejects expired or internally inconsistent editions %j', async (override) => {
    database({ editions: [{ ...existing, ...override }] })
    await expect(getPublicReportEdition({ workspaceId, shareId, editionId, now })).rejects.toBeInstanceOf(ReportDataUnavailable)
  })
  it('rejects expired links, absent editions and malformed IDs', async () => {
    database({ share: { expiresAt: now }, editions: [existing] })
    await expect(getPublicReportEdition({ workspaceId, shareId, now })).rejects.toBeInstanceOf(ReportDataUnavailable)
    database({ editions: [undefined] })
    await expect(getPublicReportEdition({ workspaceId, shareId, now })).rejects.toBeInstanceOf(ReportDataUnavailable)
    expect(() => getPublicReportEdition({ workspaceId, shareId, editionId: 'bad-id' })).toThrow(ReportDataUnavailable)
  })
})
