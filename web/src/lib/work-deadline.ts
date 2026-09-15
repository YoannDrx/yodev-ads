import 'server-only'

import { AsyncLocalStorage } from 'node:async_hooks'
import { setTimeout as pause } from 'node:timers/promises'

const workDeadline = new AsyncLocalStorage<number>()

export function hasWorkDeadline() { return workDeadline.getStore() !== undefined }

export class WorkDeadlineError extends Error {
  constructor() {
    super('Work deadline reached; remaining work must be resumed by the queue.')
    this.name = 'WorkDeadlineError'
  }
}

export function withWorkDeadline<T>(deadlineAt: number, operation: () => Promise<T>) {
  return workDeadline.run(Math.min(deadlineAt, workDeadline.getStore() ?? Infinity), operation)
}

export function remainingWorkMs(maximumMs: number) {
  const remaining = Math.min(maximumMs, (workDeadline.getStore() ?? Infinity) - Date.now())
  if (remaining <= 0) throw new WorkDeadlineError()
  return Math.ceil(remaining)
}

export function workSignal(maximumMs: number, signal?: AbortSignal | null) {
  const deadline = AbortSignal.timeout(remainingWorkMs(maximumMs))
  return signal ? AbortSignal.any([signal, deadline]) : deadline
}

export async function pauseWithinWorkDeadline(milliseconds: number) {
  // Leave room for another attempt; never wait beyond the worker's deadline.
  if (remainingWorkMs(milliseconds + 1) <= milliseconds) throw new WorkDeadlineError()
  await pause(milliseconds)
}
