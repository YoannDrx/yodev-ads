import { beforeEach, expect, it, vi } from 'vitest'
import { databaseDouble } from '../../test/fluent-db'
const mocks = vi.hoisted(() => ({ db: undefined as unknown, guard: vi.fn() }))
vi.mock('@/db/transactions', () => ({ withTenantTransaction: async (_: unknown, run: (db: unknown) => unknown) => run(mocks.db) }))
vi.mock('@/lib/workspace-actor-guard', () => ({ lockWorkspaceActor: mocks.guard }))
import { reviewAlertQuality } from './alert-quality'
import { alertQualityLabel, alertQualityState } from './alert-quality-model'

const input = { workspaceId: '91000000-0000-4000-8000-000000000001', actorUserId: 'actor', incidentId: '91000000-0000-4000-8000-000000000002', label: 'useful', expectedOccurrence: 1, expectedVersion: 0 }
const row = { label: null, version: 0, reviewedOccurrence: null, occurrence: 1 }
function database(current: unknown = row) { const db = databaseDouble({ statementResults: [current ? [current] : [], [], []] }); mocks.db = db.db; return db }
beforeEach(() => { vi.resetAllMocks() })

it('records only review evidence and an audit without altering the alert workflow', async () => {
  const db = database()
  expect(await reviewAlertQuality(input)).toEqual({ changed: true })
  expect(mocks.guard).toHaveBeenCalledWith(db.db, expect.objectContaining({ permission: 'alerts:manage' }))
  expect(db.capture.sets[0]).toEqual({ qualityLabel: 'useful', qualityOccurrence: 1, qualityVersion: 1, qualityReviewedAt: expect.any(Date), qualityReviewedBy: 'actor' })
  expect(db.capture.values[0]).toMatchObject({ action: 'monitoring.alert_quality_reviewed', metadata: { before: null, after: 'useful', observedOccurrence: 1, version: 1 } })
})

it.each([null, { ...row, version: 1 }, { ...row, occurrence: 2 }])('refuses missing, stale or concurrently reviewed alerts: %j', async (current) => {
  const db = database(current)
  await expect(reviewAlertQuality(input)).rejects.toThrow('changed')
  expect(db.capture.sets).toEqual([])
  expect(db.capture.values).toEqual([])
})

it('does not write when current authority is revoked', async () => {
  const db = database(); mocks.guard.mockRejectedValue(new Error('permission denied'))
  await expect(reviewAlertQuality(input)).rejects.toThrow('permission denied')
  expect(db.capture.sets).toEqual([])
})

it('clears a review with an audit, retains unchanged reviews and refreshes stale observations', async () => {
  const db = database({ ...row, label: 'noise', version: 2, reviewedOccurrence: 1 })
  await reviewAlertQuality({ ...input, label: 'unreviewed', expectedVersion: 2 })
  expect(db.capture.sets[0]).toEqual({ qualityLabel: null, qualityVersion: 3, qualityOccurrence: null, qualityReviewedAt: null, qualityReviewedBy: null })
  const unchanged = database({ ...row, label: 'useful', reviewedOccurrence: 1 })
  expect(await reviewAlertQuality(input)).toEqual({ changed: false })
  expect(unchanged.capture.values).toEqual([])
  database({ ...row, label: 'useful', reviewedOccurrence: 1, occurrence: 2 })
  expect(await reviewAlertQuality({ ...input, expectedOccurrence: 2 })).toEqual({ changed: true })
})

it('keeps unknown, unreviewed and stale classifications distinct', () => {
  expect(alertQualityLabel('__proto__', true)).toBe('Not reviewed')
  expect(alertQualityLabel('false_positive')).toBe('Faux positif')
  expect(alertQualityState({ qualityLabel: null, qualityOccurrence: null, occurrenceCount: 1 })).toBe('unreviewed')
  expect(alertQualityState({ qualityLabel: 'noise', qualityOccurrence: 1, occurrenceCount: 2 })).toBe('stale')
  expect(alertQualityState({ qualityLabel: 'noise', qualityOccurrence: 2, occurrenceCount: 2 })).toBe('current')
})

it('rejects malformed classification or concurrency tokens before opening a transaction', async () => {
  database()
  for (const values of [{ label: 'resolved' }, { expectedVersion: -1 }, { expectedOccurrence: 0 }, { incidentId: 'invalid' }]) expect(() => reviewAlertQuality({ ...input, ...values })).toThrow()
  expect(mocks.guard).not.toHaveBeenCalled()
})
