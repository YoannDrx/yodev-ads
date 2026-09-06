import { expect, test, type Browser } from '@playwright/test'
import { Client } from 'pg'

// State-changing checks only run against the disposable local fixture.
if (process.env.PLAYWRIGHT_LOCAL_FIXTURE === '1') {
  const connectionString = process.env.DATABASE_SYSTEM_URL!
  const url = new URL(connectionString)
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || !url.pathname.startsWith('/yodev_test')) throw new Error('Local disposable browser database required')
  const workspaceId = '80000000-0000-4000-8000-000000000001'
  const db = new Client({ connectionString })
  async function pageFor(browser: Browser, role: string, width = 1280) {
    const context = await browser.newContext({ baseURL: process.env.PLAYWRIGHT_BASE_URL, storageState: process.env[`PLAYWRIGHT_${role.toUpperCase()}_STORAGE_STATE`], viewport: { width, height: 844 } })
    return { context, page: await context.newPage() }
  }
  test.describe.serial('local production readiness regression journeys', () => {
    test.setTimeout(120_000)
    test.beforeAll(async () => { await db.connect() })
    test.afterAll(async () => {
      await db.query('update workspaces set access_state=$1, locale=$2 where id=$3', ['internal', 'fr', workspaceId])
      await db.end()
    })
    test('grace permits stored views while hiding mutations', async ({ browser }) => {
      await db.query('update workspaces set access_state=$1 where id=$2', ['grace', workspaceId])
      for (const role of ['owner', 'analyst']) {
        const { page, context } = await pageFor(browser, role)
        try {
          for (const path of ['/accounts', '/history', '/alerts', '/tasks', '/approvals', '/reports']) {
            expect((await page.goto(path))?.status()).toBe(200)
            await expect(page).toHaveURL(new RegExp(`${path}$`))
            await expect(page.locator('main')).toBeVisible()
            await expect(page.getByRole('button', { name: /Générer le lien|Analyser maintenant|Créer une tâche|Approuver/ })).toHaveCount(0)
          }
          if (role === 'owner') expect((await page.goto('/audit'))?.status()).toBe(200)
        } finally { await context.close() }
      }
    })
    test('suspended members have an accessible recovery destination without redirect loops', async ({ browser }) => {
      await db.query('update workspaces set access_state=$1 where id=$2', ['suspended', workspaceId])
      for (const role of ['owner', 'admin', 'client']) {
        const { page, context } = await pageFor(browser, role)
        try {
          expect((await page.goto('/dashboard'))?.status()).toBe(200)
          await expect(page).toHaveURL(role === 'owner' ? /\/billing\?/ : /\/support\?/)
          await expect(page.locator('main')).toBeVisible()
        } finally { await context.close() }
      }
    })
    for (const locale of ['fr', 'en']) for (const width of [390, 768]) {
      test(`full navigation and workspace selection work at ${width}px in ${locale}`, async ({ browser }) => {
        await db.query('update workspaces set access_state=$1, locale=$2 where id=$3', ['internal', locale, workspaceId])
        const { page, context } = await pageFor(browser, 'owner', width)
        try {
          await page.goto('/dashboard')
          const consent = page.getByRole('button', { name: /Continuer sans mesure|Continue without/ })
          if (await consent.isVisible()) await consent.click()
          await expect(page.getByRole('combobox', { name: /Workspace actif|Active workspace/ })).toBeVisible()
          const menu = page.locator('summary').filter({ hasText: /^Menu$/ })
          await menu.click()
          const navigation = page.getByRole('navigation', { name: /Navigation complète|Full navigation/ })
          await expect(navigation).toBeVisible()
          for (const href of ['/accounts', '/insights', '/history', '/tasks', '/agents', '/reports', '/support', '/audit', '/settings']) await expect(navigation.locator(`a[href="${href}"]`)).toBeVisible()
          await page.screenshot({ path: test.info().outputPath(`menu-${locale}-${width}.png`) })
          await menu.press('Escape')
          await expect(navigation).not.toBeVisible()
          await expect(menu).toBeFocused()
          await menu.press('Enter')
          await navigation.locator('a[href="/settings"]').click()
          await expect(page).toHaveURL(/\/settings$/, { timeout: 15_000 })
          await expect(navigation).not.toBeVisible()
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
        } finally { await context.close() }
      })
    }
    test('workspace selection switches context and permissions on mobile', async ({ browser }) => {
      await db.query('update workspaces set access_state=$1, locale=$2 where id=$3', ['internal', 'fr', workspaceId])
      const { page, context } = await pageFor(browser, 'owner', 390)
      try {
        await page.goto('/dashboard')
        const consent = page.getByRole('button', { name: /Continuer sans mesure|Continue without/ })
        if (await consent.isVisible()) await consent.click()
        const selector = page.getByRole('combobox', { name: /Workspace actif|Active workspace/ })
        await selector.selectOption('local-browser-fixture-foreign')
        await expect(page).toHaveURL(/\/support/)
        await expect(selector).toHaveValue('local-browser-fixture-foreign')
        await page.locator('summary').filter({ hasText: /^Menu$/ }).click()
        await expect(page.getByRole('navigation', { name: /Navigation complète|Full navigation/ }).locator('a[href="/settings"]')).toHaveCount(0)
        await selector.selectOption('local-browser-fixture-main')
        await expect(page).toHaveURL(/\/dashboard$/)
        await expect(selector).toHaveValue('local-browser-fixture-main')
      } finally { await context.close() }
    })
    test('analysts do not see monitoring controls denied by their role', async ({ browser }) => {
      await db.query('update workspaces set access_state=$1, locale=$2 where id=$3', ['internal', 'fr', workspaceId])
      const { page, context } = await pageFor(browser, 'analyst')
      try {
        await page.goto('/agents')
        await expect(page.getByRole('button', { name: /Analyser maintenant|Créer|Activer|Suspendre/ })).toHaveCount(0)
      } finally { await context.close() }
    })
  })
}
