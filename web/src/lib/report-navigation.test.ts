import { describe, expect, it } from 'vitest'
import { preserveReportEdition } from './report-navigation'
const edition = '75000000-0000-4000-8000-000000000001'
describe('public report feedback navigation', () => {
  it.each(['', '?otp=1&notice=Code%20sent', '?error=Invalid&otp=1', '?notice=Feedback%20sent'])('keeps the edition through %s', (query) => {
    const url = new URL(preserveReportEdition(`/r/token${query}`, edition), 'https://ads.example.test')
    expect(url.pathname).toBe('/r/token')
    expect(url.searchParams.get('edition')).toBe(edition)
    for (const [key, value] of new URLSearchParams(query)) expect(url.searchParams.get(key)).toBe(value)
  })
  it.each([null, undefined, '', '//evil.test', `${edition}&redirect=https://evil.test`, new Blob(['edition'])])('discards invalid navigation state %s', (invalid) => {
    expect(preserveReportEdition('/r/token?error=Invalid', invalid)).toBe('/r/token?error=Invalid')
  })
})
