import { describe, expect, it } from 'vitest'
import { portfolioDigestDescription } from './portfolio-digest'
import type { PortfolioGroup } from './portfolio-data'

const summary = { accounts: 50, needs_action: 6, unqualified: 5, critical_alerts: 2, overdue_tasks: 1, pending_approvals: 3 }
const group: PortfolioGroup = { currency_code: 'USD', timezone: 'America/New_York', period_from: '2026-08-08', period_through: '2026-09-06', accounts: 20, qualified_accounts: 15, cost_micros: '9007199254740993010000', clicks: '9007199254740993', conversions: '1.2500', conversion_value_micros: '0' }
describe('qualified weekly portfolio digest', () => {
  it('preserves exact large amounts, local periods and qualified denominators without mixing currencies', () => {
    const result = portfolioDigestDescription(summary, [group, { ...group, currency_code: 'JPY', timezone: 'Asia/Tokyo', accounts: 30, qualified_accounts: 30, cost_micros: '0', clicks: '0', conversions: '0' }], 'en')
    expect(result).toContain('50 managed accounts')
    expect(result).toContain('15/20 qualified accounts')
    expect(result).toContain('US$9,007,199,254,740,993.01 spent, 9,007,199,254,740,993 clicks, 1.25 conversions')
    expect(result).toContain('JPY · Asia/Tokyo · 2026-08-08 → 2026-09-06')
    expect(result).toContain('JP¥0 spent, 0 clicks, 0 conversions')
    expect(result).not.toContain('€')
    expect(result).toContain('2 critical alerts · 1 overdue tasks · 3 pending decisions')
  })
  it.each(['fr', 'en'] as const)('distinguishes missing totals from confirmed zero in %s', (locale) => {
    const result = portfolioDigestDescription(summary, [{ ...group, qualified_accounts: 0, cost_micros: null, clicks: null, conversions: null }], locale)
    expect(result).toContain(locale === 'fr' ? 'Aucun total qualifié disponible' : 'No qualified total available')
    expect(result).not.toContain('$0')
    expect(result).toContain('0/20')
  })
  it('localizes exact French decimal and action summaries', () => {
    const result = portfolioDigestDescription(summary, [{ ...group, cost_micros: '1250000', clicks: '10' }], 'fr')
    expect(result).toContain('50 comptes gérés · 6 à traiter · 5 avec des données non qualifiées')
    expect(result).toContain('1,25 conversions')
    expect(result).toContain('3 décisions en attente')
  })
})
