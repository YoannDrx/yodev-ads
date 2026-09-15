import { describe, expect, it } from 'vitest'
import { reportMoney, reportInteger } from './report-format'

describe('exact report formatting', () => {
  it('preserves cents beyond the JavaScript integer precision limit', () => {
    expect(reportMoney('9007199254740993010000', 'EUR', 'en')).toBe('€9,007,199,254,740,993.01')
    expect(reportMoney('9007199254740993010000', 'EUR', 'fr')).toMatch(/^9.007.199.254.740.993,01.€$/)
    expect(reportInteger('9007199254740993', 'en')).toBe('9,007,199,254,740,993')
  })
  it('honours currency minor units and rounds refunds symmetrically', () => {
    expect(reportMoney('12345000', 'EUR', 'en')).toBe('€12.35')
    expect(reportMoney('-12345000', 'EUR', 'en')).toBe('-€12.35')
    expect(reportMoney('12500000', 'JPY', 'en')).toBe('JP¥13')
    expect(reportMoney('1234567', 'KWD', 'en')).toMatch(/1\.235/)
  })
})
