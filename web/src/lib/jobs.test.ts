import { describe, expect, it } from 'vitest'
import { JOB_BACKOFF_MS, jobRetryDelay } from './jobs'

describe('jobRetryDelay', () => {
  it('uses the durable queue backoff schedule', () => {
    expect([1, 2, 3, 4, 5].map(jobRetryDelay)).toEqual([...JOB_BACKOFF_MS])
  })

  it('caps later attempts at twelve hours', () => {
    expect(jobRetryDelay(20)).toBe(12 * 60 * 60_000)
  })

  it('rejects invalid attempts', () => {
    expect(() => jobRetryDelay(0)).toThrow('positive integer')
    expect(() => jobRetryDelay(1.5)).toThrow('positive integer')
  })
})
