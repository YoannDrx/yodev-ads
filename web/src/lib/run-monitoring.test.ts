import { beforeEach, describe, expect, it, vi } from 'vitest'
import { databaseDouble } from '../../test/fluent-db'

const mocks = vi.hoisted(() => ({
  databases: [] as unknown[],
  runTransaction: vi.fn(async (callback: (db: unknown) => unknown) => callback(mocks.databases.shift())),
  getWorkspaceConnection: vi.fn(),
  getClientGoalAndPacing: vi.fn(),
  campaignPerformance: vi.fn(),
  searchTermPerformance: vi.fn(),
  keywordPerformance: vi.fn(),
  responsiveSearchAdPerformance: vi.fn(),
  conversionTrackingStatus: vi.fn(),
  dispatchNotifications: vi.fn(),
  storeSnapshot: vi.fn(),
  analyzeCampaigns: vi.fn(),
  analyzeSearchTerms: vi.fn(),
  analyzeKeywords: vi.fn(),
  analyzeAds: vi.fn(),
  analyzeTracking: vi.fn(),
  analyzePacing: vi.fn(),
}))

vi.mock('@/db/transactions', () => ({ withSystemTransaction: mocks.runTransaction }))
vi.mock('@/lib/data', () => ({
  getWorkspaceConnection: mocks.getWorkspaceConnection,
  getClientGoalAndPacing: mocks.getClientGoalAndPacing,
}))
vi.mock('@/lib/google-ads', () => ({
  GoogleAdsGateway: class {
    campaignPerformance = mocks.campaignPerformance
    searchTermPerformance = mocks.searchTermPerformance
    keywordPerformance = mocks.keywordPerformance
    responsiveSearchAdPerformance = mocks.responsiveSearchAdPerformance
    conversionTrackingStatus = mocks.conversionTrackingStatus
  },
}))
vi.mock('@/lib/notifications', () => ({ dispatchIncidentNotifications: mocks.dispatchNotifications }))
vi.mock('@/lib/performance-history', () => ({ storePerformanceSnapshot: mocks.storeSnapshot }))
vi.mock('@/lib/monitoring', () => ({
  analyzeCampaigns: mocks.analyzeCampaigns,
  analyzeSearchTermsForMonitoring: mocks.analyzeSearchTerms,
  analyzeKeywordsForMonitoring: mocks.analyzeKeywords,
  analyzeAdsForMonitoring: mocks.analyzeAds,
  analyzeTrackingForMonitoring: mocks.analyzeTracking,
  analyzePacingForMonitoring: mocks.analyzePacing,
}))

import { runWorkspaceMonitoring } from './run-monitoring'

const workspaceId = '00000000-0000-4000-8000-000000000001'
const client = {
  id: '00000000-0000-4000-8000-000000000002', workspaceId, name: 'ACME', googleCustomerId: '1234567890',
  currencyCode: 'EUR', timezone: 'Europe/Paris', active: true, isManager: false,
}

function agent(kind: string, overrides: Record<string, unknown> = {}) {
  return {
    id: `00000000-0000-4000-8000-${String(agent.sequence++).padStart(12, '0')}`,
    workspaceId, clientId: client.id, kind, name: kind, threshold: '10', enabled: true,
    reminderIntervalHours: null, ...overrides,
  }
}
agent.sequence = 10

const finding = {
  fingerprint: 'finding:1', severity: 'critical' as const, title: 'Dépense anormale',
  description: 'Une description', value: 42, campaignId: '1', campaignName: 'Brand',
}

function queryDouble(input: { agents?: unknown[]; clients?: unknown[]; existing?: unknown; unresolved?: unknown[] } = {}) {
  return {
    monitoringAgents: { findMany: vi.fn(async () => input.agents ?? []) },
    clients: { findMany: vi.fn(async () => input.clients ?? []) },
    alertIncidents: {
      findFirst: vi.fn(async () => input.existing),
      findMany: vi.fn(async () => input.unresolved ?? []),
    },
  }
}

function initialDatabase(agents: unknown[], clients: unknown[] = [client]) {
  return databaseDouble({ query: queryDouble({ agents, clients }) })
}

