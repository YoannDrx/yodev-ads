import type { PortfolioGroup, PortfolioSummary } from '@/lib/portfolio-data'
import { portfolioDecimal } from '@/lib/portfolio-query'
import { reportInteger, reportMoney } from '@/lib/report-format'

/** No cross-currency sum, conversion or extrapolation from incomplete histories. */
export function portfolioDigestDescription(summary: PortfolioSummary, groups: PortfolioGroup[], locale: 'fr' | 'en') {
  const english = locale === 'en'
  const lines = [english
    ? `${summary.accounts} managed accounts · ${summary.needs_action} need attention · ${summary.unqualified} with unqualified data.`
    : `${summary.accounts} comptes gérés · ${summary.needs_action} à traiter · ${summary.unqualified} avec des données non qualifiées.`]
  for (const group of groups) {
    const period = `${group.currency_code} · ${group.timezone} · ${group.period_from} → ${group.period_through}`
    const coverage = english ? `${group.qualified_accounts}/${group.accounts} qualified accounts` : `${group.qualified_accounts}/${group.accounts} comptes qualifiés`
    const metrics = group.cost_micros === null || group.clicks === null || group.conversions === null
      ? (english ? 'No qualified total available.' : 'Aucun total qualifié disponible.')
      : english
        ? `${reportMoney(group.cost_micros, group.currency_code, locale)} spent, ${reportInteger(group.clicks, locale)} clicks, ${portfolioDecimal(group.conversions, locale, 4)} conversions.`
        : `${reportMoney(group.cost_micros, group.currency_code, locale)} investis, ${reportInteger(group.clicks, locale)} clics, ${portfolioDecimal(group.conversions, locale, 4)} conversions.`
    lines.push(`${period} · ${coverage}: ${metrics}`)
  }
  lines.push(english
    ? `${summary.critical_alerts} critical alerts · ${summary.overdue_tasks} overdue tasks · ${summary.pending_approvals} pending decisions. Review the portfolio in your workspace.`
    : `${summary.critical_alerts} alertes critiques · ${summary.overdue_tasks} tâches en retard · ${summary.pending_approvals} décisions en attente. Consultez le portefeuille dans votre espace.`)
  return lines.join('\n')
}
