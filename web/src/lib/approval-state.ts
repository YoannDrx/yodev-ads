import { createHash } from 'node:crypto'

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonicalValue(nested)]),
    )
  }
  return value
}

export function stateHash(state: Record<string, unknown>) {
  return createHash('sha256').update(JSON.stringify(canonicalValue(state))).digest('hex')
}
