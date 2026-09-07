import { z } from 'zod'

/** Describes the transport of a GAQL query, not Google's privacy thresholds or business coverage. */
const querySchema = z.object({
  queryHash: z.string().regex(/^[a-f0-9]{64}$/), rows: z.number().int().min(0).max(100_000),
  pages: z.number().int().min(1).max(100), bytes: z.number().int().min(0).max(64 * 1024 * 1024),
  limit: z.number().int().positive().nullable(), state: z.enum(['query_complete', 'limit_reached']),
}).strict().refine((query) => (query.limit !== null && query.rows >= query.limit) === (query.state === 'limit_reached'))
export const googleCollectionCoverageSchema = z.object({ version: z.literal(1), queries: z.array(querySchema).max(100) }).strict()
export type GoogleQueryCoverage = z.infer<typeof querySchema>
export type GoogleCollectionCoverage = z.infer<typeof googleCollectionCoverageSchema>

export function googleCoverageState(value: unknown) {
  const parsed = googleCollectionCoverageSchema.safeParse(value)
  if (!parsed.success || !parsed.data.queries.length) return 'unknown' as const
  return parsed.data.queries.some((query) => query.state === 'limit_reached') ? 'limited' as const : 'received' as const
}

export function googleCoverageLabel(value: unknown, locale: 'fr' | 'en') {
  const state = googleCoverageState(value), english = locale === 'en'
  return state === 'limited' ? (english ? 'Collection limit reached; results are limited' : 'Plafond de collecte atteint ; résultats limités')
    : state === 'received' ? (english ? 'All available query pages received' : 'Toutes les pages disponibles reçues')
      : (english ? 'Collection coverage not verified' : 'Couverture de collecte non vérifiée')
}
