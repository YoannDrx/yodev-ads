export type ActivationWorkspace = { id: string; createdAt: Date }
export type ActivationEvent = { workspaceId: string; milestone: string; occurredAt: Date }

function mondayUtc(date: Date) {
  const value = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  const weekday = value.getUTCDay() || 7
  value.setUTCDate(value.getUTCDate() - weekday + 1)
  return value
}

function median(values: number[]) {
  if (values.length === 0) return null
  const sorted = values.toSorted((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle]
}

export function activationCohorts(
  workspaces: ActivationWorkspace[],
  events: ActivationEvent[],
  now = new Date(),
  weekCount = 12,
) {
  if (!Number.isInteger(weekCount) || weekCount < 1 || weekCount > 52) throw new Error('Invalid activation cohort range')
  const latestWeek = mondayUtc(now)
  const firstWeek = new Date(latestWeek.getTime() - (weekCount - 1) * 7 * 24 * 60 * 60_000)
  const eventsByWorkspace = new Map<string, Map<string, Date>>()
  for (const event of events) {
    const milestones = eventsByWorkspace.get(event.workspaceId) ?? new Map<string, Date>()
    const existing = milestones.get(event.milestone)
    if (!existing || event.occurredAt < existing) milestones.set(event.milestone, event.occurredAt)
    eventsByWorkspace.set(event.workspaceId, milestones)
  }
  const cohorts = Array.from({ length: weekCount }, (_, index) => {
    const weekStart = new Date(firstWeek.getTime() + index * 7 * 24 * 60 * 60_000)
    return {
      weekStart: weekStart.toISOString().slice(0, 10),
      workspaces: 0,
      googleConnected: 0,
      firstReport: 0,
      paid: 0,
    }
  })
  const reportDurations: number[] = []
  const paidDurations: number[] = []
  for (const workspace of workspaces) {
    const week = mondayUtc(workspace.createdAt)
    const index = Math.floor((week.getTime() - firstWeek.getTime()) / (7 * 24 * 60 * 60_000))
    if (index < 0 || index >= cohorts.length) continue
    const cohort = cohorts[index]
    cohort.workspaces += 1
    const milestones = eventsByWorkspace.get(workspace.id)
    if (milestones?.has('google_connected')) cohort.googleConnected += 1
    const reportAt = milestones?.get('first_report')
    if (reportAt) {
      cohort.firstReport += 1
      if (reportAt >= workspace.createdAt) reportDurations.push((reportAt.getTime() - workspace.createdAt.getTime()) / 86_400_000)
    }
    const paidAt = milestones?.get('paid_conversion')
    if (paidAt) {
      cohort.paid += 1
      if (paidAt >= workspace.createdAt) paidDurations.push((paidAt.getTime() - workspace.createdAt.getTime()) / 86_400_000)
    }
  }
  return {
    cohorts,
    medianDaysToFirstReport: median(reportDurations),
    medianDaysToPaid: median(paidDurations),
  }
}
