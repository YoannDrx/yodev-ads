import { z } from 'zod'

/** target is built by the action; the edition is only navigation state, never authorization. */
export function preserveReportEdition(target: string, edition: unknown) {
  const parsed = z.string().uuid().safeParse(edition)
  if (!parsed.success) return target
  return `${target}${target.includes('?') ? '&' : '?'}edition=${encodeURIComponent(parsed.data)}`
}
