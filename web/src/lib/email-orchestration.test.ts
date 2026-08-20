import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { databaseDouble } from '../../test/fluent-db'

const mocks = vi.hoisted(() => ({
  databases: [] as unknown[],
  transaction: vi.fn(async (callback: (db: unknown) => unknown) => callback(mocks.databases.shift())),
  emailSend: vi.fn(),
  decryptSecret: vi.fn((value: string) => value),
  verifiedAuthUserEmail: vi.fn(),
}))

vi.mock('@/db/transactions', () => ({ withSystemTransaction: mocks.transaction }))
vi.mock('@/lib/crypto', () => ({ decryptSecret: mocks.decryptSecret }))
vi.mock('@/lib/transactional-email', () => ({ sendTransactionalEmail: mocks.emailSend }))
vi.mock('@/lib/auth-identities', () => ({ verifiedAuthUserEmail: mocks.verifiedAuthUserEmail }))

import { deliverLifecycleEmail } from './lifecycle-emails'
import { deliverOperationsAlert } from './operations-alerts'
import { deliverScheduledReport } from './scheduled-reports'
import { deliverPersonalTaskDigest, deliverTaskMention } from './task-notifications'

const workspaceId = '00000000-0000-4000-8000-000000000001'
const entityId = '00000000-0000-4000-8000-000000000002'
const preferenceId = '00000000-0000-4000-8000-000000000003'

function queryMap(input: Record<string, { first?: unknown; many?: unknown[] }> = {}) {
  return new Proxy({}, {
    get(_target, table) {
      const result = input[String(table)] ?? {}
      return { findFirst: vi.fn(async () => result.first), findMany: vi.fn(async () => result.many ?? []) }
    },
  }) as Record<string, Record<string, (...args: unknown[]) => unknown>>
}

const workspace = {
  id: workspaceId, ownerUserId: 'owner-1', billingEmail: 'billing@example.test', name: 'ACME', brandName: 'ACME Ads',
  locale: 'fr', timezone: 'Europe/Paris', accessState: 'active', plan: 'agency',
}

function scheduledContext(overrides: Record<string, unknown> = {}, options: { workspace?: unknown; claim?: unknown[] } = {}) {
  const schedule = {
    id: entityId, workspaceId, clientId: 'client-1', shareId: 'share-1', templateId: 'template-1', enabled: true,
    lastRunKey: null, recipientEmails: ['client@example.test'], deliveryLeaseUntil: null,
    encryptedReportToken: 'report-token', name: 'Rapport mensuel', ...overrides,
  }
  return {
    schedule,
    database: databaseDouble({
      statementResults: [options.claim ?? [schedule]],
      query: queryMap({
        reportSchedules: { first: schedule }, workspaces: { first: options.workspace ?? workspace }, clients: { first: { id: 'client-1', name: 'Client' } },
        shareLinks: { first: { id: 'share-1', workspaceId, active: true, editorialComment: 'Initial', actionPlan: null, locale: 'fr', periodDays: 30 } },
        reportTemplates: { first: { id: 'template-1', active: true, editorialComment: 'Template', actionPlan: 'Plan', locale: 'en', periodDays: 7 } },
        workspaceDomains: { first: { hostname: 'reports.acme.test' } },
      }),
    }),
  }
}

const preference = {
  id: preferenceId, workspaceId, authUserId: 'user-1', displayName: 'Yoann', encryptedEmail: 'yoann@example.test',
  mentionNotifications: true, digestCadence: 'daily', lastDigestKey: null,
}
const comment = { id: entityId, workspaceId, taskId: 'task-1', body: 'Merci de vérifier.' }
const task = { id: 'task-1', workspaceId, title: 'Vérifier le budget', status: 'todo', dueAt: new Date('2026-08-15') }

