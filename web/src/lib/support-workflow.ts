export const SUPPORT_CATEGORIES = ['technical', 'billing', 'google_ads', 'feature', 'data_privacy'] as const
export const SUPPORT_PRIORITIES = ['normal', 'high', 'urgent'] as const
export const SUPPORT_STATUSES = ['open', 'awaiting_support', 'awaiting_customer', 'resolved', 'closed'] as const

export type SupportStatus = (typeof SUPPORT_STATUSES)[number]

export function statusAfterSupportMessage(current: SupportStatus, actor: 'customer' | 'support') {
  if (current === 'closed') throw new Error('Un ticket fermé doit être rouvert avant de recevoir un message.')
  return actor === 'customer' ? 'awaiting_support' : 'awaiting_customer'
}

export function supportStatusTransition(current: SupportStatus, next: SupportStatus) {
  const allowed: Record<SupportStatus, ReadonlySet<SupportStatus>> = {
    open: new Set(['awaiting_support', 'awaiting_customer', 'resolved', 'closed']),
    awaiting_support: new Set(['awaiting_customer', 'resolved', 'closed']),
    awaiting_customer: new Set(['awaiting_support', 'resolved', 'closed']),
    resolved: new Set(['open', 'closed']),
    closed: new Set(['open']),
  }
  if (current === next) return next
  if (!allowed[current].has(next)) throw new Error(`Transition support invalide : ${current} → ${next}`)
  return next
}

export function supportLifecycleDates(status: SupportStatus, now = new Date()) {
  return {
    resolvedAt: status === 'resolved' ? now : status === 'open' ? null : undefined,
    closedAt: status === 'closed' ? now : status === 'open' ? null : undefined,
  }
}
