import { beforeEach, describe, expect, it, vi } from 'vitest'
import { databaseDouble } from '../../test/fluent-db'

const mocks = vi.hoisted(() => ({
  databases: [] as unknown[],
  contexts: [] as unknown[],
  transaction: vi.fn(async (context: unknown, callback: (db: unknown) => unknown) => {
    mocks.contexts.push(context)
    return callback(mocks.databases.shift())
  }),
  encrypt: vi.fn((value: string) => `encrypted:${value}`),
  hash: vi.fn((value: string) => `hashed:${value}`),
}))

vi.mock('@/db/transactions', () => ({ withTenantTransaction: mocks.transaction }))
vi.mock('@/lib/crypto', () => ({ encryptSecret: mocks.encrypt }))
vi.mock('@/lib/tokens', () => ({ hashToken: mocks.hash }))

import { entitlementContext } from './entitlements'
import {
  createWorkspaceApiKey,
  createWorkspaceNotificationChannel,
  disableWorkspaceNotificationChannel,
  notificationDestinationHint,
  retryWorkspaceDeadLetterJob,
  revokeWorkspaceApiKey,
  saveWorkspaceSafetyPolicy,
} from './workspace-security-resources'

const workspaceId = '00000000-0000-4000-8000-000000000001'
const resourceId = '00000000-0000-4000-8000-000000000002'
const actorUserId = 'user-1'
const now = new Date('2026-08-12T08:00:00.000Z')

function securityDatabase(input: { statementResults?: unknown[]; workspace?: unknown } = {}) {
  return databaseDouble({
    statementResults: input.statementResults,
    query: { workspaces: { findFirst: vi.fn(async () => input.workspace ?? { accessState: 'active', plan: 'studio' }) } },
  })
}

