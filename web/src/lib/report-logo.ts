import 'server-only'

import { createHash } from 'node:crypto'
import { isControlledBrandLogoUrl, MAXIMUM_BRAND_LOGO_BYTES } from '@/lib/branding-assets'
import { normalizeBrandLogo } from '@/lib/branding-image'
import type { ReportLogo } from '@/lib/report-branding'
import { workSignal } from '@/lib/work-deadline'

// URLs have random suffixes at upload. Bounded cache avoids fetching the same controlled logo on every dynamic publication.
const cache = new Map<string, { value: ReportLogo | null; expiresAt: number }>()
export async function loadReportLogo(workspaceId: string, value?: string | null): Promise<ReportLogo | null> {
  if (!value || !isControlledBrandLogoUrl(value)) return null
  const url = new URL(value)
  if (!url.pathname.startsWith(`/workspace-branding/${workspaceId}/`) || url.username || url.password || url.port || url.search || url.hash) return null
  const cached = cache.get(value)
  if (cached && cached.expiresAt > Date.now()) return cached.value
  let logo: ReportLogo | null = null
  try {
    const response = await fetch(url, { redirect: 'error', signal: workSignal(5_000), cache: 'no-store' })
    if (!response.ok || !response.body || Number(response.headers.get('content-length')) > MAXIMUM_BRAND_LOGO_BYTES) { await response.body?.cancel(); throw new Error('Logo unavailable') }
    const reader = response.body.getReader(), chunks: Uint8Array[] = []
    let length = 0
    try {
      while (true) {
        const chunk = await reader.read()
        if (chunk.done) break
        length += chunk.value.byteLength
        if (length > MAXIMUM_BRAND_LOGO_BYTES) throw new Error('Logo too large')
        chunks.push(chunk.value)
      }
    } finally { await reader.cancel().catch(() => undefined) }
    const normalized = await normalizeBrandLogo(Buffer.concat(chunks))
    const bytes = Buffer.from(normalized.bytes)
    logo = { contentType: 'image/png', base64: bytes.toString('base64'), sha256: createHash('sha256').update(bytes).digest('hex') }
  } catch { /* A missing decorative logo does not invalidate qualified account history. */ }
  if (cache.size >= 32) cache.delete(cache.keys().next().value!)
  cache.set(value, { value: logo, expiresAt: Date.now() + (logo ? 86_400_000 : 60_000) })
  return logo
}
