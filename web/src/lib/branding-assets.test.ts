import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { isControlledBrandLogoUrl, MAXIMUM_BRAND_LOGO_BYTES, validatedBrandLogo } from '@/lib/branding-assets'

describe('controlled brand assets', () => {
  it.each(['png', 'jpeg', 'webp'] as const)('decodes a real %s image and normalizes its bytes independently from the MIME claim', async (format) => {
    const bytes = await sharp({ create: { width: 20, height: 10, channels: 3, background: '#176646' } }).toFormat(format).toBuffer()
    const result = await validatedBrandLogo(new File([new Uint8Array(bytes)], 'logo.txt', { type: 'text/plain' }))
    expect(result).toMatchObject({ contentType: 'image/png', extension: 'png' })
    expect(await sharp(result.bytes).metadata()).toMatchObject({ width: 20, height: 10, format: 'png' })
  })

  it('rejects truncated images with an apparently valid magic signature', async () => {
    const file = new File([Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0])], 'logo.png')
    await expect(validatedBrandLogo(file)).rejects.toThrow('complète')
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
