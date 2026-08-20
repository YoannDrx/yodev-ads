export const RETENTION_POLICY = {
  productHistoryDays: 730,
  deliveryEvidenceDays: 90,
  terminalJobsDays: 90,
  exportArtifactDays: 7,
  workspaceDeletionGraceDays: 30,
  publicReportDefaultDays: 90,
} as const

export function retentionCutoff(now: Date, days: number) {
  if (!Number.isInteger(days) || days < 1) throw new Error('Retention days must be a positive integer')
  return new Date(now.getTime() - days * 24 * 60 * 60_000)
}
