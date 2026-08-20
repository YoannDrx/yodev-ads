import { describe, expect, it } from 'vitest'
import { RETENTION_POLICY, retentionCutoff } from './retention-policy'

describe('retention policy', () => {
  it('keeps one authoritative matrix for product, delivery, jobs, exports and deletion', () => {
    expect(RETENTION_POLICY).toEqual({
      productHistoryDays: 730,
      deliveryEvidenceDays: 90,
      terminalJobsDays: 90,
      exportArtifactDays: 7,
      workspaceDeletionGraceDays: 30,
      publicReportDefaultDays: 90,
    })
  })

  it('computes deterministic cutoffs and rejects invalid durations', () => {
    expect(retentionCutoff(new Date('2026-08-17T00:00:00.000Z'), 7).toISOString())
      .toBe('2026-08-10T00:00:00.000Z')
    expect(() => retentionCutoff(new Date(), 0)).toThrow('positive integer')
  })
})
