import { beforeEach, describe, expect, it, vi } from 'vitest'
import { databaseDouble } from '../../test/fluent-db'

const mocks = vi.hoisted(() => ({
  databases: [] as unknown[],
  transaction: vi.fn(async (_context: unknown, callback: (db: unknown) => unknown) => callback(mocks.databases.shift())),
  encrypt: vi.fn((value: string) => `encrypted:${value}`),
  hash: vi.fn((value: string) => `hashed:${value}`),
}))

vi.mock('@/db/transactions', () => ({ withTenantTransaction: mocks.transaction }))
vi.mock('@/lib/crypto', () => ({ encryptSecret: mocks.encrypt }))
vi.mock('@/lib/tokens', () => ({ hashToken: mocks.hash }))

import { entitlementContext } from './entitlements'
import {
  createWorkspaceReportSchedule,
  createWorkspaceReportTemplate,
  deactivateWorkspaceReportTemplate,
  rotateWorkspaceScheduledReportToken,
  setWorkspaceReportScheduleEnabled,
  updateWorkspaceReportTemplate,
} from './report-management'

const workspaceId = '00000000-0000-4000-8000-000000000001'
const templateId = '00000000-0000-4000-8000-000000000002'
const scheduleId = '00000000-0000-4000-8000-000000000003'
const shareId = '00000000-0000-4000-8000-000000000004'
const clientId = '00000000-0000-4000-8000-000000000005'
const actorUserId = 'user-1'
const now = new Date('2026-08-12T08:00:00.000Z')

function reportDatabase(input: {
  statementResults?: unknown[]
  client?: unknown
  template?: unknown
  schedule?: unknown
} = {}) {
  return databaseDouble({
    statementResults: input.statementResults,
    query: {
      clients: { findFirst: vi.fn(async () => input.client) },
      reportTemplates: { findFirst: vi.fn(async () => input.template) },
      reportSchedules: { findFirst: vi.fn(async () => input.schedule) },
    },
  })
}

