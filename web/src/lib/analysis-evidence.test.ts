import { expect, it } from 'vitest'
import { qualifiedAnalysisEvidence } from './analysis-evidence'
import type { AnalyticalSnapshot } from './analytical-model'

const now = new Date('2026-09-07T10:00:00Z'), client = { timezone: 'Europe/Paris', currencyCode: 'EUR' }
const coverage = { version: 1, queries: [{ queryHash: 'a'.repeat(64), rows: 1, pages: 1, bytes: 100, limit: 500, state: 'query_complete' }] }
const rows: AnalyticalSnapshot[] = ['campaigns', 'searchTerms', 'keywords', 'ads', 'tracking'].map((family) => ({
  family, contractVersion: 1, periodFrom: '2026-08-08', periodThrough: '2026-09-06', ...client,
  sourceVersion: `source-${family}`, observedAt: now, collectedAt: now,
  payload: family === 'campaigns' ? [{ id: '1' }] : family === 'tracking' ? { status: 'MANAGED_BY_THIS_CUSTOMER' } : [], coverage,
}))

it('qualifies an actual available analysis and retains source versions without metric payloads', () => {
  expect(qualifiedAnalysisEvidence(rows, client, now)).toEqual({
    evidence: 'analysis_sources_v1', periodFrom: '2026-08-08', periodThrough: '2026-09-06', ...client,
    sourceVersions: Object.fromEntries(rows.map((row) => [row.family, row.sourceVersion])),
  })
})

it('does not count a confirmed empty account, missing section or malformed payload', () => {
  expect(qualifiedAnalysisEvidence([], client, now)).toBeNull()
  expect(qualifiedAnalysisEvidence(rows.map((row) => row.family === 'campaigns' ? { ...row, payload: [] } : row), client, now)).toBeNull()
  for (const family of rows.map((row) => row.family)) {
    expect(qualifiedAnalysisEvidence(rows.filter((row) => row.family !== family), client, now)).toBeNull()
    expect(qualifiedAnalysisEvidence(rows.map((row) => row.family === family ? { ...row, payload: family === 'tracking' ? [] : {} } : row), client, now)).toBeNull()
  }
})

it('requires recent versioned coverage for every section of the same client window', () => {
  for (const family of rows.map((row) => row.family)) for (const change of [
    { sourceVersion: ' ' }, { coverage: null },
    { coverage: { version: 1, queries: [{ ...coverage.queries[0], rows: 500, state: 'limit_reached' }] } },
    { observedAt: new Date(now.getTime() - 27 * 3600_000) }, { observedAt: new Date(now.getTime() + 3600_000) },
    { contractVersion: 2 }, { currencyCode: 'USD' }, { timezone: 'UTC' },
    { periodFrom: '2026-08-07', periodThrough: '2026-09-05' },
  ]) expect(qualifiedAnalysisEvidence(rows.map((row) => row.family === family ? { ...row, ...change } : row), client, now)).toBeNull()
})
