import { z } from 'zod'

/** Adds only a validated record id to an action-owned local destination. */
export function preserveCollectionRecord(target: string, value: unknown) {
  const id = z.string().uuid().safeParse(value)
  return id.success ? `${target}${target.includes('?') ? '&' : '?'}id=${id.data}` : target
}
