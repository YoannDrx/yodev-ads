import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { Client } from 'pg'

if (process.env.PLAYWRIGHT_LOCAL_FIXTURE === '1') {
  const connectionString = process.env.DATABASE_SYSTEM_URL!, url = new URL(connectionString)
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || !url.pathname.startsWith('/yodev_test')) throw new Error('Disposable database required')
  const db = new Client({ connectionString }), workspaceId = '80000000-0000-4000-8000-000000000001'
  const clientId = '80000000-0000-4000-8000-000000000094', managerId = '80000000-0000-4000-8000-000000000095'
  test.describe.serial('live navigation state', () => {
    test.setTimeout(120_000)
    test.beforeAll(() => db.connect())
    test.afterAll(() => db.end())
    for (const locale of ['fr', 'en'] as const) test(`follows client navigation, keyboard and invalid accounts in ${locale}`, async ({ browser }) => {
      const taskId = randomUUID()
      await db.query('update workspaces set access_state=$1,plan=$2,locale=$3 where id=$4', ['internal', 'internal', locale, workspaceId])
      await db.query('insert into clients(id,workspace_id,google_customer_id,name,is_manager) values($1,$3,$4,$6,false),($2,$3,$5,$6,true)', [clientId, managerId, workspaceId, '8000000094', '8000000095', 'Navigation fixture'])
      await db.query("insert into workspace_tasks(id,workspace_id,created_by,title,description) values($1,$2,'fixture','Navigation task','Fixture')", [taskId, workspaceId])
      const context = await browser.newContext({ baseURL: process.env.PLAYWRIGHT_BASE_URL, storageState: process.env.PLAYWRIGHT_OWNER_STORAGE_STATE, viewport: { width: 1280, height: 600 } })
      await context.addCookies([{ name: 'yodev_cookie_consent', value: 'rejected', url: process.env.PLAYWRIGHT_BASE_URL! }])
      const page = await context.newPage(), errors: string[] = []
      page.on('pageerror', (error) => errors.push(error.message))
      try {
        await page.goto(`/insights/devices?client=${clientId}`)
        // The workspace selector appears only after the client session loads.
        // Before hydration, a Link legitimately performs native navigation.
        await expect(page.getByRole('combobox', { name: /Workspace actif|Active workspace/ })).toBeVisible()
        await page.keyboard.press('Tab')
        const skip = page.getByRole('link', { name: /Aller au contenu|Skip to content/ })
        await expect(skip).toBeFocused()
        await page.keyboard.press('Enter')
        await expect(page.locator('#main-content')).toBeFocused()
        const navigation = page.getByRole('navigation', { name: /Navigation principale|Main navigation/ })
        await expect(navigation.locator('a[aria-current="page"]')).toHaveAttribute('href', '/insights')
        await page.evaluate(() => Object.assign(window, { __navigationSentinel: 'retained' }))
        await navigation.locator('a[href="/tasks"]').focus()
        await page.keyboard.press('Enter')
        await expect(page).toHaveURL(/\/tasks$/)
        await expect(navigation.locator('a[aria-current="page"]')).toHaveAttribute('href', '/tasks')
        expect(await page.evaluate(() => (window as unknown as { __navigationSentinel?: string }).__navigationSentinel)).toBe('retained')
        await page.goBack()
        await expect(page).toHaveURL(new RegExp(`/insights/devices\\?client=${clientId}`))
        await expect(navigation.locator('a[aria-current="page"]')).toHaveAttribute('href', '/insights')
        await navigation.locator('a[href="/operations"]').scrollIntoViewIfNeeded()
        await expect(navigation.locator('a[href="/operations"]')).toBeInViewport()
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
        await page.screenshot({ path: test.info().outputPath(`navigation-desktop-${locale}.png`) })
        await page.goto(`/discussions/tasks/${taskId}`)
        await expect(navigation.locator('a[aria-current="page"]')).toHaveAttribute('href', '/tasks')
        for (const width of [390, 768]) {
          await page.setViewportSize({ width, height: 600 })
          const menu = page.locator('summary').filter({ hasText: /^Menu$/ })
          await menu.click()
          const full = page.getByRole('navigation', { name: /Navigation complète|Full navigation/ })
          await expect(full.locator('a[aria-current="page"]')).toHaveAttribute('href', '/tasks')
          await menu.press('Escape')
          await expect(menu).toBeFocused()
          await menu.press('Enter')
          await full.locator('a[href="/dashboard"]').click()
          await expect(full).toBeHidden()
          const quick = page.getByRole('navigation', { name: /Navigation rapide|Quick navigation/ })
          await expect(quick.locator(':scope > a[aria-current="page"]')).toHaveAttribute('href', '/dashboard')
          await menu.click()
          await expect(full.locator('a[aria-current="page"]')).toHaveAttribute('href', '/dashboard')
          await full.locator('a[href="/tasks"]').click()
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
          await page.screenshot({ path: test.info().outputPath(`navigation-mobile-${locale}-${width}.png`) })
        }
        for (const path of ['/dashboard', '/analysis', '/insights', '/history']) {
          for (const query of ['client=invalid', 'client=', `client=${managerId}`, `client=${clientId}&client=${managerId}`]) {
            expect((await context.request.get(`${path}?${query}`)).status(), `${path}?${query}`).toBe(404)
          }
        }
        await db.query('update clients set active=false where id=$1', [clientId])
        expect((await context.request.get(`/dashboard?client=${clientId}`)).status()).toBe(404)
        expect(errors).toEqual([])
      } finally {
        await context.close()
        await db.query('delete from workspace_tasks where id=$1', [taskId])
        await db.query('delete from clients where id=any($1::uuid[])', [[clientId, managerId]])
      }
    })
  })
}
