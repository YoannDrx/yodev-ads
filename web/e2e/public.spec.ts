import { expect, test } from '@playwright/test'

test('public landing exposes the product proposition and account creation', async ({ page }) => {
  const response = await page.goto('/')
  expect(response?.headers()['content-security-policy']).toMatch(/nonce-[A-Za-z0-9+/=]+/)
  expect(response?.headers()['content-security-policy']).toContain("frame-ancestors 'none'")
  expect(response?.headers()['referrer-policy']).toBe('strict-origin-when-cross-origin')
  expect(response?.headers()['x-content-type-options']).toBe('nosniff')
  expect(response?.headers()['x-powered-by']).toBeUndefined()
  await expect(page.getByRole('heading', { name: /système d’exploitation des agences Google Ads/i })).toBeVisible()
  await expect(page.getByRole('link', { name: /Créer mon espace/i })).toBeVisible()
  await expect(page.getByText(/API Google Ads officielle/i)).toBeVisible()
})

test('authenticated areas redirect anonymous visitors to sign-in', async ({ page }) => {
  // Better Auth session resolution happens server-side at the protected layout.
  await page.goto('/dashboard', { waitUntil: 'commit' })
  await expect.poll(() => page.url()).toMatch(/\/sign-in(?:\?|$)/)
})

test('privacy and terms pages are public', async ({ page }) => {
  await page.goto('/privacy')
  await expect(page.getByRole('heading', { name: 'Politique de confidentialité' })).toBeVisible()
  await page.goto('/terms')
  await expect(page.getByRole('heading', { name: 'Conditions générales de vente et d’utilisation' })).toBeVisible()
})

test('the subprocessor register and change-notice policy are public', async ({ page }) => {
  await page.goto('/subprocessors')
  await expect(page.getByRole('heading', { name: 'Liste des sous-traitants' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Changements et opposition' })).toBeVisible()
  await expect(page.getByText(/au moins 15 jours avant leur prise d’effet/i)).toBeVisible()
})

test('the public product and legal surface honor the English locale', async ({ context, page }) => {
  const baseURL = test.info().project.use.baseURL
  if (typeof baseURL !== 'string') throw new Error('Playwright baseURL is required')
  await context.addCookies([{ name: 'yodev_locale', value: 'en', url: new URL('/', baseURL).toString() }])
  await page.goto('/')
  await expect(page.getByRole('heading', { name: /operating system for Google Ads agencies/i })).toBeVisible()
  await expect(page.getByRole('link', { name: /Create my workspace/i })).toBeVisible()
  await page.goto('/privacy')
  await expect(page.getByRole('heading', { name: 'Privacy policy' })).toBeVisible()
})

test('public status page never claims operational health when status storage is unavailable', async ({ page }) => {
  await page.goto('/status')
  await expect(page.getByText('État du service')).toBeVisible()
  const unavailable = page.getByRole('heading', { name: 'Statut temporairement indisponible' })
  await expect(page.locator('h1')).toBeVisible()
  if (await unavailable.isVisible()) {
    await expect(page.getByText(/ne signifie pas que l’application est opérationnelle/i)).toBeVisible()
  }
})