describe('report management repository', () => {
  beforeEach(() => {
    mocks.databases = []
    vi.clearAllMocks()
  })

  it('creates an immutable first template version and audit', async () => {
    const template = {
      id: templateId, name: 'Hebdo', locale: 'fr', periodDays: 7,
      editorialComment: 'Bilan', actionPlan: null, currentVersion: 1,
    }
    const database = reportDatabase({ statementResults: [[template]] })
    mocks.databases.push(database.db)
    await createWorkspaceReportTemplate({
      workspaceId, actorUserId, name: 'Hebdo', locale: 'fr', periodDays: 7, editorialComment: 'Bilan',
    })
    expect(database.capture.values[1]).toMatchObject({
      templateId, version: 1, snapshot: expect.objectContaining({ name: 'Hebdo', locale: 'fr', periodDays: 7 }),
    })
    expect(database.capture.values[2]).toMatchObject({ action: 'report.template_created', entityId: templateId })
  })

  it('fails closed when template insertion returns no row', async () => {
    mocks.databases.push(reportDatabase({ statementResults: [[]] }).db)
    await expect(createWorkspaceReportTemplate({
      workspaceId, actorUserId, name: 'Hebdo', locale: 'fr', periodDays: 7,
    })).rejects.toThrow('création du modèle')
  })

  it('updates a template with optimistic concurrency and appends a version', async () => {
    const updated = {
      id: templateId, name: 'Mensuel', locale: 'en', periodDays: 30,
      editorialComment: null, actionPlan: 'Next', currentVersion: 3,
    }
    const database = reportDatabase({ statementResults: [[updated]] })
    mocks.databases.push(database.db)
    await updateWorkspaceReportTemplate({
      workspaceId, actorUserId, templateId, expectedVersion: 2,
      name: 'Mensuel', locale: 'en', periodDays: 30, actionPlan: 'Next', now,
    })
    expect(database.capture.sets[0]).toMatchObject({ currentVersion: 3, updatedAt: now })
    expect(database.capture.values[0]).toMatchObject({ version: 3, snapshot: expect.objectContaining({ actionPlan: 'Next' }) })
    expect(database.capture.values[1]).toMatchObject({ metadata: { previousVersion: 2, version: 3 } })
  })

  it('rejects stale or disabled template updates', async () => {
    mocks.databases.push(reportDatabase({ statementResults: [[]] }).db)
    await expect(updateWorkspaceReportTemplate({
      workspaceId, actorUserId, templateId, expectedVersion: 2,
      name: 'Mensuel', locale: 'fr', periodDays: 30, now,
    })).rejects.toThrow('modifié ou désactivé')
  })

  it('deactivates and audits a live template', async () => {
    const database = reportDatabase({ statementResults: [[{ id: templateId, currentVersion: 4 }]] })
    mocks.databases.push(database.db)
    await deactivateWorkspaceReportTemplate({ workspaceId, actorUserId, templateId, now })
    expect(database.capture.sets[0]).toEqual({ active: false, updatedAt: now })
    expect(database.capture.values[0]).toMatchObject({ action: 'report.template_deactivated', metadata: { version: 4 } })
  })

  it('rejects absent or already disabled templates', async () => {
    mocks.databases.push(reportDatabase({ statementResults: [[]] }).db)
    await expect(deactivateWorkspaceReportTemplate({ workspaceId, actorUserId, templateId, now }))
      .rejects.toThrow('introuvable ou déjà désactivé')
  })

  it.each([
    { cadence: 'weekly' as const, weekday: 2, monthday: null },
    { cadence: 'monthly' as const, weekday: null, monthday: 15 },
  ])('creates a $cadence schedule, report snapshot, audit and activation', async ({ cadence, weekday, monthday }) => {
    const database = reportDatabase({
      statementResults: [[], [{ count: 1 }], [{ id: shareId }], [{ id: scheduleId }]],
      client: { id: clientId, isManager: false },
      template: {
        id: templateId, editorialComment: 'Comment', actionPlan: 'Plan', locale: 'en', periodDays: 7,
      },
    })
    mocks.databases.push(database.db)
    await createWorkspaceReportSchedule({
      workspaceId, actorUserId, workspaceLocale: 'fr', name: 'Rapport', clientId, templateId,
      cadence, scheduleWeekday: 2, scheduleMonthday: 15, sendHour: 8, timezone: 'Europe/Paris',
      recipientEmails: ['client@example.test'], token: 'report-token-value',
      entitlements: entitlementContext('active', 'studio'), now,
    })
    expect(database.capture.values[0]).toMatchObject({
      tokenHash: 'hashed:report-token-value', locale: 'en', periodDays: 7,
    })
    expect(database.capture.values[1]).toMatchObject({
      cadence, scheduleWeekday: weekday, scheduleMonthday: monthday,
      encryptedReportToken: 'encrypted:report-token-value',
    })
    expect(database.capture.values[2]).toMatchObject({ action: 'report.schedule_created' })
    expect(database.capture.values[3]).toMatchObject({ milestone: 'first_report', sourceEntityId: shareId })
  })

  it('uses workspace defaults when no template is selected', async () => {
    const database = reportDatabase({
      statementResults: [[], [{ count: 0 }], [{ id: shareId }], [{ id: scheduleId }]],
      client: { id: clientId, isManager: false },
    })
    mocks.databases.push(database.db)
    await createWorkspaceReportSchedule({
      workspaceId, actorUserId, workspaceLocale: 'fr', name: 'Sans modèle', clientId,
      cadence: 'weekly', scheduleWeekday: 1, scheduleMonthday: 1, sendHour: 8,
      timezone: 'Europe/Paris', recipientEmails: ['a@example.test'], token: 'token',
      entitlements: entitlementContext('active', 'trial'), now,
    })
    expect(database.capture.values[0]).toMatchObject({ locale: 'fr', periodDays: 30, editorialComment: null })
  })

  it('fails before resource insertion for quota, manager client or absent template', async () => {
    mocks.databases.push(
      reportDatabase({ statementResults: [[], [{ count: 3 }]], client: { id: clientId, isManager: false } }).db,
      reportDatabase({ statementResults: [[], [{ count: 0 }]], client: { id: clientId, isManager: true } }).db,
      reportDatabase({ statementResults: [[], [{ count: 0 }]], client: { id: clientId, isManager: false } }).db,
    )
    const base = {
      workspaceId, actorUserId, workspaceLocale: 'fr', name: 'Rapport', clientId,
      cadence: 'weekly' as const, scheduleWeekday: 1, scheduleMonthday: 1, sendHour: 8,
      timezone: 'Europe/Paris', recipientEmails: ['a@example.test'], token: 'token',
      entitlements: entitlementContext('active', 'solo'), now,
    }
    await expect(createWorkspaceReportSchedule(base)).rejects.toThrow('Quota exceeded')
    await expect(createWorkspaceReportSchedule(base)).rejects.toThrow('Compte client introuvable')
    await expect(createWorkspaceReportSchedule({ ...base, templateId })).rejects.toThrow('Modèle de rapport introuvable')
  })

  it('fails closed when share or schedule insert does not return a row', async () => {
    mocks.databases.push(
      reportDatabase({ statementResults: [[], [{ count: 0 }], []], client: { id: clientId, isManager: false } }).db,
      reportDatabase({ statementResults: [[], [{ count: 0 }], [{ id: shareId }], []], client: { id: clientId, isManager: false } }).db,
    )
    const base = {
      workspaceId, actorUserId, workspaceLocale: 'fr', name: 'Rapport', clientId,
      cadence: 'monthly' as const, scheduleWeekday: 1, scheduleMonthday: 1, sendHour: 8,
      timezone: 'Europe/Paris', recipientEmails: ['a@example.test'], token: 'token',
      entitlements: entitlementContext('active', 'studio'), now,
    }
    await expect(createWorkspaceReportSchedule(base)).rejects.toThrow('création du lien')
    await expect(createWorkspaceReportSchedule(base)).rejects.toThrow('création de la planification')
  })

  it('enables a disabled schedule under quota and rotates its bearer token', async () => {
    const database = reportDatabase({
      statementResults: [[], [{ count: 1 }]],
      schedule: { id: scheduleId, shareId, enabled: false, encryptedReportToken: 'old', deliveryLeaseUntil: null },
    })
    mocks.databases.push(database.db)
    await setWorkspaceReportScheduleEnabled({
      workspaceId, actorUserId, scheduleId, enabled: true, replacementToken: 'new-token',
      entitlements: entitlementContext('active', 'studio'), now,
    })
    expect(database.capture.sets[0]).toMatchObject({ enabled: true, encryptedReportToken: 'encrypted:new-token' })
    expect(database.capture.sets[1]).toMatchObject({
      active: true, tokenHash: 'hashed:new-token', expiresAt: new Date('2026-11-10T08:00:00.000Z'),
    })
    expect(database.capture.values[0]).toMatchObject({ action: 'report.schedule_enabled' })
  })

  it('disables a schedule and immediately expires the public share', async () => {
    const database = reportDatabase({
      statementResults: [[]],
      schedule: { id: scheduleId, shareId, enabled: true, encryptedReportToken: 'old', deliveryLeaseUntil: null },
    })
    mocks.databases.push(database.db)
    await setWorkspaceReportScheduleEnabled({
      workspaceId, actorUserId, scheduleId, enabled: false, replacementToken: null,
      entitlements: entitlementContext('active', 'studio'), now,
    })
    expect(database.capture.sets[1]).toMatchObject({ active: false, expiresAt: now })
    expect(database.capture.values[0]).toMatchObject({ action: 'report.schedule_disabled' })
  })

  it('rejects absent, leased or over-quota schedule activation', async () => {
    mocks.databases.push(
      reportDatabase({ statementResults: [[]] }).db,
      reportDatabase({
        statementResults: [[]], schedule: { id: scheduleId, deliveryLeaseUntil: new Date('2026-08-12T08:01:00Z') },
      }).db,
      reportDatabase({
        statementResults: [[], [{ count: 3 }]],
        schedule: { id: scheduleId, shareId, enabled: false, encryptedReportToken: 'old', deliveryLeaseUntil: null },
      }).db,
    )
    const base = {
      workspaceId, actorUserId, scheduleId, enabled: true, replacementToken: 'token',
      entitlements: entitlementContext('active', 'solo'), now,
    }
    await expect(setWorkspaceReportScheduleEnabled(base)).rejects.toThrow('Planification introuvable')
    await expect(setWorkspaceReportScheduleEnabled(base)).rejects.toThrow('Un envoi est en cours')
    await expect(setWorkspaceReportScheduleEnabled(base)).rejects.toThrow('Quota exceeded')
  })

  it('rotates a scheduled report token atomically and audits without the secret', async () => {
    const database = reportDatabase({
      schedule: { id: scheduleId, shareId, deliveryLeaseUntil: null },
    })
    mocks.databases.push(database.db)
    await rotateWorkspaceScheduledReportToken({ workspaceId, actorUserId, scheduleId, token: 'rotated-secret', now })
    expect(database.capture.sets[0]).toMatchObject({ tokenHash: 'hashed:rotated-secret' })
    expect(database.capture.sets[1]).toMatchObject({ encryptedReportToken: 'encrypted:rotated-secret' })
    expect(database.capture.values[0]).toMatchObject({ action: 'report.schedule_token_rotated', entityId: scheduleId })
    expect(JSON.stringify(database.capture.values[0])).not.toContain('rotated-secret')
  })

  it('rejects token rotation for absent or leased schedules', async () => {
    mocks.databases.push(
      reportDatabase().db,
      reportDatabase({ schedule: { id: scheduleId, deliveryLeaseUntil: new Date('2026-08-12T08:01:00Z') } }).db,
    )
    await expect(rotateWorkspaceScheduledReportToken({ workspaceId, actorUserId, scheduleId, token: 'x', now }))
      .rejects.toThrow('Planification introuvable')
    await expect(rotateWorkspaceScheduledReportToken({ workspaceId, actorUserId, scheduleId, token: 'x', now }))
      .rejects.toThrow('Un envoi est en cours')
  })
})
