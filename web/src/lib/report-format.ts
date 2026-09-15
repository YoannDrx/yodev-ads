/** Exact integer-micro rounding, without converting large monetary values to Number. */
export function reportMoney(value: string | number, currency: string, locale: 'fr' | 'en') {
  const micros = typeof value === 'number' ? BigInt(Math.round(value)) : BigInt(value)
  const formatter = new Intl.NumberFormat(locale === 'en' ? 'en-GB' : 'fr-FR', { style: 'currency', currency })
  const digits = formatter.resolvedOptions().maximumFractionDigits ?? 2
  const scale = BigInt(10) ** BigInt(6 - digits)
  const negative = micros < BigInt(0)
  const absolute = negative ? -micros : micros
  const rounded = (absolute + scale / BigInt(2)) / scale
  const unit = BigInt(10) ** BigInt(digits)
  const whole = rounded / unit
  const fraction = (rounded % unit).toString().padStart(digits, '0')
  const number = new Intl.NumberFormat(locale === 'en' ? 'en-GB' : 'fr-FR', { maximumFractionDigits: 0 }).format(whole)
  return formatter.formatToParts(negative ? -1 : 1).map((part) => {
    if (part.type === 'integer') return number
    if (part.type === 'fraction') return fraction
    if (part.type === 'group') return ''
    return part.value
  }).join('')
}

export function reportInteger(value: string | number, locale: 'fr' | 'en') {
  return new Intl.NumberFormat(locale === 'en' ? 'en-GB' : 'fr-FR', { maximumFractionDigits: 0 }).format(typeof value === 'string' ? BigInt(value) : value)
}
export function reportDecimal(value: number, locale: 'fr' | 'en', maximumFractionDigits = 2) {
  return new Intl.NumberFormat(locale === 'en' ? 'en-GB' : 'fr-FR', { maximumFractionDigits }).format(value)
}
export function reportCampaignStatus(status: string, locale: 'fr' | 'en') {
  if (status === 'ENABLED') return locale === 'en' ? 'Active' : 'Active'
  if (status === 'PAUSED') return locale === 'en' ? 'Paused' : 'En pause'
  if (status === 'REMOVED') return locale === 'en' ? 'Removed' : 'Supprimée'
  return locale === 'en' ? 'Unknown' : 'Inconnu'
}
