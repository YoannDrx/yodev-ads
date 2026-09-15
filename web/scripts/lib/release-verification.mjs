const targets = new Set(['staging', 'private_beta', 'public'])

export function releaseVerificationContext(env = process.env) {
  const target = env.RELEASE_TARGET
  const expectedSha = env.RELEASE_VERIFICATION_EXPECTED_SHA
  const rawBaseUrl = env.RELEASE_VERIFICATION_BASE_URL ?? env.PLAYWRIGHT_BASE_URL
  const allowedOrigin = env.RELEASE_VERIFICATION_ALLOWED_ORIGIN
  const token = env.RELEASE_VERIFICATION_TOKEN
  if (!targets.has(target)) throw new Error('RELEASE_TARGET must be staging, private_beta or public')
  if (!/^[a-f0-9]{40}$/i.test(expectedSha ?? '')) throw new Error('RELEASE_VERIFICATION_EXPECTED_SHA must identify the exact candidate commit')
  if (!rawBaseUrl || !allowedOrigin || !token) throw new Error('Release verification requires a base URL, an independently configured allowed origin and a token')
  const baseUrl = new URL(rawBaseUrl)
  const trusted = new URL(allowedOrigin)
  if (baseUrl.protocol !== 'https:' || baseUrl.username || baseUrl.password || baseUrl.pathname !== '/' || baseUrl.search || baseUrl.hash ||
    trusted.protocol !== 'https:' || trusted.username || trusted.password || trusted.pathname !== '/' || trusted.search || trusted.hash ||
    baseUrl.origin !== trusted.origin) throw new Error('The release URL must match the trusted HTTPS origin for this environment')
  return { target, expectedSha: expectedSha.toLowerCase(), baseUrl: baseUrl.origin, token }
}

export function verifyReleaseIdentity(body, context, now = new Date()) {
  if (body.target !== context.target) throw new Error('The deployment target does not match the requested release target')
  if (typeof body.release !== 'string' || body.release.toLowerCase() !== context.expectedSha) throw new Error('The deployment SHA does not match the candidate commit')
  const checkedAt = new Date(body.checkedAt).getTime()
  if (!Number.isFinite(checkedAt) || checkedAt > now.getTime() + 60_000 || checkedAt < now.getTime() - 10 * 60_000) throw new Error('The release evidence is missing, stale or dated in the future')
}

export async function fetchReleaseEvidence(path, options = {}, dependencies = {}) {
  const context = releaseVerificationContext(dependencies.env ?? process.env)
  const request = dependencies.fetch ?? fetch
  const endpoint = new URL(path, context.baseUrl)
  if (endpoint.origin !== context.baseUrl || endpoint.username || endpoint.password) throw new Error('A verification endpoint cannot leave the trusted origin')
  const response = await request(endpoint, {
    method: options.method ?? 'GET',
    headers: { authorization: `Bearer ${context.token}`, 'x-expected-release-sha': context.expectedSha, 'x-expected-release-target': context.target },
    redirect: 'error', signal: AbortSignal.timeout(options.timeoutMs ?? 15_000),
  })
  const body = await response.json()
  if (!response.ok) {
    const codes = [body?.code, ...(Array.isArray(body?.issues) ? body.issues.map((issue) => issue?.code) : [])]
      .filter((code) => typeof code === 'string' && /^[a-zA-Z0-9_.]{1,100}$/.test(code)).slice(0, 50)
    throw new Error(`Release verification failed with HTTP ${response.status}${codes.length ? ` (${codes.join(', ')})` : ''}`)
  }
  verifyReleaseIdentity(body, context, dependencies.now ?? new Date())
  return { body, context }
}
