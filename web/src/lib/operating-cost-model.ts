import { z } from 'zod'

export const COST_CATEGORIES = { collections: 'Collectes Google', database: 'Base de données', functions: 'Fonctions', storage: 'Stockage', email: 'Email', support: 'Support' } as const
export const COST_PLANS = ['trial', 'solo', 'studio', 'agency', 'internal', 'unallocated'] as const
export const COST_PLAN_LABELS = { trial: 'Essai', solo: 'Solo', studio: 'Studio', agency: 'Agency', internal: 'Interne', unallocated: 'Non réparti' } as const
export const COST_METHODS = { direct: 'Affectation directe justifiée', usage: 'Répartition selon les usages', workspace_days: 'Répartition selon les jours par forfait', manual: 'Répartition manuelle estimée', unallocated: 'Non réparti' } as const
export type CostPlan = typeof COST_PLANS[number]
export const costMonthSchema = z.string().regex(/^20\d{2}-(0[1-9]|1[0-2])$/)
const percentage = z.coerce.number().finite().min(0).max(100).refine((value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-7, 'Deux décimales au maximum.').transform((value) => Math.round(value * 100))
const optionalDecimal = (scale: number, signed = false) => z.string().trim().regex(new RegExp(`^$|^${signed ? '-?' : ''}(?:0|[1-9]\\d{0,8})(?:\\.\\d{1,${scale}})?$`))
export const costEntrySchema = z.object({
  sourceKey: z.string().trim().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{2,99}$/),
  month: costMonthSchema,
  category: z.enum(['collections', 'database', 'functions', 'storage', 'email', 'support']),
  currency: z.string().regex(/^[A-Z]{3}$/).refine((value) => Intl.supportedValuesOf('currency').includes(value), 'Devise inconnue.'),
  basis: z.enum(['documented', 'estimated']),
  amount: optionalDecimal(6, true),
  supportMinutes: optionalDecimal(2),
  allocationMethod: z.enum(['direct', 'usage', 'workspace_days', 'manual', 'unallocated']),
  trialWeight: percentage, soloWeight: percentage, studioWeight: percentage, agencyWeight: percentage, internalWeight: percentage, unallocatedWeight: percentage,
  expectedVersion: z.coerce.number().int().min(0).max(2147483646),
  voided: z.enum(['false', 'true']).transform((value) => value === 'true'),
}).superRefine((value, context) => {
  const fail = (message: string) => context.addIssue({ code: 'custom', message })
  if (COST_PLANS.reduce((sum, plan) => sum + value[`${plan}Weight`], 0) !== 10000) fail('La répartition doit totaliser 100 %.')
  if (value.allocationMethod === 'direct' && !COST_PLANS.slice(0, -1).some((plan) => value[`${plan}Weight`] === 10000)) fail('Une affectation directe doit concerner un seul forfait.')
  if (value.allocationMethod === 'unallocated' && value.unallocatedWeight !== 10000) fail('Un coût non réparti doit rester à 100 % non réparti.')
  if (!value.amount && !(value.category === 'support' && value.supportMinutes)) fail('Un montant ou une durée de support est requis.')
  if (value.supportMinutes && value.category !== 'support') fail('La durée concerne uniquement le support.')
  if (value.expectedVersion === 0 && value.voided) fail('Créer une observation active avant de la retirer.')
})
export type CostEntryInput = z.input<typeof costEntrySchema>
export type CostEntry = {
  sourceKey: string; month: string; category: keyof typeof COST_CATEGORIES; currency: string; basis: 'documented' | 'estimated'; amountMicros: string | null; supportMinutes: string | null;
  allocationMethod: keyof typeof COST_METHODS; trialWeight: number; soloWeight: number; studioWeight: number; agencyWeight: number; internalWeight: number; unallocatedWeight: number;
  version: number; voided: boolean;
}

/** Decimal strings and integer arithmetic keep amounts exact, including credits. */
export function decimalToUnits(value: string, scale = 6): bigint {
  const negative = value.startsWith('-'), unsigned = negative ? value.slice(1) : value
  const [whole, fraction = ''] = unsigned.split('.')
  return (negative ? -BigInt(1) : BigInt(1)) * BigInt(whole + fraction.padEnd(scale, '0'))
}
export function unitsToDecimal(value: bigint | string, scale = 6): string {
  const amount = BigInt(value), digits = (amount < 0 ? -amount : amount).toString().padStart(scale + 1, '0')
  return `${amount < 0 ? '-' : ''}${digits.slice(0, -scale)}.${digits.slice(-scale)}`
}
export function allocateUnits(total: bigint, entry: Pick<CostEntry, `${CostPlan}Weight`>): Record<CostPlan, bigint> {
  const absolute = total < BigInt(0) ? -total : total
  const portions = COST_PLANS.map((plan) => ({ plan, value: absolute * BigInt(entry[`${plan}Weight`]) / BigInt(10000), remainder: absolute * BigInt(entry[`${plan}Weight`]) % BigInt(10000) }))
  let remaining = absolute - portions.reduce((sum, portion) => sum + portion.value, BigInt(0))
  for (const portion of [...portions].sort((a, b) => Number(b.remainder - a.remainder))) {
    if (remaining <= BigInt(0)) break
    portion.value++; remaining--
  }
  return Object.fromEntries(portions.map(({ plan, value }) => [plan, total < BigInt(0) ? -value : value])) as Record<CostPlan, bigint>
}

/** A cell is a recorded contribution, never an assertion of invoice completeness. */
export function summarizeOperatingCosts(entries: CostEntry[]) {
  const cells = new Map<string, { category: CostEntry['category']; currency: string; plan: CostPlan; documentedDirect: bigint | null; documentedAllocated: bigint | null; estimated: bigint | null; supportHundredths: bigint | null; estimatedSupportHundredths: bigint | null; unpricedSupport: boolean; sources: number }>()
  for (const entry of entries.filter((item) => !item.voided)) {
    const money = entry.amountMicros === null ? null : allocateUnits(BigInt(entry.amountMicros), entry)
    const duration = entry.supportMinutes === null ? null : allocateUnits(decimalToUnits(entry.supportMinutes, 2), entry)
    for (const plan of COST_PLANS.filter((item) => entry[`${item}Weight`] > 0)) {
      const key = `${entry.currency}:${entry.category}:${plan}`
      const cell = cells.get(key) ?? { category: entry.category, currency: entry.currency, plan, documentedDirect: null, documentedAllocated: null, estimated: null, supportHundredths: null, estimatedSupportHundredths: null, unpricedSupport: false, sources: 0 }
      const field = entry.basis === 'estimated' || entry.allocationMethod === 'manual' ? 'estimated' : entry.allocationMethod === 'direct' || entry.allocationMethod === 'unallocated' ? 'documentedDirect' : 'documentedAllocated'
      if (money) cell[field] = (cell[field] ?? BigInt(0)) + money[plan]
      const timeField = entry.basis === 'estimated' || entry.allocationMethod === 'manual' ? 'estimatedSupportHundredths' : 'supportHundredths'
      if (duration) cell[timeField] = (cell[timeField] ?? BigInt(0)) + duration[plan]
      if (duration && !money) cell.unpricedSupport = true
      cell.sources++; cells.set(key, cell)
    }
  }
  return [...cells.values()].sort((a, b) => `${a.currency}:${a.category}:${a.plan}`.localeCompare(`${b.currency}:${b.category}:${b.plan}`))
}
