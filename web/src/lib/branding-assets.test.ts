import { describe, expect, it } from 'vitest'
import { isControlledBrandLogoUrl, MAXIMUM_BRAND_LOGO_BYTES, validatedBrandLogo } from '@/lib/branding-assets'

describe('controlled brand assets', () => {
  it('accepts supported image signatures independently from the browser MIME claim', async () => {
    const png = new File([Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0])], 'logo.txt', { type: 'text/plain' })
    await expect(validatedBrandLogo(png)).resolves.toMatchObject({ contentType: 'image/png', extension: 'png' })
    const webp = new File([new TextEncoder().encode('RIFF0000WEBP')], 'logo.webp')
    await expect(validatedBrandLogo(webp)).resolves.toMatchObject({ contentType: 'image/webp', extension: 'webp' })
  })

  it('rejects unsupported signatures and oversized files', async () => {
    await expect(validatedBrandLogo(new File(['<svg onload=alert(1)>'], 'logo.svg', { type: 'image/svg+xml' }))).rejects.toThrow('PNG, JPEG ou WebP')
    await expect(validatedBrandLogo(new File([new Uint8Array(MAXIMUM_BRAND_LOGO_BYTES + 1)], 'huge.png'))).rejects.toThrow('2 Mo')
  })

  it('only renders URLs issued under the dedicated Vercel Blob prefix', () => {
    expect(isControlledBrandLogoUrl('https://store-123.public.blob.vercel-storage.com/workspace-branding/ws/logo-abcd.png')).toBe(true)
    expect(isControlledBrandLogoUrl('https://evil.example/workspace-branding/ws/logo.png')).toBe(false)
    expect(isControlledBrandLogoUrl('https://store-123.public.blob.vercel-storage.com/other/logo.png')).toBe(false)
    expect(isControlledBrandLogoUrl('/uploads/logo.png')).toBe(false)
  })
})
