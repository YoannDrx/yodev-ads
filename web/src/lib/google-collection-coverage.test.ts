import { describe, expect, it } from 'vitest'
import { googleCollectionCoverageSchema, googleCoverageState, googleCoverageLabel } from './google-collection-coverage'
const query = { queryHash: 'a'.repeat(64), rows: 500, pages: 1, bytes: 1000, limit: 500, state: 'limit_reached' as const }
describe('source coverage qualification', () => {
  it('distinguishes unknown legacy coverage, a reached cap and completed query pages', () => {
    for (const value of [undefined, null, {}, { version: 1, queries: [] }, { version: 2, queries: [query] }]) expect(googleCoverageState(value)).toBe('unknown')
    expect(googleCoverageState({ version: 1, queries: [query] })).toBe('limited')
    expect(googleCoverageState({ version: 1, queries: [{ ...query, rows: 499, state: 'query_complete' }] })).toBe('received')
    expect(googleCoverageState({ version: 1, queries: [{ ...query, limit: null, state: 'query_complete' }] })).toBe('received')
  })
  it('rejects inconsistent counts, a forged completeness claim and unbounded metadata', () => {
    for (const change of [{ rows: -1 }, { pages: 101 }, { bytes: 70_000_000 }, { state: 'query_complete' }, { queryHash: 'private query' }]) {
      expect(googleCollectionCoverageSchema.safeParse({ version: 1, queries: [{ ...query, ...change }] }).success).toBe(false)
    }
    expect(googleCollectionCoverageSchema.safeParse({ version: 1, queries: Array.from({ length: 101 }, () => query) }).success).toBe(false)
  })
  it('localizes received, limited and unknown labels without promising all Google activity', () => {
    expect(googleCoverageLabel(undefined, 'fr')).toContain('non vérifiée')
    expect(googleCoverageLabel(undefined, 'en')).toContain('not verified')
    expect(googleCoverageLabel({ version: 1, queries: [query] }, 'fr')).toContain('résultats limités')
    expect(googleCoverageLabel({ version: 1, queries: [query] }, 'en')).toContain('results are limited')
    expect(googleCoverageLabel({ version: 1, queries: [{ ...query, limit: null, state: 'query_complete' }] }, 'fr')).toContain('pages disponibles')
    expect(googleCoverageLabel({ version: 1, queries: [{ ...query, limit: null, state: 'query_complete' }] }, 'en')).toContain('available query pages')
  })
})
