import { parseLocale } from '@/lib/i18n'

/** Read the explicit UI preference without trusting a callback URL as locale. */
export function authRequestLocale(request?: { headers: Headers }) {
  const cookie = request?.headers.get('cookie')?.split(';').map((value) => value.trim()).find((value) => value.startsWith('yodev_locale='))
  if (!cookie) return 'fr'
  try { return parseLocale(decodeURIComponent(cookie.slice('yodev_locale='.length))) } catch { return 'fr' }
}
