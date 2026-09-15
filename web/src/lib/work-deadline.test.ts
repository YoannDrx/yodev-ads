import { afterEach, describe, expect, it, vi } from 'vitest'
import { hasWorkDeadline, pauseWithinWorkDeadline, remainingWorkMs, withWorkDeadline, workSignal } from './work-deadline'

afterEach(() => vi.useRealTimers())

describe('worker deadlines', () => {
  it('caps requests by the remaining runtime and refuses work after expiry', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000)
    await withWorkDeadline(1_500, async () => {
      expect(hasWorkDeadline()).toBe(true)
      expect(remainingWorkMs(25_000)).toBe(500)
      vi.setSystemTime(1_500)
      expect(() => workSignal(25_000)).toThrow('deadline reached')
    })
    expect(remainingWorkMs(25_000)).toBe(25_000)
    expect(hasWorkDeadline()).toBe(false)
  })
  it('never extends a parent deadline or leaks between concurrent runs', async () => {
    const now = Date.now()
    await withWorkDeadline(now + 500, () => withWorkDeadline(now + 5_000, async () => {
      expect(remainingWorkMs(5_000)).toBeLessThanOrEqual(500)
    }))
    const values = await Promise.all([100, 1_000].map((ms) => withWorkDeadline(now + ms, async () => remainingWorkMs(5_000))))
    expect(values[0]).toBeLessThanOrEqual(100)
    expect(values[1]).toBeGreaterThan(100)
  })
  it('preserves caller cancellation and refuses retries with insufficient time', async () => {
    const controller = new AbortController()
    const signal = workSignal(1_000, controller.signal)
    controller.abort()
    expect(signal.aborted).toBe(true)
    await expect(withWorkDeadline(Date.now() + 50, () => pauseWithinWorkDeadline(100))).rejects.toThrow('deadline reached')
    await expect(pauseWithinWorkDeadline(1)).resolves.toBeUndefined()
  })
})
