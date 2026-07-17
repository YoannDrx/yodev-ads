export function normalizeCustomerId(value: string): string {
  const normalized = value.replace(/\D/g, '')
  if (!/^\d{10}$/.test(normalized)) throw new Error('Google Ads customer IDs must contain 10 digits')
  return normalized
}

export function formatCustomerId(value: string): string {
  const normalized = normalizeCustomerId(value)
  return `${normalized.slice(0, 3)}-${normalized.slice(3, 6)}-${normalized.slice(6)}`
}