describe('scheduled report delivery', () => {
  beforeEach(() => {
    mocks.databases = []
    vi.clearAllMocks()
    mocks.decryptSecret.mockImplementation((value: string) => value)
    mocks.emailSend.mockResolvedValue({ provider: 'yodev_mail', providerMessageId: 'email-1' })
  })

  afterEach(() => {
    for (const key of ['NEXT_PUBLIC_APP_URL', 'OPERATIONS_ALERT_EMAIL', 'SUPPORT_EMAIL']) delete process.env[key]
  })

  it('leases, refreshes, sends and audits a localized report using its verified custom domain', async () => {
    const context = scheduledContext()
    const refresh = databaseDouble()
    const success = databaseDouble()
    mocks.databases.push(context.database.db, refresh.db, success.db)
    await expect(deliverScheduledReport(entityId, '2026-08-10')).resolves.toEqual({ delivered: true, recipientCount: 1, providerMessageId: 'email-1' })
    expect(refresh.capture.sets[0]).toMatchObject({ editorialComment: 'Template', actionPlan: 'Plan', locale: 'en', periodDays: 7 })
    expect(mocks.emailSend).toHaveBeenCalledWith(expect.objectContaining({
      to: ['client@example.test'], html: expect.stringContaining('https://reports.acme.test/r/report-token'),
      idempotencyKey: `report-schedule:${entityId}:2026-08-10`, category: 'scheduled_report', workspaceId,
    }))
    expect(success.capture.sets[0]).toMatchObject({ lastRunKey: '2026-08-10', lastError: null, deliveryLeaseUntil: null })
  })

  it('skips disabled and already-delivered schedules before sending', async () => {
    for (const [overrides, reason] of [[{ enabled: false }, 'disabled'], [{ lastRunKey: '2026-08-10' }, 'already_delivered']] as const) {
      const context = scheduledContext(overrides)
      mocks.databases.push(context.database.db)
      await expect(deliverScheduledReport(entityId, '2026-08-10')).resolves.toEqual({ skipped: true, reason })
    }
    expect(mocks.emailSend).not.toHaveBeenCalled()
  })

  it('rejects missing, unauthorized, recipient-less and concurrently leased schedules', async () => {
    mocks.databases.push(databaseDouble({ query: queryMap() }).db)
    await expect(deliverScheduledReport(entityId, '2026-08-10')).rejects.toThrow('introuvable')

    const unauthorized = scheduledContext({}, { workspace: { ...workspace, accessState: 'suspended' } })
    mocks.databases.push(unauthorized.database.db)
    await expect(deliverScheduledReport(entityId, '2026-08-10')).rejects.toThrow('non autorisé')

    const noRecipients = scheduledContext({ recipientEmails: [] })
    mocks.databases.push(noRecipients.database.db)
    await expect(deliverScheduledReport(entityId, '2026-08-10')).rejects.toThrow('Aucun destinataire')

    const leased = scheduledContext({}, { claim: [] })
    mocks.databases.push(leased.database.db)
    await expect(deliverScheduledReport(entityId, '2026-08-10')).rejects.toThrow('déjà en cours')
  })

  it('releases the lease and records provider failures', async () => {
    const context = scheduledContext()
    const refresh = databaseDouble()
    const failed = databaseDouble()
    mocks.emailSend.mockRejectedValue(new Error('provider down'))
    mocks.databases.push(context.database.db, refresh.db, failed.db)
    await expect(deliverScheduledReport(entityId, '2026-08-10')).rejects.toThrow('provider down')
    expect(failed.capture.sets[0]).toMatchObject({ lastError: 'provider down', deliveryLeaseUntil: null })
  })
})

