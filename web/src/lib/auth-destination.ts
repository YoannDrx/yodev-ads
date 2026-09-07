/** Carry only known personal or invitation routes; never redirect to arbitrary input. */
export function authDestination(value: unknown, fallback: '/dashboard' | '/onboarding' = '/dashboard') {
  if (value === '/account') return '/account'
  if (typeof value !== 'string' || !value.startsWith('/invitation?')) return fallback
  const url = new URL(value, 'https://auth.invalid')
  const ids = url.searchParams.getAll('id')
  if (url.pathname !== '/invitation' || ids.length !== 1 || !/^[a-zA-Z0-9_-]{1,128}$/.test(ids[0])) return fallback
  return `/invitation?id=${encodeURIComponent(ids[0])}`
}
