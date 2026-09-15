# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: ownership-local.spec.ts >> ownership transfer fr rechecks old owner authority and preserves other agencies
- Location: e2e/ownership-local.spec.ts:5:61

# Error details

```
error: inconsistent types deduced for parameter $1
```

# Test source

```ts
  1  | import { expect, test, type BrowserContext } from '@playwright/test'
  2  | import { Client } from 'pg'
  3  |
  4  | if (process.env.PLAYWRIGHT_LOCAL_FIXTURE === '1') {
  5  |   for (const [index, locale] of ['fr', 'en'].entries()) test(`ownership transfer ${locale} rechecks old owner authority and preserves other agencies`, async ({ browser }) => {
  6  |     const connectionString = process.env.DATABASE_SYSTEM_URL!, url = new URL(connectionString)
  7  |     if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || !url.pathname.startsWith('/yodev_test')) throw new Error('Disposable database required')
  8  |     const db = new Client({ connectionString }), workspaceId = '80000000-0000-4000-8000-000000000001'
  9  |     const oldOwner = 'local-browser-fixture-owner', nextOwner = 'local-browser-fixture-admin'
  10 |     const contexts: BrowserContext[] = []
  11 |     await db.connect()
  12 |     try {
  13 |       await db.query("update workspaces set access_state='internal',locale=$1 where id=$2", [locale, workspaceId])
  14 |       const original = (await db.query('select slug from workspaces where id=$1', [workspaceId])).rows[0]
  15 |       const foreign = (await db.query("select owner_user_id,auth_owner_user_id from workspaces where id='80000000-0000-4000-8000-000000000002'")).rows[0]
  16 |       const baseline = Number((await db.query("select count(*) from audit_events where workspace_id=$1 and action='workspace.ownership_transferred'", [workspaceId])).rows[0].count)
  17 |       async function context(role: string) {
  18 |         const value = await browser.newContext({ baseURL: process.env.PLAYWRIGHT_BASE_URL, storageState: process.env[`PLAYWRIGHT_${role.toUpperCase()}_STORAGE_STATE`], extraHTTPHeaders: { Origin: process.env.PLAYWRIGHT_BASE_URL!, 'x-forwarded-for': `198.51.100.${111 + index}` } })
  19 |         contexts.push(value)
  20 |         await value.addCookies([{ name: 'yodev_cookie_consent', value: 'rejected', url: process.env.PLAYWRIGHT_BASE_URL! }])
  21 |         return value
  22 |       }
  23 |       const owner = await context('owner'), admin = await context('admin')
  24 |       const page = await owner.newPage(), successor = await admin.newPage()
  25 |       await page.goto('/settings')
  26 |       const details = page.locator('details').filter({ has: page.locator('summary').filter({ hasText: /Transfer workspace ownership|Transférer la propriété/ }) })
  27 |       if (!(await details.getByRole('combobox').isVisible())) await details.locator('summary').click()
  28 |       await details.getByRole('combobox').selectOption(nextOwner)
  29 |       await details.getByRole('textbox', { name: /Workspace identifier confirmation|Confirmation de l’identifiant/ }).fill('wrong-confirmation')
  30 |       await details.getByRole('button', { name: /^(Transfer|Transférer)$/ }).click()
  31 |       await expect(page).toHaveURL(/error=/)
  32 |       expect((await db.query('select owner_user_id from workspaces where id=$1', [workspaceId])).rows[0].owner_user_id).toBe(oldOwner)
  33 |       if (!(await details.getByRole('combobox').isVisible())) await details.locator('summary').click()
  34 |       await details.getByRole('combobox').selectOption(nextOwner)
  35 |       await details.getByRole('textbox', { name: /Workspace identifier confirmation|Confirmation de l’identifiant/ }).fill(original.slug)
  36 |       const actionRequest = page.waitForRequest((request) => request.method() === 'POST' && Boolean(request.headers()['next-action']))
  37 |       await details.getByRole('button', { name: /^(Transfer|Transférer)$/ }).click()
  38 |       const sent = await actionRequest
  39 |       await expect(page).toHaveURL(/notice=/)
  40 |       await expect(page.locator('summary').filter({ hasText: /Transfer workspace ownership|Transférer la propriété/ })).toHaveCount(0)
  41 |       expect((await db.query('select owner_user_id,auth_owner_user_id from workspaces where id=$1', [workspaceId])).rows[0]).toEqual({ owner_user_id: nextOwner, auth_owner_user_id: nextOwner })
  42 |       const roles = (await db.query("select user_id,role from auth_members where organization_id='local-browser-fixture-main' and user_id=any($1::text[])", [[oldOwner, nextOwner]])).rows
  43 |       expect(roles).toEqual(expect.arrayContaining([{ user_id: oldOwner, role: 'admin' }, { user_id: nextOwner, role: 'owner' }]))
  44 |       // Replay the valid old form through the former owner's own session.
  45 |       const headers = Object.fromEntries(Object.entries(sent.headers()).filter(([key]) => ['accept', 'content-type', 'next-action', 'next-router-state-tree', 'next-url', 'origin'].includes(key)))
  46 |       expect(headers.cookie).toBeUndefined()
  47 |       const replay = await owner.request.fetch(sent.url(), { method: 'POST', headers, data: sent.postDataBuffer()!, maxRedirects: 0 })
  48 |       expect(replay.headers()['x-action-redirect']).toContain('error=')
  49 |       expect(Number((await db.query("select count(*) from audit_events where workspace_id=$1 and action='workspace.ownership_transferred'", [workspaceId])).rows[0].count)).toBe(baseline + 1)
  50 |       await successor.goto('/settings')
  51 |       await expect(successor.locator('summary').filter({ hasText: /Transfer workspace ownership|Transférer la propriété/ })).toBeVisible()
  52 |       expect((await db.query("select owner_user_id,auth_owner_user_id from workspaces where id='80000000-0000-4000-8000-000000000002'")).rows[0]).toEqual(foreign)
  53 |       await successor.screenshot({ path: test.info().outputPath(`ownership-${locale}.png`), caret: 'initial' })
  54 |     } finally {
  55 |       await Promise.allSettled(contexts.map((context) => context.close()))
> 56 |       await db.query("update workspaces set owner_user_id=$1,auth_owner_user_id=$1,locale='fr' where id=$2", [oldOwner, workspaceId])
     |       ^ error: inconsistent types deduced for parameter $1
  57 |       await db.query("update auth_members set role=case when user_id=$1 then 'owner' else 'admin' end where organization_id='local-browser-fixture-main' and user_id=any($2::text[])", [oldOwner, [oldOwner, nextOwner]])
  58 |       await db.end()
  59 |     }
  60 |   })
  61 | }
  62 |
```
