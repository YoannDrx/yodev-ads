import { describe, expect, it } from 'vitest'
import { extractMentions, taskDeadline, taskTiming, transitionTask, workspaceDateEnd } from '@/lib/task-workflow'

describe('task workflow', () => {
  it('enforces explicit non-destructive transitions', () => {
    const now = new Date('2026-08-12T10:00:00Z')
    expect(transitionTask('todo', 'start', now)).toMatchObject({ status: 'in_progress', startedAt: now })
    expect(transitionTask('blocked', 'complete', now)).toMatchObject({ status: 'done', completedAt: now })
    expect(transitionTask('done', 'reopen', now)).toMatchObject({ status: 'todo', completedAt: null })
    expect(() => transitionTask('done', 'start', now)).toThrow('interdite')
  })

  it('computes SLA and workspace end-of-day across DST-aware timezones', () => {
    expect(workspaceDateEnd('2026-08-12', 'Europe/Paris').toISOString()).toBe('2026-08-12T21:59:59.000Z')
    expect(workspaceDateEnd('2026-01-12', 'America/New_York').toISOString()).toBe('2026-01-13T04:59:59.000Z')
    expect(taskDeadline({ now: new Date('2026-08-12T10:00:00Z'), timezone: 'Europe/Paris', slaHours: 4 })).toEqual({ dueAt: new Date('2026-08-12T14:00:00Z'), slaMinutes: 240 })
  })

  it('extracts bounded unique mentions and classifies deadlines', () => {
    expect(extractMentions('Voir @alice et @bob. Puis @alice.')).toEqual(['@alice', '@bob'])
    expect(taskTiming('todo', new Date('2026-08-12T09:00:00Z'), new Date('2026-08-12T10:00:00Z'))).toBe('overdue')
    expect(taskTiming('done', new Date('2026-08-12T09:00:00Z'), new Date('2026-08-12T10:00:00Z'))).toBe('none')
  })

  it.each(['2026-02-29', '2026-02-31', '2026-04-31', '2026-00-12', '2026-13-01', '0000-01-01'])('rejects the impossible calendar date %s', (date) => {
    expect(() => workspaceDateEnd(date, 'Europe/Paris')).toThrow('Date d’échéance invalide')
  })

  it('handles leap years and rejects an entirely skipped local calendar day', () => {
    expect(workspaceDateEnd('2028-02-29', 'Europe/Paris').toISOString()).toBe('2028-02-29T22:59:59.000Z')
    expect(workspaceDateEnd('0099-02-28', 'UTC').toISOString()).toBe('0099-02-28T23:59:59.000Z')
    expect(() => workspaceDateEnd('2011-12-30', 'Pacific/Apia')).toThrow('inexistante')
  })
})
