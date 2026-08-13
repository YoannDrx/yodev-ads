import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { databaseDouble } from '../../test/fluent-db'

const mocks = vi.hoisted(() => ({
  databases: [] as unknown[],
  runTransaction: vi.fn(async (callback: (db: unknown) => unknown) => callback(mocks.databases.shift())),
  decryptSecret: vi.fn((value: string) => value),
  encryptSecret: vi.fn((value: string) => `encrypted:${value}`),
  refreshTeamsAccessToken: vi.fn(),
  postTeamsChannelMessage: vi.fn(),
  featureEnabled: vi.fn(() => true),
  enqueueJob: vi.fn(),
  resendSend: vi.fn(),
  assertSafeWebhookUrl: vi.fn(),
  postSafeWebhook: vi.fn(),
}))

vi.mock('@/db/transactions', () => ({ withSystemTransaction: mocks.runTransaction }))
vi.mock('@/lib/crypto', () => ({ decryptSecret: mocks.decryptSecret, encryptSecret: mocks.encryptSecret }))
vi.mock('@/lib/teams-oauth', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/teams-oauth')>(),
  refreshTeamsAccessToken: mocks.refreshTeamsAccessToken,
  postTeamsChannelMessage: mocks.postTeamsChannelMessage,
}))
vi.mock('@/lib/feature-flags', () => ({ featureEnabled: mocks.featureEnabled }))
vi.mock('@/lib/webhook-security', () => ({
  assertSafeWebhookUrl: mocks.assertSafeWebhookUrl,
  postSafeWebhook: mocks.postSafeWebhook,
}))
vi.mock('@/lib/jobs', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/jobs')>(),
  enqueueJob: mocks.enqueueJob,
}))
vi.mock('resend', () => ({
  Resend: class {
    emails = { send: mocks.resendSend }
  },
}))

import {
  channelsAllowedByWorkspace,
  dispatchIncidentNotifications,
  dispatchWeeklyDigest,
  retryNotificationDelivery,
  type NotificationPayload,
} from './notifications'

const payload: NotificationPayload = {
  workspaceId: '00000000-0000-4000-8000-000000000001',
  incidentId: '00000000-0000-4000-8000-000000000002',
  eventKey: 'incident:opened:1', severity: 'critical', title: 'Alerte', description: 'Description', clientName: 'ACME',
}

function channel(overrides: Record<string, unknown> = {}) {
  return {
    id: '00000000-0000-4000-8000-000000000003', workspaceId: payload.workspaceId, createdBy: 'user',
    kind: 'email', label: 'Ops', encryptedDestination: 'ops@example.test', destinationHint: 'o***@example.test',
    enabled: true, minimumSeverity: 'warning', lastDeliveredAt: null, lastError: null,
    createdAt: new Date(), updatedAt: new Date(), ...overrides,
  }
}

function delivery(overrides: Record<string, unknown> = {}) {
  return {
    id: '00000000-0000-4000-8000-000000000004', workspaceId: payload.workspaceId,
    channelId: channel().id, incidentId: payload.incidentId, eventKey: payload.eventKey, payload,
    status: 'sending', providerMessageId: null, errorMessage: null, attemptCount: 1,
    nextAttemptAt: null, terminalAt: null, createdAt: new Date(), ...overrides,
  }
}

function queryDouble(input: {
  channel?: unknown
  channels?: unknown[]
  delivery?: unknown
  workspace?: unknown
  snapshots?: unknown[]
} = {}) {
  const operationalWorkspace = input.workspace ?? ((input.channel || input.channels) ? {
    id: payload.workspaceId,
    accessState: 'internal',
    plan: 'internal',
  } : undefined)
  return {
    notificationChannels: {
      findFirst: vi.fn(async () => input.channel),
      findMany: vi.fn(async () => input.channels ?? (input.channel ? [input.channel] : [])),
    },
    notificationDeliveries: { findFirst: vi.fn(async () => input.delivery) },
    workspaces: { findFirst: vi.fn(async () => operationalWorkspace) },
    performanceSnapshots: { findMany: vi.fn(async () => input.snapshots ?? []) },
  }
}

