import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'
import { databaseDouble } from '../../test/fluent-db'

const mocks = vi.hoisted(() => ({
  db: undefined as unknown, transaction: vi.fn(async (fn: (db: unknown) => unknown) => fn(mocks.db)),
  connection: vi.fn(), pacing: vi.fn(), campaign: vi.fn(), terms: vi.fn(), keywords: vi.fn(), ads: vi.fn(), tracking: vi.fn(),
  snapshot: vi.fn(), progress: vi.fn(), persist: vi.fn(),
  analyzeCampaign: vi.fn(), analyzeTerms: vi.fn(), analyzeKeywords: vi.fn(), analyzeAds: vi.fn(), analyzeTracking: vi.fn(), analyzePacing: vi.fn(),
}))
vi.mock('@/db/transactions', () => ({ withSystemTransaction: mocks.transaction }))
vi.mock('@/lib/data', () => ({ getWorkspaceConnection: mocks.connection, getClientGoalAndPacing: mocks.pacing }))
vi.mock('@/lib/google-ads', () => ({ GoogleAdsGateway: class {
  campaignPerformance = mocks.campaign; searchTermPerformance = mocks.terms; keywordPerformance = mocks.keywords
  responsiveSearchAdPerformance = mocks.ads; conversionTrackingStatus = mocks.tracking
} }))
vi.mock('@/lib/performance-history', () => ({ storePerformanceSnapshot: mocks.snapshot }))
vi.mock('@/lib/monitoring-observations', () => ({ readMonitoringProgress: mocks.progress, persistMonitoringObservation: mocks.persist }))
vi.mock('@/lib/monitoring', () => ({ analyzeCampaigns: mocks.analyzeCampaign, analyzeSearchTermsForMonitoring: mocks.analyzeTerms,
  analyzeKeywordsForMonitoring: mocks.analyzeKeywords, analyzeAdsForMonitoring: mocks.analyzeAds,
  analyzeTrackingForMonitoring: mocks.analyzeTracking, analyzePacingForMonitoring: mocks.analyzePacing }))
import { runWorkspaceMonitoring } from './run-monitoring'

const workspaceId = '00000000-0000-4000-8000-000000000001'
const client = { id: '00000000-0000-4000-8000-000000000002', workspaceId, name: 'ACME', googleCustomerId: '1234567890', currencyCode: 'EUR', timezone: 'Europe/Paris', active: true, isManager: false }
const agentId = '00000000-0000-4000-8000-000000000003'
const otherAgentId = '00000000-0000-4000-8000-000000000004'
const scope = { clientId: client.id, agentIds: [agentId], claim: { jobId: '00000000-0000-4000-8000-000000000005', attempt: 1, workerId: 'worker' } }
const finding = { fingerprint: 'finding', severity: 'critical', title: 'Alerte', description: 'Description', value: 42 }
function setup(kinds = ['no_delivery'], accounts = [client]) {
  const agents = kinds.map((kind, index) => ({ id: index === 0 ? agentId : otherAgentId, workspaceId, clientId: null, kind, threshold: '10', enabled: true }))
  const query = { monitoringAgents: { findMany: vi.fn(async () => agents) }, clients: { findMany: vi.fn(async () => accounts) } }
  mocks.db = databaseDouble({ query }).db
  return { agents, query }
}

