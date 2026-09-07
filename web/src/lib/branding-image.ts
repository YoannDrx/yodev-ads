import 'server-only'
import sharp from 'sharp'

/** Decode and re-encode a static, bounded PNG; browser MIME and image headers alone are insufficient. */
export async function normalizeBrandLogo(bytes: Uint8Array) {
  try {
    const image = sharp(bytes, { limitInputPixels: 4_194_304, failOn: 'warning', animated: false })
    const metadata = await image.metadata()
    if (!['png', 'jpeg', 'webp'].includes(metadata.format ?? '') || (metadata.pages ?? 1) > 1) throw new Error('Invalid static logo')
    const output = await image.rotate().resize({ width: 512, height: 512, fit: 'inside', withoutEnlargement: true }).png().toBuffer()
    if (output.byteLength > 2 * 1024 * 1024) throw new Error('Normalized logo too large')
    return { bytes: new Uint8Array(output), contentType: 'image/png' as const, extension: 'png' as const }
  } catch {
    throw new Error('Le logo doit être une image PNG, JPEG ou WebP statique et complète, de 4 millions de pixels maximum.')
  }
}