describe('task notification delivery', () => {
  beforeEach(() => {
    mocks.databases = []
    vi.clearAllMocks()
    mocks.emailSend.mockResolvedValue({ provider: 'yodev_mail', providerMessageId: 'email-1' })
    mocks.decryptSecret.mockImplementation((value: string) => value)
  })

  afterEach(() => undefined)

  function mentionDatabase(preferenceValue: unknown = preference, workspaceValue: unknown = workspace) {
    return databaseDouble({ query: queryMap({
      memberNotificationPreferences: { first: preferenceValue }, taskComments: { first: comment },
      workspaceTasks: { first: task }, workspaces: { first: workspaceValue },
    }) })
  }

  it('delivers and audits a consented mention', async () => {
    const success = databaseDouble()
    mocks.databases.push(mentionDatabase().db, success.db)
    await expect(deliverTaskMention(comment.id, preference.id)).resolves.toEqual({ delivered: true, providerMessageId: 'email-1' })
    expect(mocks.emailSend).toHaveBeenCalledWith(expect.objectContaining({ to: 'yoann@example.test', idempotencyKey: `task-mention:${comment.id}:${preference.id}`, workspaceId }))
    expect(success.capture.values[0]).toMatchObject({ action: 'task.mention_delivered' })
  })

  it('rejects cross-workspace context and skips revoked consent', async () => {
    mocks.databases.push(mentionDatabase({ ...preference, workspaceId: 'other' }).db)
    await expect(deliverTaskMention(comment.id, preference.id)).rejects.toThrow('introuvable')
    mocks.databases.push(mentionDatabase({ ...preference, mentionNotifications: false }).db)
    await expect(deliverTaskMention(comment.id, preference.id)).resolves.toEqual({ skipped: true })
  })

  it('records a mention delivery error on the encrypted recipient preference', async () => {
    mocks.emailSend.mockRejectedValue(new Error('mail down'))
    const failed = databaseDouble()
    mocks.databases.push(mentionDatabase().db, failed.db)
    await expect(deliverTaskMention(comment.id, preference.id)).rejects.toThrow('mail down')
    expect(failed.capture.sets[0]).toMatchObject({ lastError: 'mail down' })
  })

  function digestDatabase(preferenceValue: unknown = preference, tasks: unknown[] = [task]) {
    return databaseDouble({ query: queryMap({
      memberNotificationPreferences: { first: preferenceValue }, workspaces: { first: workspace }, workspaceTasks: { many: tasks },
    }) })
  }

  it('marks empty digests idempotently and sends non-empty personal digests', async () => {
    const emptyUpdate = databaseDouble()
    mocks.databases.push(digestDatabase(preference, []).db, emptyUpdate.db)
    await expect(deliverPersonalTaskDigest(preference.id, '2026-08-10')).resolves.toEqual({ delivered: false, empty: true })
    expect(emptyUpdate.capture.sets[0]).toMatchObject({ lastDigestKey: '2026-08-10', lastError: null })

    const success = databaseDouble()
    mocks.databases.push(digestDatabase().db, success.db)
    await expect(deliverPersonalTaskDigest(preference.id, '2026-08-11')).resolves.toEqual({ delivered: true, taskCount: 1, providerMessageId: 'email-1' })
    expect(success.capture.values[0]).toMatchObject({ action: 'task.personal_digest_delivered' })
  })

  it('skips disabled and duplicate digests and rejects absent preferences', async () => {
    mocks.databases.push(digestDatabase(null).db)
    await expect(deliverPersonalTaskDigest(preference.id, '2026-08-10')).rejects.toThrow('introuvable')
    mocks.databases.push(digestDatabase({ ...preference, digestCadence: 'none' }).db)
    await expect(deliverPersonalTaskDigest(preference.id, '2026-08-10')).resolves.toEqual({ skipped: true })
    mocks.databases.push(digestDatabase({ ...preference, lastDigestKey: '2026-08-10' }).db)
    await expect(deliverPersonalTaskDigest(preference.id, '2026-08-10')).resolves.toEqual({ skipped: true })
  })
})

