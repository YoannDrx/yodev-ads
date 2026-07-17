import { describe, expect, it } from 'vitest'
import { formatCustomerId, normalizeCustomerId } from '@/lib/ids'

describe('Google Ads customer IDs', () => {
  it('normalizes a formatted ID', () => expect(normalizeCustomerId('972-304-2391')).toBe('9723042391'))
  it('formats a canonical ID', () => expect(formatCustomerId('4494392373')).toBe('449-439-2373'))
  it.each(['123', 'abcdefghij', '12345678901'])('rejects invalid ID %s', (value) => {
    expect(() => normalizeCustomerId(value)).toThrow('10 digits')
  })
})
