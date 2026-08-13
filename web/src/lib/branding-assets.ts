export const MAXIMUM_BRAND_LOGO_BYTES = 2 * 1024 * 1024

const formats = [
  { contentType: 'image/png', extension: 'png', matches: (bytes: Uint8Array) => bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value) },
  { contentType: 'image/jpeg', extension: 'jpg', matches: (bytes: Uint8Array) => bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff },
  { contentType: 'image/webp', extension: 'webp', matches: (bytes: Uint8Array) => bytes.length >= 12 && new TextDecoder().decode(bytes.slice(0, 4)) === 'RIFF' && new TextDecoder().decode(bytes.slice(8, 12)) === 'WEBP' },
] as const

export async function validatedBrandLogo(file: File) {
  if (file.size < 1 || file.size > MAXIMUM_BRAND_LOGO_BYTES) throw new Error('Le logo doit peser moins de 2 Mo.')
  const bytes = new Uint8Array(await file.arrayBuffer())
  const format = formats.find((candidate) => candidate.matches(bytes))
  if (!format) throw new Error('Le logo doit être un fichier PNG, JPEG ou WebP valide.')
  return { bytes, contentType: format.contentType, extension: format.extension }
}

export function isControlledBrandLogoUrl(value: string | null | undefined) {
  if (!value) return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:' &&
      /^[a-z0-9-]+\.public\.blob\.vercel-storage\.com$/i.test(url.hostname) &&
      url.pathname.startsWith('/workspace-branding/')
  } catch {
    return false
  }
}
