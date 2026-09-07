import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import sharp from 'sharp'
import { createHash } from 'node:crypto'
import { loadReportLogo } from './report-logo'
import { MAXIMUM_BRAND_LOGO_BYTES } from './branding-assets'
const workspaceId = '00000000-0000-4000-8000-000000000001'
const base = `https://store.public.blob.vercel-storage.com/workspace-branding/${workspaceId}`
describe('controlled report logo snapshots', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn()))
  afterEach(() => vi.unstubAllGlobals())
  it.each([undefined, 'https://evil.example/logo.png', `${base.replace(workspaceId, 'other')}/logo.png`, `${base}/logo.png?redirect=1`, `https://user:password@store.public.blob.vercel-storage.com/workspace-branding/${workspaceId}/logo.png`])('does not fetch an uncontrolled or out-of-scope URL %s', async (url) => {
    await expect(loadReportLogo(workspaceId, url)).resolves.toBeNull()
    expect(fetch).not.toHaveBeenCalled()
  })
  it('freezes normalized PNG bytes with a hash and reuses the bounded asset cache', async () => {
    const original = await sharp({ create: { width: 900, height: 300, channels: 3, background: '#123456' } }).webp().toBuffer()
    vi.mocked(fetch).mockResolvedValue(new Response(original, { status: 200 }))
    const logo = await loadReportLogo(workspaceId, `${base}/valid.webp`)
    expect(logo?.contentType).toBe('image/png')
    const bytes = Buffer.from(logo!.base64, 'base64')
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(logo?.sha256)
    expect(await sharp(bytes).metadata()).toMatchObject({ format: 'png', width: 512, height: 171 })
    expect(fetch).toHaveBeenCalledWith(expect.any(URL), expect.objectContaining({ redirect: 'error', signal: expect.any(AbortSignal), cache: 'no-store' }))
    expect(await loadReportLogo(workspaceId, `${base}/valid.webp`)).toEqual(logo)
    expect(fetch).toHaveBeenCalledOnce()
  })
  it.each(['status', 'declared-size', 'stream-size', 'corrupt', 'network'])('falls back without fetching arbitrary replacements on %s failure', async (kind) => {
    if (kind === 'network') vi.mocked(fetch).mockRejectedValue(new Error('offline'))
    else vi.mocked(fetch).mockResolvedValue(kind === 'status' ? new Response('', { status: 404 }) : kind === 'declared-size' ? new Response('', { headers: { 'content-length': String(MAXIMUM_BRAND_LOGO_BYTES + 1) } }) : kind === 'stream-size' ? new Response(new Uint8Array(MAXIMUM_BRAND_LOGO_BYTES + 1)) : new Response('<svg onload="alert(1)"/>'))
    await expect(loadReportLogo(workspaceId, `${base}/${kind}.png`)).resolves.toBeNull()
    expect(fetch).toHaveBeenCalledOnce()
  })
})
