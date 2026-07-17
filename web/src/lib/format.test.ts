import { describe, expect, it } from 'vitest'
import { formatInteger, formatMoneyFromMicros, formatPercent } from '@/lib/format'

describe('report formatting', () => {
  it('converts micros to currency', () => expect(formatMoneyFromMicros('12500000', 'EUR')).toContain('12,50'))
  it('formats integer metrics', () => expect(formatInteger(1234)).toMatch(/1[\s ]234/))
  it('formats ratios as percentages', () => expect(formatPercent(0.127)).toContain('12,7'))
})
