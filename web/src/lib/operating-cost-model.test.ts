import { describe, expect, it } from 'vitest'
import { allocateUnits, costEntrySchema, decimalToUnits, summarizeOperatingCosts, unitsToDecimal, type CostEntry } from './operating-cost-model'

const input = { sourceKey: 'invoice-2026-09-1', month: '2026-09', category: 'functions', currency: 'EUR', basis: 'documented', amount: '0.000001', supportMinutes: '', allocationMethod: 'usage', trialWeight: 0, soloWeight: 33.33, studioWeight: 33.33, agencyWeight: 33.34, internalWeight: 0, unallocatedWeight: 0, expectedVersion: 0, voided: 'false' }
function entry(overrides: Partial<CostEntry> = {}): CostEntry {
  const parsed = costEntrySchema.parse(input)
  return { ...parsed, supportMinutes: null, amountMicros: '1', version: 1, ...overrides }
}
describe('operating cost evidence', () => {
  it('preserves fractional provider amounts and negative credits exactly', () => {
    for (const value of ['12345678.123456', '-12345678.123456', '0.000001', '-0.000001', '0.000000']) expect(unitsToDecimal(decimalToUnits(value))).toBe(value)
    expect(decimalToUnits('12.5', 2)).toBe(BigInt(1250))
  })
  it('conserves every micro-unit with deterministic largest-remainder allocation', () => {
    expect(allocateUnits(BigInt(1), entry())).toMatchObject({ solo: BigInt(0), studio: BigInt(0), agency: BigInt(1) })
    for (const amount of [0, 1, 2, 7, 10001, -1, -7, -10001]) expect(Object.values(allocateUnits(BigInt(amount), entry())).reduce((sum, value) => sum + value, BigInt(0))).toBe(BigInt(amount))
  })
  it.each([
    { soloWeight: 0 }, { soloWeight: -1 }, { soloWeight: 33.333 }, { allocationMethod: 'direct' }, { allocationMethod: 'unallocated' },
    { amount: '' }, { amount: '1,2' }, { amount: '1e6' }, { amount: 'Infinity' }, { amount: '1000000000' }, { amount: '1.0000001' },
    { month: '2026-13' }, { currency: 'ZZZ' }, { sourceKey: 'https://secret.test' }, { sourceKey: 'name@example.test' }, { supportMinutes: '3' }, { voided: 'true' },
  ])('refuses ambiguous, unbalanced or secret-bearing input shapes: %j', (override) => {
    expect(costEntrySchema.safeParse({ ...input, ...override }).success).toBe(false)
  })
  it('permits a documented zero and unpriced support while keeping absent amounts unknown', () => {
    expect(costEntrySchema.safeParse({ ...input, amount: '0' }).success).toBe(true)
    expect(costEntrySchema.safeParse({ ...input, category: 'support', amount: '', supportMinutes: '30.50' }).success).toBe(true)
    const cells = summarizeOperatingCosts([entry({ category: 'support', amountMicros: null, supportMinutes: '30.50' })])
    expect(cells.every((cell) => cell.unpricedSupport && cell.documentedAllocated === null && cell.estimated === null)).toBe(true)
    expect(cells.reduce((sum, cell) => sum + cell.supportHundredths!, BigInt(0))).toBe(BigInt(3050))
  })
  it('separates currencies, estimates, direct charges, documented allocations and voids', () => {
    const direct = entry({ soloWeight: 10000, studioWeight: 0, agencyWeight: 0, allocationMethod: 'direct', amountMicros: '1500000' })
    const cells = summarizeOperatingCosts([
      direct, { ...direct, amountMicros: '-500000' }, { ...direct, currency: 'USD' },
      { ...direct, allocationMethod: 'manual', amountMicros: '2000000' },
      { ...direct, allocationMethod: 'usage', amountMicros: '3000000' },
      { ...direct, amountMicros: '9000000', voided: true },
    ])
    expect(cells).toHaveLength(2)
    expect(cells[0]).toMatchObject({ currency: 'EUR', documentedDirect: BigInt(1000000), documentedAllocated: BigInt(3000000), estimated: BigInt(2000000), sources: 4 })
    expect(cells[1]).toMatchObject({ currency: 'USD', documentedDirect: BigInt(1500000), estimated: null })
    expect(summarizeOperatingCosts([])).toEqual([])
  })
  it('labels manually allocated support time as estimated attribution', () => {
    const cells = summarizeOperatingCosts([entry({ category: 'support', amountMicros: null, supportMinutes: '10', allocationMethod: 'manual' })])
    expect(cells.every((cell) => cell.supportHundredths === null && cell.estimatedSupportHundredths !== null)).toBe(true)
  })
})
