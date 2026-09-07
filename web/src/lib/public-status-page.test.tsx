import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
const mocks = vi.hoisted(() => ({ locale: 'fr', status: vi.fn() }))
vi.mock('@/lib/locale', () => ({ getLocale: async () => mocks.locale }))
vi.mock('@/lib/public-status', () => ({ getPublicPlatformStatus: mocks.status }))
import StatusPage from '@/app/status/page'

describe('public status unavailable rendering', () => {
  it.each(['fr', 'en'])('does not claim verified or operational health after a database failure in %s', async (locale) => {
    mocks.locale = locale
    mocks.status.mockRejectedValueOnce(new Error('Database unavailable'))
    const html = renderToStaticMarkup(await StatusPage({ searchParams: Promise.resolve({}) }))
    expect(html).toContain(locale === 'fr' ? 'Statut temporairement indisponible' : 'Status temporarily unavailable')
    expect(html).toContain(locale === 'fr' ? 'Le registre des incidents ne peut pas être interrogé.' : 'The incident registry could not be queried.')
    expect(html).not.toMatch(/>Opérationnel<|>Operational<|bg-emerald/)
  })
})
