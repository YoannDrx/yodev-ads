// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { act } from 'react'
import { renderToString } from 'react-dom/server'
import { hydrateRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { within } from '@testing-library/react'

const mocks = vi.hoisted(() => ({ session: vi.fn(), organizations: vi.fn() }))
vi.mock('@/lib/auth-client', () => ({ authClient: { useSession: mocks.session, useListOrganizations: mocks.organizations } }))
import { AccountMenu } from './account-menu'

let root: Root | undefined
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  mocks.session.mockReturnValue({ data: null, error: null })
  mocks.organizations.mockReturnValue({ data: null, error: null })
})
afterEach(async () => { if (root) await act(() => root?.unmount()); root = undefined; document.body.innerHTML = ''; vi.unstubAllGlobals() })

for (const locale of ['fr', 'en']) for (const cachedError of [false, true]) {
  it(`hydrates ${locale} with auth cache populated before the component (error=${cachedError})`, async () => {
    const container = document.createElement('div'); document.body.append(container)
    container.innerHTML = renderToString(<AccountMenu locale={locale} />)
    expect(container.querySelector('select')).toBeNull()
    mocks.session.mockReturnValue({ data: { user: { email: 'member@example.test' }, session: { activeOrganizationId: 'main' } }, error: null })
    mocks.organizations.mockReturnValue({ data: cachedError ? null : [{ id: 'main', name: 'Main agency' }, { id: 'other', name: 'Other agency' }], error: cachedError ? { message: 'Unavailable' } : null })
    const onRecoverableError = vi.fn()
    await act(async () => { root = hydrateRoot(container, <AccountMenu locale={locale} />, { onRecoverableError }) })
    expect(onRecoverableError).not.toHaveBeenCalled()
    const view = within(container)
    expect(view.getByRole('link', { name: locale === 'en' ? 'Account security' : 'Sécurité du compte' })).toHaveAttribute('title', 'member@example.test')
    if (cachedError) expect(view.getByRole('alert')).toHaveTextContent(locale === 'en' ? 'could not be loaded' : 'n’ont pas pu être chargées')
    else {
      expect(view.getByRole('combobox', { name: locale === 'en' ? 'Active workspace' : 'Workspace actif' })).toHaveValue('main')
      expect(view.getAllByRole('option')).toHaveLength(2)
    }
  })
}
