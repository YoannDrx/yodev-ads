import { describe, expect, it } from 'vitest'
import { portfolioDecimal, readPortfolioCriteria } from './portfolio-query'

describe('portfolio query and exact presentation', () => {
  it('normalizes shareable filters and rejects unsupported settings', () => {
    expect(readPortfolioCriteria({})).toEqual({ q: '', currency: '', attention: 'all', assignee: '' })
    expect(readPortfolioCriteria({ q: ' client ', currency: 'USD', attention: 'critical', assignee: 'member' })).toEqual({ q: 'client', currency: 'USD', attention: 'critical', assignee: 'member' })
    expect(() => readPortfolioCriteria({ currency: 'usd' })).toThrow()
    expect(() => readPortfolioCriteria({ attention: 'healthy' })).toThrow()
    expect(() => readPortfolioCriteria({ q: 'x'.repeat(121) })).toThrow()
  })
  it('formats large and fractional totals without losing decimal precision', () => {
    expect(portfolioDecimal('900719925474099312345.1250', 'en')).toBe('900,719,925,474,099,312,345.13')
    expect(portfolioDecimal('999.999', 'en')).toBe('1,000')
    expect(portfolioDecimal('-0.0001', 'fr')).toBe('0')
    expect(portfolioDecimal('-123.4000', 'fr')).toBe('-123,4')
    expect(portfolioDecimal('123.5', 'en', 0)).toBe('124')
    for (const value of ['NaN', '1e9', '', 'Infinity']) expect(() => portfolioDecimal(value, 'en')).toThrow()
    expect(() => portfolioDecimal('1', 'fr', 7)).toThrow()
  })
})
