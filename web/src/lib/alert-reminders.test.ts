import { beforeEach, describe, expect, it, vi } from 'vitest'
import { databaseDouble } from '../../test/fluent-db'

const mocks = vi.hoisted(() => ({
  dbs: [] as unknown[], enabled: vi.fn(), dispatch: vi.fn(),
  transaction: vi.fn(async (fn: (db: unknown) => unknown) => fn(mocks.dbs.shift())),
}))
vi.mock('@/db/transactions', () => ({ withSystemTransaction: mocks.transaction }))
vi.mock('@/lib/feature-flags', () => ({ featureEnabled: mocks.enabled }))
vi.mock('@/lib/notifications', () => ({ dispatchIncidentNotifications: mocks.dispatch }))
import { deliverAlertReminder, pendingAlertReminderJobs } from './alert-reminders'

const now = new Date('2026-10-25T06:00:00Z')
const incident = {
  id: '00000000-0000-4000-8000-000000000001', workspaceId: '00000000-0000-4000-8000-000000000002',
  status: 'open', severity: 'critical', createdAt: new Date('2026-10-25T02:00:00Z'),
  lastNotifiedAt: null, snoozedUntil: null, title: 'Incident', description: 'Details',
}
const input = { workspaceId: incident.workspaceId, incidentId: incident.id, dueAt: now.toISOString() }
function context(overrides = {}) {
  return databaseDouble({ statementResults: [[{
    incident, agent: { enabled: true, reminderIntervalHours: 4 }, workspace: { accessState: 'active', locale: 'en' },
    client: { active: true, isManager: false, name: 'ACME' }, ...overrides,
  }]] }).db
}
function evidence(acceptedAt: Date | null) {
  return databaseDouble({ query: { notificationDeliveries: { findFirst: async () => acceptedAt ? { terminalAt: acceptedAt } : undefined } } }).db
}
describe('independent durable alert reminders', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.dbs = []; mocks.enabled.mockReturnValue(true); mocks.dispatch.mockResolvedValue({ accepted: 1, failed: 0 }) })
  it('schedules due occurrences with a stable delivery identity and a fresh recheck per tick', async () => {
    const row = { incident, intervalHours: 4 }
    mocks.dbs.push(databaseDouble({ statementResults: [[row]] }).db, databaseDouble({ statementResults: [[row]] }).db)
    const first = await pendingAlertReminderJobs(now)
    const later = await pendingAlertReminderJobs(new Date(now.getTime() + 300_000))
    expect(first[0]).toMatchObject({ workspaceId: incident.workspaceId, type: 'monitoring.reminder', priority: 25, payload: input })
    expect(later[0].payload).toEqual(first[0].payload)
    expect(later[0].deduplicationKey).not.toBe(first[0].deduplicationKey)
  })
  it('does nothing while notifications are disabled, independently of Google settings', async () => {
    mocks.enabled.mockReturnValue(false)
    expect(await pendingAlertReminderJobs(now)).toEqual([])
    expect(await deliverAlertReminder(input, now)).toMatchObject({ skipped: true })
    expect(mocks.transaction).not.toHaveBeenCalled()
    expect(mocks.enabled).toHaveBeenCalledWith('notifications')
  })
  it.each(['acknowledged', 'resolved'])('cancels a queued reminder when an incident becomes %s', async (status) => {
    mocks.dbs.push(context({ incident: { ...incident, status } }))
    expect(await deliverAlertReminder(input, now)).toMatchObject({ reason: 'stale' })
    expect(mocks.dispatch).not.toHaveBeenCalled()
  })
  it('does not send an old occurrence after acceptance, a new snooze or a downgrade', async () => {
    for (const overrides of [
      { incident: { ...incident, lastNotifiedAt: now } },
      { incident: { ...incident, status: 'snoozed', snoozedUntil: new Date(now.getTime() + 86_400_000) } },
      { workspace: { accessState: 'grace' } },
      { agent: { enabled: false, reminderIntervalHours: 4 } },
      { client: { active: false } },
    ]) {
      mocks.dbs.push(context(overrides))
      expect(await deliverAlertReminder(input, now)).toMatchObject({ skipped: true })
    }
    expect(mocks.dispatch).not.toHaveBeenCalled()
  })
  it('advances the clock from persisted acceptance, including recovery after a crash', async () => {
    const acceptedAt = new Date(now.getTime() - 1_000)
    const update = databaseDouble()
    mocks.dispatch.mockResolvedValue({ accepted: 0, failed: 0 })
    mocks.dbs.push(context(), evidence(acceptedAt), update.db)
    expect(await deliverAlertReminder(input, now)).toEqual({ accepted: true, acceptedAt: acceptedAt.toISOString() })
    expect(update.capture.sets[0]).toMatchObject({ lastNotifiedAt: acceptedAt })
    expect(mocks.dispatch).toHaveBeenCalledWith(expect.objectContaining({ locale: 'en', eventKey: expect.stringContaining('alert-reminder:') }))
  })
  it('does not mark failed or skipped sends as notified', async () => {
    mocks.dispatch.mockResolvedValue({ accepted: 0, failed: 1 })
    mocks.dbs.push(context(), evidence(null))
    expect(await deliverAlertReminder(input, now)).toMatchObject({ reason: 'not_accepted' })
    expect(mocks.transaction).toHaveBeenCalledTimes(2)
  })
})