function findingDatabase(existing?: unknown) {
  return databaseDouble({
    statementResults: [[{ id: '00000000-0000-4000-8000-000000000099' }]],
    query: queryDouble({ existing }),
  })
}

function resolutionDatabase(unresolved: unknown[] = []) {
  return databaseDouble({ query: queryDouble({ unresolved }) })
}

describe('workspace monitoring orchestration', () => {
  beforeEach(() => {
    mocks.databases = []
    vi.clearAllMocks()
    agent.sequence = 10
    mocks.getWorkspaceConnection.mockResolvedValue({ encryptedRefreshToken: 'cipher', managerCustomerId: '9999999999' })
    mocks.dispatchNotifications.mockResolvedValue({ delivered: 1, failed: 0 })
    mocks.campaignPerformance.mockResolvedValue([])
    mocks.searchTermPerformance.mockResolvedValue([])
    mocks.keywordPerformance.mockResolvedValue([])
    mocks.responsiveSearchAdPerformance.mockResolvedValue([])
    mocks.conversionTrackingStatus.mockResolvedValue({})
    mocks.getClientGoalAndPacing.mockResolvedValue({ goal: null, pacing: null, observedDays: 0, calendar: null })
    mocks.storeSnapshot.mockResolvedValue(undefined)
    for (const analyzer of [mocks.analyzeCampaigns, mocks.analyzeSearchTerms, mocks.analyzeKeywords, mocks.analyzeAds, mocks.analyzeTracking, mocks.analyzePacing]) {
      analyzer.mockReturnValue([])
    }
  })

  it('fails before touching tenant data when Google is disconnected', async () => {
    mocks.getWorkspaceConnection.mockResolvedValue(null)
    await expect(runWorkspaceMonitoring(workspaceId)).rejects.toThrow('Connexion Google Ads absente')
    expect(mocks.runTransaction).not.toHaveBeenCalled()
  })

  it('handles a workspace with no enabled vigies without Google reads', async () => {
    mocks.databases.push(initialDatabase([]).db)
    await expect(runWorkspaceMonitoring(workspaceId)).resolves.toEqual({
      agents: 0, clients: 0, detected: 0, resolved: 0, notifications: { delivered: 0, failed: 0 },
    })
    expect(mocks.campaignPerformance).not.toHaveBeenCalled()
  })

  it('opens, notifies and persists a new campaign incident', async () => {
    const campaignAgent = agent('no_delivery')
    mocks.analyzeCampaigns.mockReturnValue([finding])
    const initial = initialDatabase([campaignAgent])
    const upsert = findingDatabase()
    const notified = databaseDouble()
    const resolution = resolutionDatabase()
    mocks.databases.push(initial.db, upsert.db, notified.db, resolution.db)
    await expect(runWorkspaceMonitoring(workspaceId)).resolves.toEqual({
      agents: 1, clients: 1, detected: 1, resolved: 0, notifications: { delivered: 1, failed: 0 },
    })
    expect(mocks.campaignPerformance).toHaveBeenCalledWith(client.googleCustomerId)
    expect(mocks.storeSnapshot).toHaveBeenCalledWith(expect.objectContaining({ workspaceId, clientId: client.id }))
    expect(mocks.dispatchNotifications).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId, severity: 'critical', eventKey: expect.stringContaining(':opened:'),
    }))
    expect(notified.capture.sets[0]).toMatchObject({ lastNotifiedAt: expect.any(Date) })
  })

  it('reopens a resolved incident and retains acknowledged incidents without duplicate notifications', async () => {
    const campaignAgent = agent('budget_pressure')
    mocks.analyzeCampaigns.mockReturnValue([finding])
    const resolved = { status: 'resolved', severity: 'warning', createdAt: new Date('2026-08-01'), lastNotifiedAt: null }
    mocks.databases.push(initialDatabase([campaignAgent]).db, findingDatabase(resolved).db, databaseDouble().db, resolutionDatabase().db)
    await runWorkspaceMonitoring(workspaceId)
    expect(mocks.dispatchNotifications).toHaveBeenLastCalledWith(expect.objectContaining({ eventKey: expect.stringContaining(':reopened:') }))

    vi.clearAllMocks()
    mocks.getWorkspaceConnection.mockResolvedValue({ encryptedRefreshToken: 'cipher', managerCustomerId: '9999999999' })
    mocks.campaignPerformance.mockResolvedValue([])
    mocks.analyzeCampaigns.mockReturnValue([finding])
    const acknowledged = { status: 'acknowledged', severity: 'critical', createdAt: new Date('2026-08-01'), lastNotifiedAt: new Date() }
    mocks.databases.push(initialDatabase([campaignAgent]).db, findingDatabase(acknowledged).db, resolutionDatabase().db)
    await runWorkspaceMonitoring(workspaceId)
    expect(mocks.dispatchNotifications).not.toHaveBeenCalled()
  })

  it.each([
    ['wasted_search_terms', 'searchTermPerformance', 'analyzeSearchTerms'],
    ['low_quality_keywords', 'keywordPerformance', 'analyzeKeywords'],
    ['weak_responsive_ads', 'responsiveSearchAdPerformance', 'analyzeAds'],
  ] as const)('routes %s through its dedicated Google dataset and analyzer', async (kind, gatewayMethod, analyzer) => {
    const selectedAgent = agent(kind)
    mocks.databases.push(initialDatabase([selectedAgent]).db, resolutionDatabase().db)
    await runWorkspaceMonitoring(workspaceId)
    expect(mocks[gatewayMethod]).toHaveBeenCalledWith(client.googleCustomerId)
    expect(mocks[analyzer]).toHaveBeenCalledOnce()
  })

  it('uses goals and local calendar inputs for pacing and forecast vigies', async () => {
    const goalContext = {
      goal: { monthlyBudgetMicros: '90000000' }, pacing: { status: 'over' }, observedDays: 12,
      calendar: { year: 2026, month: 8 },
    }
    mocks.getClientGoalAndPacing.mockResolvedValue(goalContext)
    const agents = [agent('pacing_variance'), agent('forecast_overrun')]
    mocks.databases.push(initialDatabase(agents).db, resolutionDatabase().db, resolutionDatabase().db)
    await runWorkspaceMonitoring(workspaceId)
    expect(mocks.getClientGoalAndPacing).toHaveBeenCalledTimes(1)
    expect(mocks.analyzePacing).toHaveBeenCalledTimes(2)
    expect(mocks.analyzePacing).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      goal: { monthlyBudgetMicros: 90000000 }, observedDays: 12, year: 2026, month: 8,
    }))
  })

  it('combines campaign and conversion data for tracking-gap vigies', async () => {
    const trackingAgent = agent('tracking_gap')
    const campaigns = [{ id: '1' }]
    const tracking = { conversionsTracked: false }
    mocks.campaignPerformance.mockResolvedValue(campaigns)
    mocks.conversionTrackingStatus.mockResolvedValue(tracking)
    mocks.databases.push(initialDatabase([trackingAgent]).db, resolutionDatabase().db)
    await runWorkspaceMonitoring(workspaceId)
    expect(mocks.analyzeTracking).toHaveBeenCalledWith(trackingAgent, campaigns, tracking)
  })

  it('resolves incidents that disappeared and keeps active fingerprints open', async () => {
    const campaignAgent = agent('no_delivery')
    const stale = { id: 'stale', fingerprint: 'stale:fingerprint', status: 'open' }
    mocks.databases.push(initialDatabase([campaignAgent]).db, resolutionDatabase([stale]).db)
    const result = await runWorkspaceMonitoring(workspaceId)
    expect(result.resolved).toBe(1)
  })

  it('isolates agent scope and excludes manager or inactive clients from targets', async () => {
    const selected = agent('no_delivery')
    const other = agent('no_delivery')
    const manager = { ...client, id: 'manager', isManager: true }
    const inactive = { ...client, id: 'inactive', active: false }
    mocks.databases.push(initialDatabase([selected], [client, manager, inactive]).db, resolutionDatabase().db)
    const result = await runWorkspaceMonitoring(workspaceId, selected.id)
    expect(result.clients).toBe(1)
    expect(result.agents).toBe(1)
    expect(other.id).not.toBe(selected.id)
  })
})
