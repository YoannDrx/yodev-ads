// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
const mocks = vi.hoisted(() => ({ locale: 'fr' as 'fr' | 'en', publicBeta: false }))
vi.mock('@/lib/locale', () => ({ getLocale: async () => mocks.locale }))
vi.mock('@/lib/feature-flags', () => ({ featureEnabled: () => mocks.publicBeta }))
import Home from '@/app/page'
import { entitlementContext } from '@/lib/entitlements'
import { planCatalog } from '@/lib/billing'

afterEach(cleanup)
for (const locale of ['fr', 'en'] as const) for (const publicBeta of [false, true]) {
  it(`keeps ${locale} entry points consistent with public registration ${publicBeta}`, async () => {
    mocks.locale = locale; mocks.publicBeta = publicBeta
    render(await Home())
    const name = publicBeta ? (locale === 'en' ? 'Start free trial' : 'Démarrer l’essai') : (locale === 'en' ? 'I have an invitation' : 'J’ai une invitation')
    const links = screen.getAllByRole('link', { name })
    expect(links).toHaveLength(6)
    for (const link of links) expect(link).toHaveAttribute('href', '/sign-up')
    if (!publicBeta) expect(screen.queryByRole('link', { name: /Start free trial|Démarrer l’essai/ })).not.toBeInTheDocument()
    expect(screen.getByText(locale === 'en' ? 'Illustrative preview — fictional data' : 'Aperçu illustratif — données fictives')).toBeVisible()
    for (const id of ['solo', 'studio', 'agency'] as const) {
      const catalogue = planCatalog[id], limits = entitlementContext('active', id).limits
      const card = within(screen.getByText(catalogue.name, { exact: true }).closest('article')!)
      expect(card.getByText(`${catalogue.monthlyPrice} €`, { exact: false })).toBeVisible()
      expect(card.getByText(locale === 'en' ? `${limits.monitors} monitors` : `${limits.monitors} vigies`)).toBeVisible()
      expect(card.getByText(locale === 'en' ? `${limits.reports} active reports` : `${limits.reports} rapports actifs`)).toBeVisible()
    }
  })
}
