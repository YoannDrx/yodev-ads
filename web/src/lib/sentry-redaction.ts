const sensitiveKey = /(?:authorization|cookie|password|secret|token|api.?key|refresh|developer|destination|email|ip(?:address)?|requestfingerprint)/i
const bearerToken = /Bearer\s+[A-Za-z0-9._~+/=-]+/gi
const apiToken = /\bya_live_[A-Za-z0-9_-]+\b/g
const reportPathToken = /(\/r\/)[A-Za-z0-9_-]{20,}/g

function redactString(value: string) {
  const tokenRedacted = value
    .replace(bearerToken, 'Bearer [REDACTED]')
    .replace(apiToken, '[REDACTED_API_KEY]')
    .replace(reportPathToken, '$1[REDACTED]')
  try {
    const url = new URL(tokenRedacted)
    for (const key of [...url.searchParams.keys()]) url.searchParams.set(key, '[REDACTED]')
    return url.toString()
  } catch {
    return tokenRedacted
  }
}

export function redactSensitiveData(value: unknown, key = '', seen = new WeakSet<object>()): unknown {
  if (sensitiveKey.test(key)) return '[REDACTED]'
  if (typeof value === 'string') return redactString(value)
  if (!value || typeof value !== 'object') return value
  if (seen.has(value)) return '[CIRCULAR]'
  seen.add(value)
  if (Array.isArray(value)) return value.map((item) => redactSensitiveData(item, key, seen))
  return Object.fromEntries(
    Object.entries(value).map(([entryKey, entryValue]) => [entryKey, redactSensitiveData(entryValue, entryKey, seen)]),
  )
}

export function redactSentryEvent<T extends object>(event: T): T {
  const redacted = redactSensitiveData(event) as T
  if ('user' in redacted) delete (redacted as T & { user?: unknown }).user
  return redacted
}
