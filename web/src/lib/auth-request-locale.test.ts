import { expect, it } from 'vitest'
import { authRequestLocale } from './auth-request-locale'

it('uses the exact locale cookie, including URL encoding', () => {
  expect(authRequestLocale(new Request('https://example.test',{headers:{cookie:'other=en; yodev_locale=%65n; session=opaque'}}))).toBe('en')
  expect(authRequestLocale(new Request('https://example.test',{headers:{cookie:'not_yodev_locale=en; yodev_locale=fr'}}))).toBe('fr')
})
it('falls back safely for missing, malformed and unsupported preferences', () => {
  for(const cookie of ['', 'yodev_locale=%ZZ', 'yodev_locale=de']) expect(authRequestLocale(new Request('https://example.test',{headers:{cookie}}))).toBe('fr')
  expect(authRequestLocale()).toBe('fr')
})
