const baseUrl = process.env.RELEASE_VERIFICATION_BASE_URL ?? process.env.PLAYWRIGHT_BASE_URL
const token = process.env.RELEASE_VERIFICATION_TOKEN

if (!baseUrl) throw new Error('RELEASE_VERIFICATION_BASE_URL or PLAYWRIGHT_BASE_URL is required')
if (!token) throw new Error('RELEASE_VERIFICATION_TOKEN is required')

const endpoint = new URL('/api/internal/sentry-drill', baseUrl)
const response = await fetch(endpoint, {
  method: 'POST',
  headers: { authorization: `Bearer ${token}` },
  redirect: 'error',
  signal: AbortSignal.timeout(55_000),
})
const body = await response.json().catch(() => ({ verified: false, code: 'invalid.response' }))
console.log(JSON.stringify(body, null, 2))

if (response.status !== 200 || body.verified !== true) process.exitCode = 1
