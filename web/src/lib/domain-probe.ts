import 'server-only'

import { request as httpsRequest } from 'node:https'
import { assertSafeWebhookUrl, pinnedPublicLookup, withinSignal } from '@/lib/webhook-security'
import { workSignal } from '@/lib/work-deadline'
import { createDomainProbeChallenge, DOMAIN_PROBE_HEADER, DOMAIN_PROBE_PATH } from '@/lib/domain-probe-proof'

export async function probeApplicationDomain(hostname: string, beforeRequest?: () => Promise<void>) {
  try {
    const signal = workSignal(8_000)
    const { challenge, expectedProof } = createDomainProbeChallenge(hostname)
    const validated = await assertSafeWebhookUrl(`https://${hostname}${DOMAIN_PROBE_PATH}`, signal)
    if (beforeRequest) await withinSignal(beforeRequest(), signal)
    signal.throwIfAborted()
    return await new Promise<boolean>((resolve) => {
      let settled = false
      const finish = (success: boolean) => { if (!settled) { settled = true; resolve(success) } }
      const request = httpsRequest(validated.url, {
        method: 'GET', agent: false, rejectUnauthorized: true, servername: validated.url.hostname,
        lookup: pinnedPublicLookup(validated.addresses), signal, timeout: 8_000,
        maxHeaderSize: 8192, headers: { [DOMAIN_PROBE_HEADER]: challenge, Accept: 'application/json', 'Cache-Control': 'no-store' },
      }, (response) => {
        const chunks: Buffer[] = []; let bytes = 0
        response.on('error', () => finish(false))
        response.on('aborted', () => finish(false))
        if (response.statusCode !== 200 || !/^application\/json(?:;|$)/i.test(response.headers['content-type'] ?? '')) {
          finish(false); response.destroy(); return
        }
        response.on('data', (chunk: Buffer) => {
          bytes += chunk.length
          if (bytes > 4096) { finish(false); response.destroy(); return }
          chunks.push(chunk)
        })
        response.on('end', () => {
          try { finish(!signal.aborted && JSON.parse(Buffer.concat(chunks).toString('utf8')).proof === expectedProof) }
          catch { finish(false) }
        })
      })
      request.on('error', () => finish(false))
      request.on('timeout', () => { finish(false); request.destroy() })
      request.end()
    })
  } catch { return false }
}
