import { describe, expect, it } from 'vitest'
import { authDestination } from './auth-destination'

describe('authentication destination', () => {
  it('preserves the personal security page', () => { expect(authDestination('/account')).toBe('/account') })
  it('preserves only a canonical invitation', () => {
    expect(authDestination('/invitation?id=abc-123_X&callbackURL=https://evil.test#fragment')).toBe('/invitation?id=abc-123_X')
  })
  it('rejects external destinations, ambiguous IDs and encoded control characters', () => {
    for (const value of [undefined, [], 'https://evil.test', '//evil.test', 'javascript:alert(1)', '/dashboard', '/invitation?', '/invitation?id=a&id=b', '/invitation?id=%0a', '/invitation?id=../foo', `/invitation?id=${'a'.repeat(129)}`]) {
      expect(authDestination(value)).toBe('/dashboard')
      expect(authDestination(value, '/onboarding')).toBe('/onboarding')
    }
  })
})
