import 'server-only'

import { cookies } from 'next/headers'
import { parseLocale, type Locale } from '@/lib/i18n'

export const LOCALE_COOKIE = 'yodev_locale'
export const COOKIE_CONSENT_COOKIE = 'yodev_cookie_consent'

export type CookieConsent = 'accepted' | 'rejected' | null

export async function getLocale(): Promise<Locale> {
  return parseLocale((await cookies()).get(LOCALE_COOKIE)?.value)
}

export async function getCookieConsent(): Promise<CookieConsent> {
  const value = (await cookies()).get(COOKIE_CONSENT_COOKIE)?.value
  return value === 'accepted' || value === 'rejected' ? value : null
}

