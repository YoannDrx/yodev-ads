import { analyticalSnapshotState, type AnalyticalSnapshot } from '@/lib/analytical-model'
import { googleCoverageState } from '@/lib/google-collection-coverage'

const families = ['campaigns', 'searchTerms', 'keywords', 'ads', 'tracking'] as const

/** Evidence that a 30-day analysis can be produced now, not that a human read it. */
export function qualifiedAnalysisEvidence(snapshots: AnalyticalSnapshot[], client: { timezone: string; currencyCode: string }, now = new Date()) {
  const selected = families.map((family) => snapshots.find((row) => row.family === family))
  if (selected.some((row) => !row || !row.sourceVersion.trim()
    || analyticalSnapshotState(row, client, now) !== 'available'
    || googleCoverageState(row.coverage) !== 'received'
    || (row.family === 'tracking' ? !row.payload || typeof row.payload !== 'object' || Array.isArray(row.payload) : !Array.isArray(row.payload)))) return null
  const rows = selected as AnalyticalSnapshot[]
  if (!(rows[0].payload as unknown[]).length || new Set(rows.map((row) => `${row.periodFrom}/${row.periodThrough}`)).size !== 1) return null
  return {
    evidence: 'analysis_sources_v1',
    periodFrom: rows[0].periodFrom,
    periodThrough: rows[0].periodThrough,
    timezone: client.timezone,
    currencyCode: client.currencyCode,
    sourceVersions: Object.fromEntries(rows.map((row) => [row.family, row.sourceVersion])),
  }
}