describe('workspace security resources', () => {
  beforeEach(() => {
    mocks.databases = []
    mocks.contexts = []
    vi.clearAllMocks()
  })

  it('serializes API-key quota, stores only a hash and creates a one-shot revelation', async () => {
    const database = securityDatabase({ statementResults: [[], [], [{ count: 1 }], [{ id: resourceId }], [{ id: 'revelation-1' }]] })
    mocks.databases.push(database.db)
    await expect(createWorkspaceApiKey({
      workspaceId,
      actorUserId,
      name: 'Reporting',
      token: 'yda_secret-token',
      scopes: ['portfolio:read'],
      entitlements: entitlementContext('active', 'studio'),
      now,
    })).resolves.toEqual({ id: 'revelation-1' })
    expect(database.capture.values[0]).toMatchObject({
      tokenHash: 'hashed:yda_secret-token',
      tokenPrefix: 'yda_secret-token',
      expiresAt: new Date('2026-11-10T08:00:00.000Z'),
    })
    expect(database.capture.values[1]).toMatchObject({ encryptedSecret: 'encrypted:yda_secret-token' })
    expect(database.capture.values[2]).toMatchObject({ action: 'api_key.created', entityId: resourceId })
  })

  it('fails closed on quota, missing key row or missing revelation row', async () => {
    mocks.databases.push(
      securityDatabase({ statementResults: [[], [], [{ count: 5 }]] }).db,
      securityDatabase({ statementResults: [[], [], [{ count: 0 }], []] }).db,
      securityDatabase({ statementResults: [[], [], [{ count: 0 }], [{ id: resourceId }], []] }).db,
    )
    const input = {
      workspaceId, actorUserId, name: 'Key', token: 'token', scopes: ['portfolio:read'],
      entitlements: entitlementContext('active', 'studio'), now,
    }
    await expect(createWorkspaceApiKey(input)).rejects.toThrow('Quota exceeded')
    await expect(createWorkspaceApiKey(input)).rejects.toThrow('création de la clé API')
    await expect(createWorkspaceApiKey(input)).rejects.toThrow('révélation one-shot')
  })

  it('atomically revokes and audits a live API key', async () => {
    const database = databaseDouble({ statementResults: [[{ id: resourceId }]] })
    mocks.databases.push(database.db)
    await revokeWorkspaceApiKey({ workspaceId, actorUserId, keyId: resourceId, now })
    expect(database.capture.sets[0]).toEqual({ revokedAt: now, updatedAt: now })
    expect(database.capture.values[0]).toMatchObject({ action: 'api_key.revoked', entityId: resourceId })
  })

  it('rejects an absent or already-revoked API key', async () => {
    mocks.databases.push(databaseDouble({ statementResults: [[]] }).db)
    await expect(revokeWorkspaceApiKey({ workspaceId, actorUserId, keyId: resourceId, now }))
      .rejects.toThrow('Clé API introuvable')
  })

  it('redacts email and webhook destinations', () => {
    expect(notificationDestinationHint('email', 'ops@example.test')).toBe('op•••@example.test')
    expect(notificationDestinationHint('webhook', 'https://hooks.example.test/private/path')).toBe('hooks.example.test/••••')
  })

  it('serializes channel quota, encrypts its destination and audits metadata only', async () => {
    const database = securityDatabase({ statementResults: [[], [], [{ count: 2 }], [{ id: resourceId }]] })
    mocks.databases.push(database.db)
    await createWorkspaceNotificationChannel({
      workspaceId,
      actorUserId,
      kind: 'email',
      label: 'Ops',
      destination: 'ops@example.test',
      minimumSeverity: 'critical',
      entitlements: entitlementContext('active', 'studio'),
    })
    expect(database.capture.values[0]).toMatchObject({
      encryptedDestination: 'encrypted:ops@example.test',
      destinationHint: 'op•••@example.test',
    })
    expect(database.capture.values[1]).toMatchObject({
      action: 'notification_channel.created',
      metadata: { kind: 'email', minimumSeverity: 'critical' },
    })
    expect(JSON.stringify(database.capture.values[1])).not.toContain('ops@example.test')
  })

  it('fails closed when channel quota is exhausted or insertion returns no row', async () => {
    mocks.databases.push(
      securityDatabase({ statementResults: [[], [], [{ count: 10 }]] }).db,
      securityDatabase({ statementResults: [[], [], [{ count: 0 }], []] }).db,
    )
    const input = {
      workspaceId, actorUserId, kind: 'email' as const, label: 'Ops', destination: 'ops@example.test',
      minimumSeverity: 'warning' as const, entitlements: entitlementContext('active', 'studio'),
    }
    await expect(createWorkspaceNotificationChannel(input)).rejects.toThrow('Quota exceeded')
    await expect(createWorkspaceNotificationChannel(input)).rejects.toThrow('création du canal')
  })

  it('atomically disables and audits a live channel', async () => {
    const database = databaseDouble({ statementResults: [[{ id: resourceId }]] })
    mocks.databases.push(database.db)
    await disableWorkspaceNotificationChannel({ workspaceId, actorUserId, channelId: resourceId, now })
    expect(database.capture.sets[0]).toEqual({
      enabled: false,
      encryptedDestination: 'encrypted:revoked',
      destinationHint: 'revoked',
      updatedAt: now,
    })
    expect(database.capture.values[0]).toMatchObject({
      action: 'notification_channel.disabled',
      entityId: resourceId,
      metadata: { credentialsDestroyed: true },
    })
  })

  it('rejects an absent or disabled channel', async () => {
    mocks.databases.push(databaseDouble({ statementResults: [[]] }).db)
    await expect(disableWorkspaceNotificationChannel({ workspaceId, actorUserId, channelId: resourceId, now }))
      .rejects.toThrow('Canal introuvable')
  })

  it('requeues and audits a dead-letter job in one transaction', async () => {
    const database = databaseDouble({ statementResults: [[{ id: resourceId, type: 'notification.deliver' }]] })
    mocks.databases.push(database.db)
    await retryWorkspaceDeadLetterJob({ workspaceId, actorUserId, jobId: resourceId, now })
    expect(database.capture.sets[0]).toMatchObject({
      status: 'queued', availableAt: now, leaseOwner: null, deadLetteredAt: null, lastError: null, updatedAt: now,
    })
    expect(database.capture.values[0]).toMatchObject({
      action: 'job.manual_retry_requested', metadata: { type: 'notification.deliver' },
    })
  })

  it('rejects a job outside the workspace or not in dead-letter', async () => {
    mocks.databases.push(databaseDouble({ statementResults: [[]] }).db)
    await expect(retryWorkspaceDeadLetterJob({ workspaceId, actorUserId, jobId: resourceId, now }))
      .rejects.toThrow('dead-letter introuvable')
  })

  it('replaces the workspace safety policy and mirrors legacy workspace limits', async () => {
    const database = databaseDouble()
    mocks.databases.push(database.db)
    await saveWorkspaceSafetyPolicy({
      workspaceId,
      actorUserId,
      scope: 'workspace',
      clientId: null,
      campaignId: null,
      currencyCode: 'EUR',
      maximumDailyBudget: 125.5,
      maximumMonthlySpend: 2000,
      maximumVariationPercent: 20,
      notificationEmail: 'ops@example.test',
      now,
    })
    expect(database.capture.sets[0]).toMatchObject({
      maximumDailyBudgetMicros: '125500000',
      maximumMonthlySpendMicros: '2000000000',
      notificationEmail: 'ops@example.test',
      updatedAt: now,
    })
    expect(database.capture.values[0]).toMatchObject({
      clientId: null,
      campaignId: null,
      maximumVariationPercent: '20',
    })
    expect(database.capture.values[1]).toMatchObject({
      action: 'workspace.safety_policy_updated',
      entityId: workspaceId,
      metadata: expect.objectContaining({ scope: 'workspace', maximumDailyBudget: 125.5 }),
    })
  })

  it('stores a campaign-scoped safety policy without changing legacy workspace limits', async () => {
    const database = databaseDouble()
    mocks.databases.push(database.db)
    await saveWorkspaceSafetyPolicy({
      workspaceId,
      actorUserId,
      scope: 'campaign',
      clientId: 'client-1',
      campaignId: '123456',
      currencyCode: 'EUR',
      maximumDailyBudget: '',
      maximumMonthlySpend: '',
      maximumVariationPercent: 15,
      notificationEmail: '',
      now,
    })
    expect(database.capture.sets[0]).toEqual({ notificationEmail: null, updatedAt: now })
    expect(database.capture.values[0]).toMatchObject({
      clientId: 'client-1', campaignId: '123456', maximumVariationPercent: '15',
    })
    expect(database.capture.values[1]).toMatchObject({ entityId: '123456' })
  })

  it('supports deleting a scoped policy while still auditing the cleared values', async () => {
    const database = databaseDouble()
    mocks.databases.push(database.db)
    await saveWorkspaceSafetyPolicy({
      workspaceId,
      actorUserId,
      scope: 'client',
      clientId: 'client-1',
      campaignId: null,
      currencyCode: 'EUR',
      maximumDailyBudget: '',
      maximumMonthlySpend: '',
      maximumVariationPercent: '',
      notificationEmail: '',
      now,
    })
    expect(database.capture.values).toHaveLength(1)
    expect(database.capture.values[0]).toMatchObject({
      entityId: 'client-1',
      metadata: expect.objectContaining({
        maximumDailyBudget: null, maximumMonthlySpend: null, maximumVariationPercent: null,
      }),
    })
  })
})
