import { expect, test } from '@playwright/test'

test('public landing exposes the product proposition and account creation', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: /système d’exploitation des agences Google Ads/i })).toBeVisible()
  await expect(page.getByRole('link', { name: /Créer mon espace/i })).toBeVisible()
  await expect(page.getByText(/API Google Ads officielle/i)).toBeVisible()
})

test('authenticated areas redirect anonymous visitors to sign-in', async ({ page }) => {
  await page.goto('/dashboard')
  await expect(page).toHaveURL(/\/sign-in\?redirect_url=/)
})

test('privacy and terms pages are public', async ({ page }) => {
  await page.goto('/privacy')
  await expect(page.getByRole('heading', { name: 'Politique de confidentialité' })).toBeVisible()
  await page.goto('/terms')
  await expect(page.getByRole('heading', { name: 'Conditions d’utilisation' })).toBeVisible()
})