describe('notification delivery orchestration', () => {
  beforeEach(() => {
    mocks.databases = []
    vi.clearAllMocks()
    mocks.featureEnabled.mockReturnValue(true)
    mocks.decryptSecret.mockImplementation((value: string) => value)
    process.env.RESEND_API_KEY = 're_test'
  })

  afterEach(() => {
    delete process.env.RESEND_API_KEY
    vi.unstubAllGlobals()
  })

  it('delivers a claimed email and persists provider evidence', async () => {
    const claimed = delivery()
    const claimDb = databaseDouble({ statementResults: [[claimed]], query: queryDouble({ channel: channel() }) })
    const successDb = databaseDouble()
    mocks.databases.push(claimDb.db, successDb.db)
    mocks.resendSend.mockResolvedValue({ data: { id: 'email-1' }, error: null })
    await expect(retryNotificationDelivery(claimed.id)).resolves.toBe('delivered')
    expect(mocks.resendSend).toHaveBeenCalledWith(expect.objectContaining({
      to: 'ops@example.test', headers: { 'X-Entity-Ref-ID': payload.eventKey },
    }))
    expect(successDb.capture.sets[0]).toMatchObject({ status: 'delivered', providerMessageId: 'email-1', errorMessage: null })
  })

  it('delivers a managed Teams channel through Graph and rotates its refresh token atomically', async () => {
    const managedDestination = JSON.stringify({
      v: 1,
      provider: 'teams_graph',
      teamId: 'team-1',
      teamName: 'Yodev',
      channelId: 'channel-1',
      channelName: 'Ads alerts',
      refreshToken: 'refresh-token-with-sufficient-length-old',
    })
    const teamsChannel = channel({ kind: 'teams', encryptedDestination: managedDestination })
    const claimed = delivery()
    const claimDb = databaseDouble({ statementResults: [[claimed]], query: queryDouble({ channel: teamsChannel }) })
    const rotationDb = databaseDouble({ statementResults: [[{ id: teamsChannel.id }]] })
    const successDb = databaseDouble()
    mocks.databases.push(claimDb.db, rotationDb.db, successDb.db)
    mocks.refreshTeamsAccessToken.mockResolvedValue({
      accessToken: 'access-token',
      refreshToken: 'refresh-token-with-sufficient-length-new',
      scopes: [],
      expiresIn: 3600,
    })
    mocks.postTeamsChannelMessage.mockResolvedValue('message-1')

    await expect(retryNotificationDelivery(claimed.id)).resolves.toBe('delivered')
    expect(rotationDb.capture.sets[0]).toMatchObject({
      encryptedDestination: expect.stringContaining('encrypted:{"v":1,"provider":"teams_graph"'),
    })
    expect(mocks.postTeamsChannelMessage).toHaveBeenCalledWith(expect.objectContaining({
      accessToken: 'access-token',
      teamId: 'team-1',
      channelId: 'channel-1',
      html: expect.stringContaining('Ads by Yodev'),
    }))
    expect(mocks.assertSafeWebhookUrl).not.toHaveBeenCalled()
    expect(successDb.capture.sets[0]).toMatchObject({ status: 'delivered', providerMessageId: 'message-1' })
  })

  it('enforces notification capabilities and quota again at delivery time', () => {
    const email = channel({ id: 'email-1', kind: 'email', createdAt: new Date('2026-01-01') })
    const secondEmail = channel({ id: 'email-2', kind: 'email', createdAt: new Date('2026-01-02') })
    const webhook = channel({ id: 'webhook-1', kind: 'webhook', createdAt: new Date('2025-12-01') })
    expect(channelsAllowedByWorkspace({ accessState: 'active', plan: 'solo' }, [webhook, secondEmail, email]))
      .toEqual([email])
    expect(channelsAllowedByWorkspace({ accessState: 'active', plan: 'studio' }, [webhook, secondEmail, email]))
      .toHaveLength(3)
    expect(channelsAllowedByWorkspace({ accessState: 'grace', plan: 'agency' }, [webhook, email]))
      .toEqual([])
  })

  it('returns stable terminal states when a delivery cannot be claimed', async () => {
    for (const [status, expected] of [['delivered', 'delivered'], ['dead_letter', 'dead_letter'], ['sending', 'not_available']] as const) {
      const database = databaseDouble({ statementResults: [[]], query: queryDouble({ delivery: { status } }) })
      mocks.databases.push(database.db)
      await expect(retryNotificationDelivery(delivery().id)).resolves.toBe(expected)
    }
  })

  it('dead-letters a claimed delivery whose channel disappeared', async () => {
    const claimDb = databaseDouble({ statementResults: [[delivery()]], query: queryDouble() })
    const terminalDb = databaseDouble()
    mocks.databases.push(claimDb.db, terminalDb.db)
    await expect(retryNotificationDelivery(delivery().id)).resolves.toBe('dead_letter')
    expect(terminalDb.capture.sets[0]).toMatchObject({ status: 'dead_letter', errorMessage: 'Notification channel missing or disabled' })
  })

  it('retries a failed SSRF-checked webhook and dead-letters the fifth failure', async () => {
    mocks.postSafeWebhook.mockRejectedValue(new Error('Webhook HTTP 503'))
    const webhook = channel({ kind: 'webhook', encryptedDestination: 'https://hooks.example.test/ads' })
    const first = delivery({ attemptCount: 1 })
    const firstClaim = databaseDouble({ statementResults: [[first]], query: queryDouble({ channel: webhook }) })
    const firstFailure = databaseDouble()
    mocks.databases.push(firstClaim.db, firstFailure.db)
    await expect(retryNotificationDelivery(first.id)).resolves.toBe('retrying')
    expect(mocks.postSafeWebhook).toHaveBeenCalledWith(
      'https://hooks.example.test/ads',
      expect.objectContaining({ eventKey: payload.eventKey }),
    )
    expect(firstFailure.capture.sets[0]).toMatchObject({ status: 'retrying', errorMessage: 'Webhook HTTP 503' })

    const fifth = delivery({ attemptCount: 5 })
    const fifthClaim = databaseDouble({ statementResults: [[fifth]], query: queryDouble({ channel: webhook }) })
    const fifthFailure = databaseDouble()
    mocks.databases.push(fifthClaim.db, fifthFailure.db)
    await expect(retryNotificationDelivery(fifth.id)).resolves.toBe('dead_letter')
    expect(fifthFailure.capture.sets[0]).toMatchObject({ status: 'dead_letter', nextAttemptAt: null })
  })

  it('handles missing Resend configuration and provider errors as retryable failures', async () => {
    delete process.env.RESEND_API_KEY
    const missingKeyClaim = databaseDouble({ statementResults: [[delivery()]], query: queryDouble({ channel: channel() }) })
    const missingKeyFailure = databaseDouble()
    mocks.databases.push(missingKeyClaim.db, missingKeyFailure.db)
    await expect(retryNotificationDelivery(delivery().id)).resolves.toBe('retrying')
    expect(missingKeyFailure.capture.sets[0]).toMatchObject({ errorMessage: 'POSTMARK_SERVER_TOKEN or RESEND_API_KEY absent' })

    process.env.RESEND_API_KEY = 're_test'
    mocks.resendSend.mockResolvedValue({ data: null, error: { message: 'provider down' } })
    const providerClaim = databaseDouble({ statementResults: [[delivery()]], query: queryDouble({ channel: channel() }) })
    const providerFailure = databaseDouble()
    mocks.databases.push(providerClaim.db, providerFailure.db)
    await expect(retryNotificationDelivery(delivery().id)).resolves.toBe('retrying')
    expect(providerFailure.capture.sets[0]).toMatchObject({ errorMessage: 'provider down' })
  })

  it('fails closed when notifications are disabled and filters channels by severity', async () => {
    mocks.featureEnabled.mockReturnValue(false)
    await expect(dispatchIncidentNotifications(payload)).resolves.toEqual({ delivered: 0, failed: 0, skipped: true })
    expect(mocks.runTransaction).not.toHaveBeenCalled()

    mocks.featureEnabled.mockReturnValue(true)
    const channelsDb = databaseDouble({ query: queryDouble({ channels: [channel({ minimumSeverity: 'critical' })] }) })
    mocks.databases.push(channelsDb.db)
    await expect(dispatchIncidentNotifications({ ...payload, severity: 'warning' })).resolves.toEqual({ delivered: 0, failed: 0 })
  })

  it('deduplicates incident delivery creation and reports successful delivery', async () => {
    const selectedChannel = channel()
    const channelsDb = databaseDouble({ query: queryDouble({ channels: [selectedChannel] }) })
    const insertDb = databaseDouble({ statementResults: [[{ id: delivery().id }]] })
    const claimDb = databaseDouble({ statementResults: [[delivery()]], query: queryDouble({ channel: selectedChannel }) })
    const successDb = databaseDouble()
    mocks.databases.push(channelsDb.db, insertDb.db, claimDb.db, successDb.db)
    mocks.resendSend.mockResolvedValue({ data: { id: 'email-1' }, error: null })
    await expect(dispatchIncidentNotifications(payload)).resolves.toEqual({ delivered: 1, failed: 0 })
    expect(insertDb.capture.values[0]).toMatchObject({ eventKey: payload.eventKey, status: 'queued' })

    const duplicateChannels = databaseDouble({ query: queryDouble({ channels: [selectedChannel] }) })
    const duplicateInsert = databaseDouble({ statementResults: [[]] })
    mocks.databases.push(duplicateChannels.db, duplicateInsert.db)
    await expect(dispatchIncidentNotifications(payload)).resolves.toEqual({ delivered: 0, failed: 0 })
  })

  it('enqueues a durable retry after a failed immediate delivery', async () => {
    mocks.postSafeWebhook.mockRejectedValue(new Error('Webhook HTTP 500'))
    const selectedChannel = channel({ kind: 'webhook', encryptedDestination: 'https://hooks.example.test/ads' })
    const failedDelivery = delivery()
    const nextAttemptAt = new Date('2026-08-12T10:01:00Z')
    mocks.databases.push(
      databaseDouble({ query: queryDouble({ channels: [selectedChannel] }) }).db,
      databaseDouble({ statementResults: [[{ id: failedDelivery.id }]] }).db,
      databaseDouble({ statementResults: [[failedDelivery]], query: queryDouble({ channel: selectedChannel }) }).db,
      databaseDouble().db,
      databaseDouble({ query: queryDouble({ delivery: { nextAttemptAt } }) }).db,
    )
    await expect(dispatchIncidentNotifications(payload)).resolves.toEqual({ delivered: 0, failed: 1 })
    expect(mocks.enqueueJob).toHaveBeenCalledWith(expect.objectContaining({
      type: 'notification.deliver', payload: { deliveryId: failedDelivery.id }, availableAt: nextAttemptAt, priority: 20,
    }))
  })

  it('skips empty digests and dispatches an aggregated weekly digest', async () => {
    mocks.databases.push(databaseDouble({ query: queryDouble() }).db)
    await expect(dispatchWeeklyDigest(payload.workspaceId, new Date('2026-08-12T12:00:00Z'))).resolves.toEqual({ delivered: 0, failed: 0, skipped: true })

    const workspace = { id: payload.workspaceId, brandName: 'ACME Ads', locale: 'fr' }
    const snapshots = [
      { costMicros: '1000000', clicks: '10', conversions: '2' },
      { costMicros: '2500000', clicks: '20', conversions: '3' },
    ]
    mocks.databases.push(
      databaseDouble({ query: queryDouble({ workspace, snapshots }) }).db,
      databaseDouble({ query: queryDouble({ channels: [] }) }).db,
    )
    await expect(dispatchWeeklyDigest(payload.workspaceId, new Date('2026-08-12T12:00:00Z'))).resolves.toEqual({ delivered: 0, failed: 0, skipped: false })
  })

  it('renders English email subjects and weekly digests from the workspace locale', async () => {
    const englishDelivery = delivery({ payload: { ...payload, locale: 'en' } })
    mocks.databases.push(
      databaseDouble({ statementResults: [[englishDelivery]], query: queryDouble({ channel: channel() }) }).db,
      databaseDouble().db,
    )
    mocks.resendSend.mockResolvedValue({ data: { id: 'email-en' }, error: null })
    await expect(retryNotificationDelivery(englishDelivery.id)).resolves.toBe('delivered')
    expect(mocks.resendSend).toHaveBeenCalledWith(expect.objectContaining({ subject: '[Critical] Alerte' }))

    const workspace = { id: payload.workspaceId, brandName: 'ACME Ads', locale: 'en' }
    const snapshots = [{ costMicros: '1000000', clicks: '10', conversions: '2' }]
    const channelsDb = databaseDouble({ query: queryDouble({ channels: [] }) })
    mocks.databases.push(
      databaseDouble({ query: queryDouble({ workspace, snapshots }) }).db,
      channelsDb.db,
    )
    await expect(dispatchWeeklyDigest(payload.workspaceId, new Date('2026-08-12T12:00:00Z'))).resolves.toEqual({ delivered: 0, failed: 0, skipped: false })
  })
})
