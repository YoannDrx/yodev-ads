export const TASK_STATUSES = ['todo', 'in_progress', 'blocked', 'done', 'cancelled'] as const
export type TaskStatus = (typeof TASK_STATUSES)[number]
export type TaskOperation = 'start' | 'block' | 'complete' | 'reopen' | 'cancel'

const transitions: Record<TaskOperation, ReadonlySet<TaskStatus>> = {
  start: new Set(['todo', 'blocked']),
  block: new Set(['todo', 'in_progress']),
  complete: new Set(['todo', 'in_progress', 'blocked']),
  reopen: new Set(['done', 'cancelled']),
  cancel: new Set(['todo', 'in_progress', 'blocked']),
}

export function transitionTask(current: string, operation: TaskOperation, now = new Date()) {
  if (!TASK_STATUSES.includes(current as TaskStatus)) throw new Error('État de tâche inconnu.')
  if (!transitions[operation].has(current as TaskStatus)) {
    throw new Error(`Transition de tâche interdite : ${current} → ${operation}.`)
  }
  if (operation === 'start') return { status: 'in_progress' as const, startedAt: now, completedAt: null, cancelledAt: null }
  if (operation === 'block') return { status: 'blocked' as const, completedAt: null, cancelledAt: null }
  if (operation === 'complete') return { status: 'done' as const, completedAt: now, cancelledAt: null }
  if (operation === 'cancel') return { status: 'cancelled' as const, cancelledAt: now, completedAt: null }
  return { status: 'todo' as const, startedAt: null, completedAt: null, cancelledAt: null }
}

function localParts(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(date)
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day), Number(values.hour), Number(values.minute), Number(values.second))
}

export function workspaceDateEnd(date: string, timezone: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Date d’échéance invalide.')
  const [year, month, day] = date.split('-').map(Number)
  const desired = Date.UTC(year, month - 1, day, 23, 59, 59)
  let candidate = new Date(desired)
  for (let iteration = 0; iteration < 3; iteration += 1) {
    candidate = new Date(candidate.getTime() + desired - localParts(candidate, timezone))
  }
  return candidate
}

export function taskDeadline(input: { now: Date; timezone: string; dueDate?: string; slaHours?: number }) {
  if (input.dueDate) return { dueAt: workspaceDateEnd(input.dueDate, input.timezone), slaMinutes: null }
  if (input.slaHours !== undefined) {
    if (!Number.isInteger(input.slaHours) || input.slaHours < 1 || input.slaHours > 24 * 365) throw new Error('SLA invalide.')
    return { dueAt: new Date(input.now.getTime() + input.slaHours * 60 * 60_000), slaMinutes: input.slaHours * 60 }
  }
  return { dueAt: null, slaMinutes: null }
}

export function extractMentions(body: string) {
  const matches = body.match(/@[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*/g) ?? []
  return [...new Set(matches.filter((mention) => mention.length <= 65))].slice(0, 20)
}

export function taskTiming(status: string, dueAt: Date | null, now = new Date()) {
  if (status === 'done' || status === 'cancelled' || !dueAt) return 'none' as const
  if (dueAt <= now) return 'overdue' as const
  if (dueAt.getTime() - now.getTime() <= 24 * 60 * 60_000) return 'due_soon' as const
  return 'on_track' as const
}
