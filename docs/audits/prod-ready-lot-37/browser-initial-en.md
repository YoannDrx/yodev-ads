# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: settings-actors-local.spec.ts >> settings actor en saves current policy and rejects downgraded or revoked forms
- Location: e2e/settings-actors-local.spec.ts:6:7

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: 404
Received: 200
```

# Test source

```ts
  1  | import { expect, test } from '@playwright/test'
  2  | import { randomUUID } from 'node:crypto'
  3  | import { Client } from 'pg'
  4  |
  5  | if (process.env.PLAYWRIGHT_LOCAL_FIXTURE === '1') for (const [index, locale] of ['fr', 'en'].entries()) {
  6  |   test(`settings actor ${locale} saves current policy and rejects downgraded or revoked forms`, async ({ browser }) => {
  7  |     const url = new URL(process.env.DATABASE_SYSTEM_URL!)
  8  |     if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || !url.pathname.startsWith('/yodev_test')) throw new Error('Disposable database required')
  9  |     const db = new Client({ connectionString: url.href }), workspaceId = '80000000-0000-4000-8000-000000000001', actor = 'local-browser-fixture-admin', marker = `Settings ${randomUUID()}`
  10 |     await db.connect()
  11 |     const original = (await db.query('select access_state,plan,locale,required_approvals,allow_self_approval,approval_mode,brand_name,brand_tagline,accent_color from workspaces where id=$1', [workspaceId])).rows[0]
  12 |     const member = (await db.query("select id,role from auth_members where organization_id='local-browser-fixture-main' and user_id=$1", [actor])).rows[0]
  13 |     const beforeAudits = (await db.query('select id from audit_events where workspace_id=$1 and actor_user_id=$2', [workspaceId, actor])).rows.map((row) => row.id)
  14 |     const context = await browser.newContext({ baseURL: process.env.PLAYWRIGHT_BASE_URL, storageState: process.env.PLAYWRIGHT_ADMIN_STORAGE_STATE, viewport: { width: locale === 'fr' ? 390 : 1440, height: 950 }, extraHTTPHeaders: { 'x-forwarded-for': `198.18.37.${index + 1}` } })
  15 |     await context.addCookies([{ name: 'yodev_cookie_consent', value: 'rejected', url: process.env.PLAYWRIGHT_BASE_URL! }])
  16 |     try {
  17 |       await db.query("update workspaces set access_state='active',plan='agency',locale=$1,required_approvals=1,allow_self_approval=false,approval_mode='single' where id=$2", [locale, workspaceId])
  18 |       const page = await context.newPage(), errors: string[] = []
  19 |       page.on('pageerror', (error) => errors.push(error.message)); page.setDefaultTimeout(15_000)
  20 |       await page.goto('/settings')
  21 |       const language = page.locator('form:has(select[name="locale"])')
  22 |       await language.getByRole('combobox').selectOption(locale === 'fr' ? 'en' : 'fr'); await language.getByRole('button').click()
  23 |       await expect(language.getByRole('combobox')).toHaveValue(locale === 'fr' ? 'en' : 'fr')
  24 |       // Wait for the new language render before changing it back.
  25 |       await expect(page.getByRole('heading', { name: locale === 'fr' ? 'Settings' : 'Réglages', exact: true })).toBeVisible()
  26 |       await language.getByRole('combobox').selectOption(locale); await language.getByRole('button').click()
  27 |       await expect(page.getByRole('heading', { name: locale === 'fr' ? 'Réglages' : 'Settings', exact: true })).toBeVisible()
  28 |       const policy = page.locator('form:has(select[name="requiredApprovals"])')
  29 |       await policy.getByRole('combobox').selectOption('2'); await policy.getByRole('button').click()
  30 |       await expect(page.getByText(locale === 'fr' ? 'Politique d’approbation mise à jour.' : 'Approval policy updated.', { exact: true })).toBeVisible()
  31 |       expect((await db.query('select required_approvals,approval_mode from workspaces where id=$1', [workspaceId])).rows[0]).toEqual({ required_approvals: 2, approval_mode: 'dual' })
  32 |       const branding = page.locator('form:has(input[name="brandName"])')
  33 |       await branding.locator('[name="brandName"]').fill(marker)
  34 |       await branding.locator('[name="brandTagline"]').fill('Settings workflow fixture')
  35 |       await branding.locator('[name="accentColor"]').fill('#126456')
  36 |       await branding.getByRole('button').click()
  37 |       await expect(page.getByText(locale === 'fr' ? 'Identité de marque enregistrée.' : 'Brand identity saved.', { exact: true })).toBeVisible()
  38 |       expect((await db.query('select brand_name,accent_color from workspaces where id=$1', [workspaceId])).rows[0]).toEqual({ brand_name: marker, accent_color: '#126456' })
  39 |       await branding.screenshot({ path: test.info().outputPath(`settings-branding-${locale}.png`), caret: 'initial' })
  40 |       await policy.screenshot({ path: test.info().outputPath(`settings-policy-${locale}.png`), caret: 'initial' })
  41 |       expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  42 |       // An already displayed dual-approval form must not bypass a downgrade.
  43 |       await db.query("update workspaces set plan='solo' where id=$1", [workspaceId])
  44 |       await policy.getByRole('button').click(); await expect(page).toHaveURL(/error=/)
  45 |       expect((await db.query('select count(*) from audit_events where workspace_id=$1 and actor_user_id=$2 and action=$3 and not(id=any($4::uuid[]))', [workspaceId, actor, 'workspace.approval_policy_updated', beforeAudits])).rows[0].count).toBe('1')
  46 |       await db.query("update workspaces set plan='agency' where id=$1", [workspaceId]); await page.goto('/settings')
  47 |       await branding.locator('[name="brandName"]').fill('Forbidden brand')
  48 |       await db.query("update auth_members set role='analyst' where id=$1", [member.id])
  49 |       await branding.getByRole('button').click()
  50 |       await expect(branding).toHaveCount(0)
> 51 |       expect((await page.request.get('/settings')).status()).toBe(404)
     |                                                              ^ Error: expect(received).toBe(expected) // Object.is equality
  52 |       expect((await db.query('select brand_name from workspaces where id=$1', [workspaceId])).rows[0].brand_name).toBe(marker)
  53 |       // Analysts can prepare personal views; a subsequent client role cannot submit the old form.
  54 |       await page.goto('/portfolio')
  55 |       const views = page.locator('[data-portfolio-saved-views]')
  56 |       await views.locator(':scope > summary').click()
  57 |       await views.getByRole('textbox', { name: /New view name|Nom de la nouvelle vue/ }).fill(marker)
  58 |       await db.query("update auth_members set role='client' where id=$1", [member.id])
  59 |       await views.getByRole('button', { name: /Save current filters|Enregistrer ces filtres/ }).click()
  60 |       await expect(page).toHaveURL(/view_notice=unavailable/)
  61 |       await expect(views).toHaveCount(0)
  62 |       expect((await page.request.get('/portfolio')).status()).toBe(404)
  63 |       expect((await db.query('select count(*) from portfolio_views where workspace_id=$1 and user_id=$2 and name=$3', [workspaceId, actor, marker])).rows[0].count).toBe('0')
  64 |       expect(errors).toEqual([])
  65 |     } finally {
  66 |       await context.close().catch(() => {})
  67 |       await db.query('update auth_members set role=$1 where id=$2', [member.role, member.id])
  68 |       await db.query('delete from audit_events where workspace_id=$1 and actor_user_id=$2 and not(id=any($3::uuid[]))', [workspaceId, actor, beforeAudits])
  69 |       await db.query('delete from portfolio_views where workspace_id=$1 and user_id=$2 and name=$3', [workspaceId, actor, marker])
  70 |       await db.query('update workspaces set access_state=$1,plan=$2,locale=$3,required_approvals=$4,allow_self_approval=$5,approval_mode=$6,brand_name=$7,brand_tagline=$8,accent_color=$9 where id=$10', [original.access_state, original.plan, original.locale, original.required_approvals, original.allow_self_approval, original.approval_mode, original.brand_name, original.brand_tagline, original.accent_color, workspaceId])
  71 |       await db.end()
  72 |     }
  73 |   })
  74 | }
  75 |
```
