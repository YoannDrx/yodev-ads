import { describe, expect, it } from 'vitest'
import { localScheduleParts } from './job-runner'

describe('localScheduleParts', () => {
  it('honors the workspace timezone around a calendar boundary', () => {
    const instant = new Date('2026-01-04T23:30:00.000Z')
    expect(localScheduleParts(instant, 'Europe/Paris')).toEqual({ date: '2026-01-05', hour: 0, weekday: 'Mon' })
    expect(localScheduleParts(instant, 'America/New_York')).toEqual({ date: '2026-01-04', hour: 18, weekday: 'Sun' })
  })

  it('handles daylight saving time through IANA timezones', () => {
    expect(localScheduleParts(new Date('2026-03-29T05:00:00.000Z'), 'Europe/Paris').hour).toBe(7)
  })
})
