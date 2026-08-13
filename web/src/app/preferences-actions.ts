'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { COOKIE_CONSENT_COOKIE, LOCALE_COOKIE } from '@/lib/locale'

const preferenceCookie = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  maxAge: 365 * 24 * 60 * 60,
}

function safeReturnPath(value: FormDataEntryValue | null) {
  const path = typeof value === 'string' ? value : '/'
  return path.startsWith('/') && !path.startsWith('//') ? path : '/'
}

export async function setLocalePreference(formData: FormData) {
  const locale = z.enum(['fr', 'en']).parse(formData.get('locale'))
  const cookieStore = await cookies()
  cookieStore.set(LOCALE_COOKIE, locale, preferenceCookie)
  redirect(safeReturnPath(formData.get('returnTo')))
}

export async function setCookieConsent(formData: FormData) {
  const consent = z.enum(['accepted', 'rejected']).parse(formData.get('consent'))
  const cookieStore = await cookies()
  cookieStore.set(COOKIE_CONSENT_COOKIE, consent, preferenceCookie)
}

