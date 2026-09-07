import { expect, test } from '@playwright/test'
import { Client } from 'pg'
const workspaceId = '80000000-0000-4000-8000-000000000001'
test.describe.configure({ mode: 'serial' })
if (process.env.PLAYWRIGHT_LOCAL_FIXTURE === '1') for (const locale of ['fr', 'en'] as const) {
  test(`Teams unavailable session has an actionable ${locale} page`, async ({ browser }) => {
    const url = new URL(process.env.DATABASE_SYSTEM_URL!)
    if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || !url.pathname.startsWith('/yodev_test')) throw new Error('Disposable database required')
    const db = new Client({ connectionString: url.href }); await db.connect()
    const original = (await db.query('select locale,plan,access_state from workspaces where id=$1', [workspaceId])).rows[0]
    const context = await browser.newContext({ baseURL: process.env.PLAYWRIGHT_BASE_URL, storageState: process.env.PLAYWRIGHT_ADMIN_STORAGE_STATE, viewport: { width: locale === 'fr' ? 390 : 1440, height: 960 } })
    try {
      await context.addCookies([{ name: 'yodev_cookie_consent', value: 'rejected', url: process.env.PLAYWRIGHT_BASE_URL! }])
      await db.query("update workspaces set locale=$1,plan='agency',access_state='active' where id=$2", [locale, workspaceId])
      const page = await context.newPage(), errors: string[] = []; page.on('pageerror', (error) => errors.push(error.message))
      await page.goto('/settings/teams')
      await expect(page.getByRole('heading', { name: locale === 'fr' ? 'Connexion indisponible' : 'Connection unavailable', exact: true })).toBeVisible()
      await expect(page.locator('p[role="alert"]')).toContainText(locale === 'fr' ? 'Impossible de charger' : 'Teams could not be loaded')
      await page.evaluate(() => document.fonts.ready)
      await page.screenshot({ path: test.info().outputPath(`teams-session-${locale}.png`), fullPage: true })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await page.getByRole('link', { name: locale === 'fr' ? 'Retour aux paramètres' : 'Back to Settings', exact: true }).click()
      await expect(page).toHaveURL(/\/settings$/); expect(errors).toEqual([])
    } finally {
      await context.close(); await db.query('update workspaces set locale=$1,plan=$2,access_state=$3 where id=$4', [original.locale, original.plan, original.access_state, workspaceId]); await db.end()
    }
  })
}
