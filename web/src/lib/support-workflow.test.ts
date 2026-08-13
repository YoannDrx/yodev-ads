import { describe, expect, it } from 'vitest'
import { statusAfterSupportMessage, supportLifecycleDates, supportStatusTransition } from '@/lib/support-workflow'

describe('support workflow', () => {
  it('routes replies to the opposite party', () => {
    expect(statusAfterSupportMessage('open', 'customer')).toBe('awaiting_support')
    expect(statusAfterSupportMessage('awaiting_support', 'support')).toBe('awaiting_customer')
    expect(() => statusAfterSupportMessage('closed', 'customer')).toThrow(/rouvert/)
  })

  it('enforces explicit reopen transitions', () => {
    expect(supportStatusTransition('resolved', 'open')).toBe('open')
    expect(supportStatusTransition('closed', 'open')).toBe('open')
    expect(() => supportStatusTransition('closed', 'resolved')).toThrow(/invalide/)
  })

  it('records and clears terminal timestamps', () => {
    const now = new Date('2026-08-12T10:00:00.000Z')
    expect(supportLifecycleDates('resolved', now).resolvedAt).toEqual(now)
    expect(supportLifecycleDates('closed', now).closedAt).toEqual(now)
    expect(supportLifecycleDates('open', now)).toEqual({ resolvedAt: null, closedAt: null })
  })
})
