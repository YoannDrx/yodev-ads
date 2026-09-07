import { z } from 'zod'

export const portfolioCriteriaSchema = z.object({
  q: z.string().trim().max(120).default(''),
  currency: z.string().regex(/^[A-Z]{3}$/).or(z.literal('')).default(''),
  attention: z.enum(['all', 'action', 'critical', 'missing_data', 'overdue', 'pending_approval']).default('all'),
  assignee: z.string().max(64).default(''),
}).strict()
export type PortfolioCriteria = z.infer<typeof portfolioCriteriaSchema>

export function readPortfolioCriteria(raw: Record<string, unknown>): PortfolioCriteria {
  return portfolioCriteriaSchema.parse({
    q: typeof raw.q === 'string' ? raw.q : '',
    currency: typeof raw.currency === 'string' ? raw.currency : '',
    attention: typeof raw.attention === 'string' ? raw.attention : 'all',
    assignee: typeof raw.assignee === 'string' ? raw.assignee : '',
  })
}

/** Preserve exact decimal digits when PostgreSQL numeric totals exceed Number's integer range. */
export function portfolioDecimal(value: string, locale: 'fr' | 'en', digits = 2) {
  if (!/^-?\d+(\.\d+)?$/.test(value) || !Number.isInteger(digits) || digits < 0 || digits > 6) throw new Error('Invalid decimal')
  const negative = value.startsWith('-'), [integer, fraction = ''] = value.replace(/^-/, '').split('.')
  const scale = BigInt(10) ** BigInt(digits)
  let rounded = BigInt(integer) * scale + BigInt((fraction + '0'.repeat(digits)).slice(0, digits) || '0')
  if (Number(fraction[digits] ?? '0') >= 5) rounded += BigInt(1)
  const whole = rounded / scale, remainder = (rounded % scale).toString().padStart(digits, '0').replace(/0+$/, '')
  const formatter = new Intl.NumberFormat(locale === 'en' ? 'en-GB' : 'fr-FR', { maximumFractionDigits: 0 })
  const separator = locale === 'en' ? '.' : ','
  return `${negative && rounded ? '-' : ''}${formatter.format(whole)}${digits && remainder ? separator + remainder : ''}`
}
