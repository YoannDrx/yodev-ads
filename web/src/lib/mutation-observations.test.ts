import { beforeEach, describe, expect, it, vi } from 'vitest'
import { databaseDouble } from '../../test/fluent-db'

const mocks = vi.hoisted(() => ({
  database: undefined as unknown,
  transaction: vi.fn(async (callback: (db: unknown) => unknown) => callback(mocks.database)),
}))
vi.mock('@/db/transactions', () => ({ withSystemTransaction: mocks.transaction }))

import { completeMutationObservation, mutationCampaignIds, scheduleMutationObservationWithDatabase } from './mutation-observations'

const metrics = {
  dataPoints: 7, costMicros: '100', impressions: '1000', clicks: '100', conversions: '10', conversionValueMicros: '500',
}

const approval = {
  id: 'approval-1', workspaceId: 'workspace-1', clientId: 'client-1', observationWindowDays: 7,
  payload: { campaignId: '10' },
}
const client = { id: 'client-1', timezone: 'Europe/Paris' }

describe('mutation observation campaign scope', () => {
  beforeEach(() => vi.clearAllMocks())

  it('extracts stable campaign IDs from individual, reallocation and generic batch payloads', () => {
    expect(mutationCampaignIds({ campaignId: '1' })).toEqual(['1'])
    expect(mutationCampaignIds({ changes: [{ campaignId: '2' }, { campaignId: '3' }] })).toEqual(['2', '3'])
    expect(mutationCampaignIds({ operations: [{ campaignId: '4' }, { campaignId: '4' }, { campaignId: 'invalid' }] })).toEqual(['4'])
    expect(mutationCampaignIds({ campaignId: '10', campaignIds: ['2', '10', 'invalid', '1'] })).toEqual(['1', '2', '10'])
    expect(mutationCampaignIds({ changes: [null, 'x', { campaignId: 3 }], operations: [{}] })).toEqual([])
  })

  it('persists a baseline and schedules exactly one durable observation', async () => {
    const observation = { id: 'observation-1' }
    const database = databaseDouble({ statementResults: [[metrics], [observation], []] })
    await expect(scheduleMutationObservationWithDatabase(database.db as never, {
      approval: approval as never, client: client as never, executedAt: new Date('2026-08-12T10:00:00Z'),
    })).resolves.toEqual(observation)
    expect(database.capture.values).toEqual(expect.arrayContaining([
      expect.objectContaining({ approvalId: 'approval-1', campaignIds: ['10'], baselineMetrics: expect.objectContaining({ expectedDataPoints: 7 }) }),
      expect.objectContaining({ type: 'mutation.observe', deduplicationKey: 'mutation.observe:approval-1', payload: { observationId: 'observation-1' } }),
    ]))
  })

  it('resolves a concurrent schedule and rejects missing campaign or unresolved persistence', async () => {
    const query = { mutationObservations: { findFirst: vi.fn(async () => ({ id: 'existing-observation' })) } }
    const concurrent = databaseDouble({ statementResults: [[metrics], [], []], query })
    await expect(scheduleMutationObservationWithDatabase(concurrent.db as never, {
      approval: approval as never, client: client as never, executedAt: new Date('2026-08-12'),
    })).resolves.toBeNull()
    expect(concurrent.capture.values.at(-1)).toEqual(expect.objectContaining({ payload: { observationId: 'existing-observation' } }))

    await expect(scheduleMutationObservationWithDatabase(databaseDouble().db as never, {
      approval: { ...approval, payload: {} } as never, client: client as never, executedAt: new Date('2026-08-12'),
    })).rejects.toThrow('at least one campaign')

    const unresolved = databaseDouble({ statementResults: [[metrics], []], query: { mutationObservations: { findFirst: vi.fn(async () => undefined) } } })
    await expect(scheduleMutationObservationWithDatabase(unresolved.db as never, {
      approval: approval as never, client: client as never, executedAt: new Date('2026-08-12'),
    })).rejects.toThrow('could not be resolved')
  })

  it('completes a due observation with normalized metrics and immutable audit evidence', async () => {
    const observation = {
      id: 'observation-1', approvalId: 'approval-1', workspaceId: 'workspace-1', clientId: 'client-1',
      status: 'scheduled', campaignIds: ['10'], windowDays: 7, observationFrom: '2026-08-13', observationThrough: '2026-08-19',
      baselineMetrics: { ...metrics, expectedDataPoints: 7 },
    }
    const database = databaseDouble({ statementResults: [[observation], [{ ...metrics, costMicros: '120' }], [], []] })
    mocks.database = database.db
    const completedAt = new Date('2026-08-20T12:00:00Z')
    await expect(completeMutationObservation(observation.id, completedAt)).resolves.toMatchObject({
      status: 'completed', outcome: { deltasPercent: { cost: 20 } },
    })
    expect(database.capture.sets[0]).toEqual(expect.objectContaining({ status: 'completed', completedAt }))
    expect(database.capture.values.at(-1)).toEqual(expect.objectContaining({
      action: 'mutation.observation_completed', actorUserId: 'system:mutation-observer',
    }))
  })

  it('is idempotent when an observation is already processed', async () => {
    mocks.database = databaseDouble({ statementResults: [[]] }).db
    await expect(completeMutationObservation('observation-1')).resolves.toEqual({ status: 'already_processed' })
  })
})
