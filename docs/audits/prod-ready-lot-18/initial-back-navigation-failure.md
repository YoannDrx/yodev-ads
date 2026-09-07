# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: navigation-state-local.spec.ts >> live navigation state >> follows client navigation, keyboard and invalid accounts in fr
- Location: e2e/navigation-state-local.spec.ts:14:53

# Error details

```
Error: expect(locator).toHaveAttribute(expected) failed

Locator:  getByRole('navigation', { name: /Navigation principale|Main navigation/ }).locator('a[aria-current="page"]')
Expected: "/insights"
Received: "/tasks"
Timeout:  15000ms

Call log:
  - Expect "toHaveAttribute" with timeout 15000ms
  - waiting for getByRole('navigation', { name: /Navigation principale|Main navigation/ }).locator('a[aria-current="page"]')
    34 × locator resolved to <a href="/tasks" aria-current="page" class="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-white/70 transition hover:bg-white/8 hover:text-white aria-[current=page]:bg-white/12 aria-[current=page]:text-white aria-[current=page]:ring-1 aria-[current=page]:ring-inset aria-[current=page]:ring-white/20 focus-visible:outline-2 focus-visible:outline-offset-2">…</a>
       - unexpected value "/tasks"

```

```yaml
- link "Tâches":
  - /url: /tasks
```

# Test source

```ts
  1  | import { expect, test } from '@playwright/test'
  2  | import { randomUUID } from 'node:crypto'
  3  | import { Client } from 'pg'
  4  | 
  5  | if (process.env.PLAYWRIGHT_LOCAL_FIXTURE === '1') {
  6  |   const connectionString = process.env.DATABASE_SYSTEM_URL!, url = new URL(connectionString)
  7  |   if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || !url.pathname.startsWith('/yodev_test')) throw new Error('Disposable database required')
  8  |   const db = new Client({ connectionString }), workspaceId = '80000000-0000-4000-8000-000000000001'
  9  |   const clientId = '80000000-0000-4000-8000-000000000094', managerId = '80000000-0000-4000-8000-000000000095'
  10 |   test.describe.serial('live navigation state', () => {
  11 |     test.setTimeout(120_000)
  12 |     test.beforeAll(() => db.connect())
  13 |     test.afterAll(() => db.end())
  14 |     for (const locale of ['fr', 'en'] as const) test(`follows client navigation, keyboard and invalid accounts in ${locale}`, async ({ browser }) => {
  15 |       const taskId = randomUUID()
  16 |       await db.query('update workspaces set access_state=$1,plan=$2,locale=$3 where id=$4', ['internal', 'internal', locale, workspaceId])
  17 |       await db.query('insert into clients(id,workspace_id,google_customer_id,name,is_manager) values($1,$3,$4,$6,false),($2,$3,$5,$6,true)', [clientId, managerId, workspaceId, '8000000094', '8000000095', 'Navigation fixture'])
  18 |       await db.query("insert into workspace_tasks(id,workspace_id,created_by,title,description) values($1,$2,'fixture','Navigation task','Fixture')", [taskId, workspaceId])
  19 |       const context = await browser.newContext({ baseURL: process.env.PLAYWRIGHT_BASE_URL, storageState: process.env.PLAYWRIGHT_OWNER_STORAGE_STATE, viewport: { width: 1280, height: 600 } })
  20 |       await context.addCookies([{ name: 'yodev_cookie_consent', value: 'rejected', url: process.env.PLAYWRIGHT_BASE_URL! }])
  21 |       const page = await context.newPage(), errors: string[] = []
  22 |       page.on('pageerror', (error) => errors.push(error.message))
  23 |       try {
  24 |         await page.goto(`/insights/devices?client=${clientId}`)
  25 |         await page.keyboard.press('Tab')
  26 |         const skip = page.getByRole('link', { name: /Aller au contenu|Skip to content/ })
  27 |         await expect(skip).toBeFocused()
  28 |         await page.keyboard.press('Enter')
  29 |         await expect(page.locator('#main-content')).toBeFocused()
  30 |         const navigation = page.getByRole('navigation', { name: /Navigation principale|Main navigation/ })
  31 |         await expect(navigation.locator('a[aria-current="page"]')).toHaveAttribute('href', '/insights')
  32 |         await page.evaluate(() => Object.assign(window, { __navigationSentinel: 'retained' }))
  33 |         await navigation.locator('a[href="/tasks"]').focus()
  34 |         await page.keyboard.press('Enter')
  35 |         await expect(page).toHaveURL(/\/tasks$/)
  36 |         await expect(navigation.locator('a[aria-current="page"]')).toHaveAttribute('href', '/tasks')
  37 |         expect(await page.evaluate(() => (window as unknown as { __navigationSentinel?: string }).__navigationSentinel)).toBe('retained')
  38 |         await page.goBack()
> 39 |         await expect(navigation.locator('a[aria-current="page"]')).toHaveAttribute('href', '/insights')
     |                                                                    ^ Error: expect(locator).toHaveAttribute(expected) failed
  40 |         await navigation.locator('a[href="/operations"]').scrollIntoViewIfNeeded()
  41 |         await expect(navigation.locator('a[href="/operations"]')).toBeInViewport()
  42 |         expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
  43 |         await page.screenshot({ path: test.info().outputPath(`navigation-desktop-${locale}.png`) })
  44 |         await page.goto(`/discussions/tasks/${taskId}`)
  45 |         await expect(navigation.locator('a[aria-current="page"]')).toHaveAttribute('href', '/tasks')
  46 |         for (const width of [390, 768]) {
  47 |           await page.setViewportSize({ width, height: 600 })
  48 |           const menu = page.locator('summary').filter({ hasText: /^Menu$/ })
  49 |           await menu.click()
  50 |           const full = page.getByRole('navigation', { name: /Navigation complète|Full navigation/ })
  51 |           await expect(full.locator('a[aria-current="page"]')).toHaveAttribute('href', '/tasks')
  52 |           await menu.press('Escape')
  53 |           await expect(menu).toBeFocused()
  54 |           await menu.press('Enter')
  55 |           await full.locator('a[href="/dashboard"]').click()
  56 |           await expect(full).toBeHidden()
  57 |           const quick = page.getByRole('navigation', { name: /Navigation rapide|Quick navigation/ })
  58 |           await expect(quick.locator('a[aria-current="page"]')).toHaveAttribute('href', '/dashboard')
  59 |           await menu.click()
  60 |           await expect(full.locator('a[aria-current="page"]')).toHaveAttribute('href', '/dashboard')
  61 |           await full.locator('a[href="/tasks"]').click()
  62 |           expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
  63 |           await page.screenshot({ path: test.info().outputPath(`navigation-mobile-${locale}-${width}.png`) })
  64 |         }
  65 |         for (const path of ['/dashboard', '/analysis', '/insights', '/history']) {
  66 |           for (const query of ['client=invalid', 'client=', `client=${managerId}`, `client=${clientId}&client=${managerId}`]) {
  67 |             expect((await context.request.get(`${path}?${query}`)).status(), `${path}?${query}`).toBe(404)
  68 |           }
  69 |         }
  70 |         await db.query('update clients set active=false where id=$1', [clientId])
  71 |         expect((await context.request.get(`/dashboard?client=${clientId}`)).status()).toBe(404)
  72 |         expect(errors).toEqual([])
  73 |       } finally {
  74 |         await context.close()
  75 |         await db.query('delete from workspace_tasks where id=$1', [taskId])
  76 |         await db.query('delete from clients where id=any($1::uuid[])', [[clientId, managerId]])
  77 |       }
  78 |     })
  79 |   })
  80 | }
  81 | 
```