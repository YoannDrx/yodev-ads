import { describe, expect, it } from 'vitest'
import { databaseDouble } from '../../test/fluent-db'
import { assertBudgetChangeSafetyWithDatabase, calendarPeriodAt, evaluateBudgetPolicy, type BudgetPolicy } from './budget-safety'

const policy: BudgetPolicy = {
  currencyCode: 'EUR',
  maximumDailyBudgetMicros: '50000000',
  maximumMonthlySpendMicros: '1000000000',
  maximumVariationPercent: '20',
}

describe('budget safety policies', () => {
  it('enforces currency, daily cap, variation and calendar-month spend', () => {
    expect(() => evaluateBudgetPolicy({ policy, currencyCode: 'USD', currentBudgetMicros: BigInt(10), proposedBudgetMicros: BigInt(10) })).toThrow('EUR')
    expect(() => evaluateBudgetPolicy({ policy, currencyCode: 'EUR', currentBudgetMicros: BigInt(40_000_000), proposedBudgetMicros: BigInt(51_000_000), monthSpendMicros: BigInt(0) })).toThrow('quotidienne')
    expect(() => evaluateBudgetPolicy({ policy, currencyCode: 'EUR', currentBudgetMicros: BigInt(40_000_000), proposedBudgetMicros: BigInt(49_000_000), monthSpendMicros: BigInt(0) })).toThrow('pourcentage')
    expect(() => evaluateBudgetPolicy({ policy, currencyCode: 'EUR', currentBudgetMicros: BigInt(40_000_000), proposedBudgetMicros: BigInt(45_000_000), monthSpendMicros: BigInt(1_000_000_000) })).toThrow('mois calendaire')
  })

  it('blocks when monthly metrics are missing and allows a valid change', () => {
    expect(() => evaluateBudgetPolicy({ policy, currencyCode: 'EUR', currentBudgetMicros: BigInt(40_000_000), proposedBudgetMicros: BigInt(45_000_000) })).toThrow('indisponibles')
    expect(() => evaluateBudgetPolicy({ policy, currencyCode: 'EUR', currentBudgetMicros: BigInt(40_000_000), proposedBudgetMicros: BigInt(45_000_000), monthSpendMicros: BigInt(900_000_000) })).not.toThrow()
    expect(() => evaluateBudgetPolicy({ policy: { ...policy, maximumVariationPercent: null }, currencyCode: 'EUR', currentBudgetMicros: BigInt(0), proposedBudgetMicros: BigInt(1), monthSpendMicros: BigInt(0) })).not.toThrow()
    expect(() => evaluateBudgetPolicy({ policy, currencyCode: 'EUR', currentBudgetMicros: BigInt(40_000_000), proposedBudgetMicros: BigInt(35_000_000), monthSpendMicros: BigInt(1_000_000_000) })).not.toThrow()
  })

  it('uses the client timezone for month boundaries, including leap years', () => {
    expect(calendarPeriodAt(new Date('2028-03-01T00:30:00Z'), 'America/New_York')).toEqual({
      month: '2028-02',
      from: '2028-02-01',
      through: '2028-02-29',
    })
  })

  it('selects the most specific policy and sums the client calendar month', async () => {
    const workspace = { id: 'workspace-1', maximumDailyBudgetMicros: null, maximumMonthlySpendMicros: null }
    const client = { id: 'client-1', currencyCode: 'EUR', timezone: 'Europe/Paris' }
    const candidates = [
      { id: 'global', clientId: null, campaignId: null, ...policy },
      { id: 'client', clientId: client.id, campaignId: null, ...policy },
      { id: 'campaign', clientId: client.id, campaignId: 'campaign-1', ...policy },
    ]
    const database = databaseDouble({ statementResults: [candidates, [{ count: 10, spend: '800000000' }]] })
    await expect(assertBudgetChangeSafetyWithDatabase(database.db as never, {
      workspace: workspace as never, client: client as never, campaignId: 'campaign-1',
      currentBudgetMicros: '40000000', proposedBudgetMicros: '45000000', now: new Date('2026-08-12'),
    })).resolves.toEqual({ applied: true, policyId: 'campaign' })
  })

  it('falls back through client, global and legacy policies and skips when none exists', async () => {
    const client = { id: 'client-1', currencyCode: 'EUR', timezone: 'Europe/Paris' }
    const base = { id: 'workspace-1', maximumDailyBudgetMicros: null, maximumMonthlySpendMicros: null }
    for (const [candidates, expected] of [
      [[{ id: 'client', clientId: client.id, campaignId: null, ...policy }], 'client'],
      [[{ id: 'global', clientId: null, campaignId: null, ...policy }], 'global'],
    ] as const) {
      const database = databaseDouble({ statementResults: [candidates, [{ count: 1, spend: '0' }]] })
      await expect(assertBudgetChangeSafetyWithDatabase(database.db as never, {
        workspace: base as never, client: client as never, campaignId: 'campaign-1',
        currentBudgetMicros: '40000000', proposedBudgetMicros: '45000000',
      })).resolves.toEqual({ applied: true, policyId: expected })
    }

    const legacyDatabase = databaseDouble({ statementResults: [[], [{ count: 1, spend: null }]] })
    await expect(assertBudgetChangeSafetyWithDatabase(legacyDatabase.db as never, {
      workspace: { ...base, maximumMonthlySpendMicros: '1000000000' } as never,
      client: client as never, campaignId: 'campaign-1', currentBudgetMicros: '40000000', proposedBudgetMicros: '45000000',
    })).resolves.toEqual({ applied: true, policyId: 'legacy_workspace' })

    const noPolicyDatabase = databaseDouble({ statementResults: [[]] })
    await expect(assertBudgetChangeSafetyWithDatabase(noPolicyDatabase.db as never, {
      workspace: base as never, client: client as never, campaignId: 'campaign-1', currentBudgetMicros: '1', proposedBudgetMicros: '1',
    })).resolves.toEqual({ applied: false })
  })

  it('fails closed when a monthly policy has no persisted metrics', async () => {
    const database = databaseDouble({ statementResults: [[{ id: 'policy-1', clientId: null, campaignId: null, ...policy }], [{ count: 0, spend: null }]] })
    await expect(assertBudgetChangeSafetyWithDatabase(database.db as never, {
      workspace: { id: 'workspace-1', maximumDailyBudgetMicros: null, maximumMonthlySpendMicros: null } as never,
      client: { id: 'client-1', currencyCode: 'EUR', timezone: 'Europe/Paris' } as never,
      campaignId: 'campaign-1', currentBudgetMicros: '40000000', proposedBudgetMicros: '45000000',
    })).rejects.toThrow('indisponibles')
  })
})
