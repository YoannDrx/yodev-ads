import 'server-only'

import { AsyncLocalStorage } from 'node:async_hooks'

const manualRetryGeneration = new AsyncLocalStorage<number>()

export function runWithTransactionalEmailRetryGeneration<T>(payload: unknown, operation: () => T) {
  const raw = payload && typeof payload === 'object' && 'manualRetryGeneration' in payload
    ? Number(payload.manualRetryGeneration)
    : 0
  const generation = Number.isInteger(raw) && raw > 0 ? raw : 0
  return manualRetryGeneration.run(generation, operation)
}

export function currentTransactionalEmailRetryGeneration() {
  return manualRetryGeneration.getStore() ?? 0
}