describe('checkpointed workspace monitoring', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.progress.mockResolvedValue({})
    mocks.persist.mockResolvedValue({ detected: 1, resolved: 0, queued: 1 })
    mocks.connection.mockResolvedValue({})
    for (const read of [mocks.campaign, mocks.terms, mocks.keywords, mocks.ads]) read.mockResolvedValue([])
    mocks.tracking.mockResolvedValue({})
    mocks.pacing.mockResolvedValue({ goal: null, pacing: null, observedDays: 0, calendar: null })
    mocks.snapshot.mockResolvedValue(undefined)
    for (const analyze of [mocks.analyzeCampaign, mocks.analyzeTerms, mocks.analyzeKeywords, mocks.analyzeAds, mocks.analyzeTracking, mocks.analyzePacing]) analyze.mockReturnValue([finding])
    setup()
  })

  it('returns a committed checkpoint without another Google read, even after disconnection', async () => {
    mocks.progress.mockResolvedValue({ [agentId]: { detected: 2, resolved: 1, queued: 3 } })
    mocks.connection.mockResolvedValue(null)
    await expect(runWorkspaceMonitoring(workspaceId, scope)).resolves.toEqual({ agents: 1, clients: 1, detected: 2, resolved: 1, notifications: { queued: 3 } })
    expect(mocks.connection).not.toHaveBeenCalled()
    expect(mocks.persist).not.toHaveBeenCalled()
  })
  it('fails before reading Google if the lease is lost or the connection is missing', async () => {
    mocks.progress.mockRejectedValueOnce(new Error('lease lost'))
    await expect(runWorkspaceMonitoring(workspaceId, scope)).rejects.toThrow('lease lost')
    expect(mocks.connection).not.toHaveBeenCalled()
    mocks.connection.mockResolvedValue(null)
    await expect(runWorkspaceMonitoring(workspaceId, scope)).rejects.toThrow('Connexion Google Ads absente')
    expect(mocks.persist).not.toHaveBeenCalled()
  })
  it.each([
    ['no_delivery', 'campaign', 'analyzeCampaign'], ['wasted_search_terms', 'terms', 'analyzeTerms'],
    ['low_quality_keywords', 'keywords', 'analyzeKeywords'], ['weak_responsive_ads', 'ads', 'analyzeAds'],
    ['tracking_gap', 'tracking', 'analyzeTracking'], ['pacing_variance', 'pacing', 'analyzePacing'], ['forecast_overrun', 'pacing', 'analyzePacing'],
  ] as const)('reads and commits the %s family in its exact scope', async (kind, read, analyze) => {
    const { agents } = setup([kind])
    await expect(runWorkspaceMonitoring(workspaceId, scope)).resolves.toEqual({ agents: 1, clients: 1, detected: 1, resolved: 0, notifications: { queued: 1 } })
    expect(mocks[read]).toHaveBeenCalledOnce()
    expect(mocks[analyze]).toHaveBeenCalledOnce()
    expect(mocks.persist).toHaveBeenCalledWith({ workspaceId, claim: scope.claim, agent: agents[0], clientId: client.id, findings: [finding], observedAt: expect.any(Date) })
  })
  it.each(['no_delivery', 'wasted_search_terms', 'low_quality_keywords', 'weak_responsive_ads', 'tracking_gap', 'pacing_variance'])('shares %s reads across pending vigies', async (kind) => {
    setup([kind, kind])
    await runWorkspaceMonitoring(workspaceId, { ...scope, agentIds: [agentId, otherAgentId] })
    for (const read of [mocks.campaign, mocks.terms, mocks.keywords, mocks.ads, mocks.tracking, mocks.pacing]) expect(read.mock.calls.length).toBeLessThanOrEqual(1)
    expect(mocks.persist).toHaveBeenCalledTimes(2)
  })
  it('filters committed vigies out of the database query and retains their totals', async () => {
    const { query } = setup(['no_delivery'])
    mocks.progress.mockResolvedValue({ [otherAgentId]: { detected: 4, resolved: 2, queued: 1 } })
    const result = await runWorkspaceMonitoring(workspaceId, { ...scope, agentIds: [agentId, otherAgentId] })
    expect(result).toMatchObject({ agents: 2, detected: 5, resolved: 2, notifications: { queued: 2 } })
    const where = (query.monitoringAgents.findMany.mock.calls[0] as unknown as [{ where: SQL }])[0].where
    const compiled = new PgDialect().sqlToQuery(where)
    expect(compiled.params).toContain(agentId)
    expect(compiled.params).not.toContain(otherAgentId)
    const clientWhere = (query.clients.findMany.mock.calls[0] as unknown as [{ where: SQL }])[0].where
    expect(new PgDialect().sqlToQuery(clientWhere).params).toContain(client.id)
  })
  it('does not resolve incidents when Google or the durable commit fails', async () => {
    mocks.campaign.mockRejectedValueOnce(new Error('Google incomplete'))
    await expect(runWorkspaceMonitoring(workspaceId, scope)).rejects.toThrow('Google incomplete')
    expect(mocks.persist).not.toHaveBeenCalled()
    mocks.persist.mockRejectedValueOnce(new Error('rollback'))
    await expect(runWorkspaceMonitoring(workspaceId, scope)).rejects.toThrow('rollback')
  })
  it('does not observe inactive, removed or unrelated accounts', async () => {
    setup(['no_delivery'], [])
    await expect(runWorkspaceMonitoring(workspaceId, scope)).resolves.toMatchObject({ clients: 0, detected: 0 })
    const { agents } = setup()
    agents[0].clientId = 'different' as unknown as null
    await runWorkspaceMonitoring(workspaceId, scope)
    expect(mocks.campaign).not.toHaveBeenCalled()
    expect(mocks.persist).not.toHaveBeenCalled()
  })
})
