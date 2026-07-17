export function formatMoneyFromMicros(value: string | number, currency = 'EUR', locale = 'fr-FR') {
  return new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: 2 }).format(
    Number(value) / 1_000_000,
  )
}

export function formatInteger(value: string | number, locale = 'fr-FR') {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(Number(value))
}

export function formatPercent(value: number, locale = 'fr-FR') {
  return new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 }).format(value)
}
