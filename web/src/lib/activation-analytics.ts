import { ACTIVATION_STAGES, type ActivationStageField } from '@/lib/activation-stages'

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
  if (!Number.isFinite(now.getTime())) throw new Error('Invalid activation reference date')
  const latestWeek = mondayUtc(now)
  const firstWeek = new Date(latestWeek.getTime() - (weekCount - 1) * 7 * 24 * 60 * 60_000)
  const eventsByWorkspace = new Map<string, Map<string, Date>>()
  const createdByWorkspace = new Map(workspaces.map((workspace) => [workspace.id, workspace.createdAt]))
  for (const event of events) {
    const createdAt = createdByWorkspace.get(event.workspaceId)
    if (!createdAt || !Number.isFinite(createdAt.getTime()) || !Number.isFinite(event.occurredAt.getTime()) || event.occurredAt > now || event.occurredAt < createdAt) continue
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
      ...Object.fromEntries(ACTIVATION_STAGES.map(({ field }) => [field, 0])) as Record<ActivationStageField, number>,
    }
  })
  const durations = Object.fromEntries(ACTIVATION_STAGES.map(({ field }) => [field, [] as number[]])) as Record<ActivationStageField, number[]>
  for (const workspace of workspaces) {
    if (!Number.isFinite(workspace.createdAt.getTime()) || workspace.createdAt > now) continue
    const week = mondayUtc(workspace.createdAt)
    const index = Math.floor((week.getTime() - firstWeek.getTime()) / (7 * 24 * 60 * 60_000))
    if (index < 0 || index >= cohorts.length) continue
    const cohort = cohorts[index]
    cohort.workspaces += 1
    const milestones = eventsByWorkspace.get(workspace.id)
    for (const { milestone, field } of ACTIVATION_STAGES) {
      const occurredAt = milestones?.get(milestone)
      if (!occurredAt) continue
      cohort[field] += 1
      durations[field].push((occurredAt.getTime() - workspace.createdAt.getTime()) / 86_400_000)
    }
  }
  return {
    cohorts,
    asOf: now.toISOString(),
    medianDaysByStage: Object.fromEntries(ACTIVATION_STAGES.map(({ field }) => [field, median(durations[field])])) as Record<ActivationStageField, number | null>,
    medianDaysToFirstReport: median(durations.firstReport),
    medianDaysToPaid: median(durations.paid),
  }
}
