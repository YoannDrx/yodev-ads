import { beforeEach, describe, expect, it, vi } from 'vitest'

const cookieGet = vi.fn()

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ get: cookieGet })),
}))

import { commonMessages, parseLocale, SUPPORTED_LOCALES } from './i18n'
import { COOKIE_CONSENT_COOKIE, getCookieConsent, getLocale, LOCALE_COOKIE } from './locale'

describe('locale and consent preferences', () => {
  beforeEach(() => cookieGet.mockReset())

  it('accepts only supported locales and falls back to French', () => {
    expect(SUPPORTED_LOCALES).toEqual(['fr', 'en'])
    expect(parseLocale('en')).toBe('en')
    expect(parseLocale('fr')).toBe('fr')
    expect(parseLocale('de')).toBe('fr')
    expect(parseLocale(null)).toBe('fr')
    expect(commonMessages.fr.cookiesTitle).toBe('Vos choix de confidentialité')
    expect(commonMessages.en.cookiesTitle).toBe('Your privacy choices')
  })

  it('reads the locale from the server cookie', async () => {
    cookieGet.mockImplementation((name: string) => name === LOCALE_COOKIE ? { value: 'en' } : undefined)
    await expect(getLocale()).resolves.toBe('en')
  })

  it.each([
    ['accepted', 'accepted'],
    ['rejected', 'rejected'],
    ['unexpected', null],
    [undefined, null],
  ] as const)('normalizes consent value %s', async (stored, expected) => {
    cookieGet.mockImplementation((name: string) => name === COOKIE_CONSENT_COOKIE && stored !== undefined
      ? { value: stored }
      : undefined)
    await expect(getCookieConsent()).resolves.toBe(expected)
  })
})