describe('lifecycle and operations emails', () => {
  beforeEach(() => {
    mocks.databases = []
    vi.clearAllMocks()
    mocks.emailSend.mockResolvedValue({ provider: 'yodev_mail', providerMessageId: 'email-1' })
    mocks.verifiedAuthUserEmail.mockResolvedValue('owner@example.test')
    process.env.OPERATIONS_ALERT_EMAIL = 'ops@example.test'
  })

  afterEach(() => {
    for (const key of ['OPERATIONS_ALERT_EMAIL', 'SUPPORT_EMAIL']) delete process.env[key]
  })

  it('delivers a billing lifecycle email and persists immutable audit evidence', async () => {
    mocks.databases.push(databaseDouble({ query: queryMap({ workspaces: { first: workspace } }) }).db, databaseDouble().db)
    await expect(deliverLifecycleEmail({ workspaceId, kind: 'payment_failed', referenceKey: 'invoice-1' })).resolves.toEqual({ delivered: true, providerMessageId: 'email-1' })
    expect(mocks.emailSend).toHaveBeenCalledWith(expect.objectContaining({ to: 'billing@example.test', html: expect.stringContaining('/billing'), idempotencyKey: `lifecycle:${workspaceId}:payment_failed:invoice-1`, workspaceId }))
  })

  it('falls back to a verified Better Auth owner address and rejects deleted or recipient-less workspaces', async () => {
    mocks.databases.push(databaseDouble({ query: queryMap({ workspaces: { first: { ...workspace, billingEmail: null } } }) }).db, databaseDouble().db)
    await deliverLifecycleEmail({ workspaceId, kind: 'welcome', referenceKey: 'welcome-1' })
    expect(mocks.verifiedAuthUserEmail).toHaveBeenCalledWith('owner-1')

    mocks.databases.push(databaseDouble({ query: queryMap({ workspaces: { first: { ...workspace, accessState: 'deleted' } } }) }).db)
    await expect(deliverLifecycleEmail({ workspaceId, kind: 'welcome', referenceKey: 'x' })).rejects.toThrow('introuvable')

    mocks.verifiedAuthUserEmail.mockResolvedValue(null)
    mocks.databases.push(databaseDouble({ query: queryMap({ workspaces: { first: { ...workspace, billingEmail: null } } }) }).db)
    await expect(deliverLifecycleEmail({ workspaceId, kind: 'welcome', referenceKey: 'x' })).rejects.toThrow('Aucun email')
  })

  it('validates operations recipients and sends idempotent redacted alerts', async () => {
    await expect(deliverOperationsAlert({ kind: 'job_dead_letter', sourceId: 'job-1', title: 'Job', description: 'Failure' })).resolves.toEqual({ delivered: true, providerMessageId: 'email-1' })
    expect(mocks.emailSend).toHaveBeenCalledWith(expect.objectContaining({ to: 'ops@example.test', idempotencyKey: 'operations-alert:job_dead_letter:job-1', category: 'operations_job_dead_letter' }))
    delete process.env.OPERATIONS_ALERT_EMAIL
    delete process.env.SUPPORT_EMAIL
    await expect(deliverOperationsAlert({ kind: 'job_dead_letter', sourceId: 'job-2', title: 'Job', description: 'Failure' })).rejects.toThrow('absents')
  })

  it('fails retryably when email transport configuration or provider response is invalid', async () => {
    mocks.emailSend.mockRejectedValueOnce(new Error('YODEV_MAIL_API_KEY absent'))
    await expect(deliverOperationsAlert({ kind: 'mutation_ambiguous', sourceId: 'approval-1', title: 'Mutation', description: 'Failure' })).rejects.toThrow('YODEV_MAIL_API_KEY absent')
    mocks.emailSend.mockRejectedValueOnce(new Error('provider unavailable'))
    await expect(deliverOperationsAlert({ kind: 'mutation_ambiguous', sourceId: 'approval-1', title: 'Mutation', description: 'Failure' })).rejects.toThrow('provider unavailable')
  })

  it('uses YoDevMail as the single operations transport', async () => {
    await expect(deliverOperationsAlert({ kind: 'job_dead_letter', sourceId: 'job-yodev', title: 'Job', description: 'Failure' })).resolves.toMatchObject({ providerMessageId: 'email-1' })
    expect(mocks.emailSend).toHaveBeenCalledWith(expect.objectContaining({
      to: 'ops@example.test', idempotencyKey: 'operations-alert:job_dead_letter:job-yodev', category: 'operations_job_dead_letter',
    }))
  })
})
