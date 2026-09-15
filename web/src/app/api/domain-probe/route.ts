import { answerDomainProbeChallenge, DOMAIN_PROBE_HEADER } from '@/lib/domain-probe-proof'

export const runtime = 'nodejs'

export async function GET(request: Request) {
  const headers = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' }
  try {
    if (process.env.CUSTOM_DOMAINS_ENABLED !== '1' || process.env.MAINTENANCE_MODE === '1') throw new Error('Unavailable')
    const challenge = request.headers.get(DOMAIN_PROBE_HEADER)
    if (!challenge) throw new Error('Missing challenge')
    const url = new URL(request.url)
    // Ignore caller-supplied forwarded-host headers. The TLS request must reach this host.
    if (url.protocol !== 'https:' || (url.port && url.port !== '443')) throw new Error('Invalid origin')
    return Response.json({ proof: answerDomainProbeChallenge(challenge, url.hostname) }, { headers })
  } catch {
    return Response.json({ error: 'Domain verification unavailable.' }, { status: 400, headers })
  }
}
