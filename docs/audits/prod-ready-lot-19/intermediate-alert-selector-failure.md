# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: portfolio-local.spec.ts >> agency portfolio >> reviews 50 accounts, personal views and team workload in fr
- Location: e2e/portfolio-local.spec.ts:13:53

# Error details

```
Error: expect(locator).toContainText(expected) failed

Locator: getByRole('alert')
Expected pattern: /view changed|vue a changé/
Error: strict mode violation: getByRole('alert') resolved to 2 elements:
    1) <p role="alert" class="mb-4 rounded-lg border bg-white p-3 text-sm">Cette vue a changé ou n’est plus disponible. Véri…</p> aka getByText('Cette vue a changé ou n’est')
    2) <div role="alert" aria-live="assertive" id="__next-route-announcer__"></div> aka locator('[id="__next-route-announcer__"]')

Call log:
  - Expect "toContainText" with timeout 15000ms
  - waiting for getByRole('alert')
    3 × locator resolved to <div role="alert" aria-live="assertive" id="__next-route-announcer__"></div>
      - unexpected value ""

```

# Test source

```ts
  1   | import { expect, test } from '@playwright/test'
  2   | import { randomUUID } from 'node:crypto'
  3   | import { Client } from 'pg'
  4   | 
  5   | if (process.env.PLAYWRIGHT_LOCAL_FIXTURE === '1') {
  6   |   const connectionString = process.env.DATABASE_SYSTEM_URL!, url = new URL(connectionString)
  7   |   if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || !url.pathname.startsWith('/yodev_test')) throw new Error('Disposable database required')
  8   |   const db = new Client({ connectionString }), workspaceId = '80000000-0000-4000-8000-000000000001', marker = 'portfolio-browser-fixture'
  9   |   test.describe.serial('agency portfolio', () => {
  10  |     test.setTimeout(150_000)
  11  |     test.beforeAll(() => db.connect())
  12  |     test.afterAll(() => db.end())
  13  |     for (const locale of ['fr', 'en'] as const) test(`reviews 50 accounts, personal views and team workload in ${locale}`, async ({ browser }) => {
  14  |       const ids = Array.from({ length: 50 }, () => randomUUID()), taskId = randomUUID()
  15  |       const workspace = (await db.query('update workspaces set access_state=$1,plan=$2,locale=$3 where id=$4 returning owner_user_id', ['internal', 'internal', locale, workspaceId])).rows[0]
  16  |       await db.query(`insert into clients(id,workspace_id,google_customer_id,name,currency_code,timezone,created_at)
  17  |         select id,$1,(8400000000+n)::text,'PORTFOLIO_'||lpad(n::text,2,'0'),case when n%2=0 then 'EUR' else 'USD' end,case when n%2=0 then 'Europe/Paris' else 'America/New_York' end,now()-interval '1 day'+n*interval '1 microsecond'
  18  |         from unnest($2::uuid[]) with ordinality as t(id,n)`, [workspaceId, ids])
  19  |       await db.query(`insert into daily_account_metrics(workspace_id,client_id,metric_date,currency_code,timezone,cost_micros,clicks,conversions,conversion_value_micros,coverage_status,source_version,source_observed_at)
  20  |         select workspace_id,id,((now() at time zone timezone)::date-days)::text,currency_code,timezone,'1000000','10','1.25','2000000','complete',$2,now() from clients cross join generate_series(1,30) days where id=any($1::uuid[])`, [ids, marker])
  21  |       await db.query("update daily_account_metrics set source_observed_at=now()-interval '3 days' where client_id=$1", [ids[0]])
  22  |       await db.query("delete from daily_account_metrics where client_id=$1", [ids[1]])
  23  |       await db.query(`insert into workspace_tasks(id,workspace_id,client_id,created_by,assigned_to,title,description,status,priority,due_at) values($1,$2,$3,$4,$5,'PORTFOLIO_TASK','Fixture','blocked','urgent',now()-interval '1 day')`, [taskId, workspaceId, ids[49], marker, workspace.owner_user_id])
  24  |       await db.query(`insert into workspace_tasks(workspace_id,created_by,title,description,status) values($1,$2,'PORTFOLIO_MANUAL','Fixture','todo')`, [workspaceId, marker])
  25  |       const context = await browser.newContext({ baseURL: process.env.PLAYWRIGHT_BASE_URL, storageState: process.env.PLAYWRIGHT_OWNER_STORAGE_STATE, viewport: { width: 1440, height: 1000 } })
  26  |       await context.addCookies([{ name: 'yodev_cookie_consent', value: 'rejected', url: process.env.PLAYWRIGHT_BASE_URL! }])
  27  |       const page = await context.newPage(), errors: string[] = []
  28  |       page.on('pageerror', (error) => errors.push(error.message))
  29  |       try {
  30  |         await page.goto('/portfolio?q=PORTFOLIO_')
  31  |         await expect(page.getByRole('heading', { name: /Portefeuille clients|Client portfolio/ })).toBeVisible()
  32  |         await expect(page.locator('[data-portfolio-account]')).toHaveCount(25)
  33  |         await expect(page.locator('[data-portfolio-group]')).toHaveCount(2)
  34  |         await expect(page.locator('[data-portfolio-group]').filter({ hasText: 'EUR' })).toContainText('24/25')
  35  |         await expect(page.locator('[data-portfolio-group]').filter({ hasText: 'USD' })).toContainText('24/25')
  36  |         await expect(page.getByRole('link', { name: 'PORTFOLIO_50', exact: true })).toBeVisible()
  37  |         await page.getByRole('link', { name: /^(Older results|Résultats plus anciens)$/ }).click()
  38  |         await expect(page).toHaveURL(/cursor=/)
  39  |         await expect(page.getByRole('link', { name: 'PORTFOLIO_01', exact: true })).toBeVisible()
  40  |         await expect(page.locator('[data-portfolio-account]').filter({ hasText: 'PORTFOLIO_01' })).toContainText(/Données anciennes|Stale data/)
  41  |         await expect(page.locator('[data-portfolio-account]').filter({ hasText: 'PORTFOLIO_02' }).locator('td').first()).toHaveText('—')
  42  |         await page.getByRole('combobox', { name: /Priority filter|Filtrer les priorités/ }).selectOption('missing_data')
  43  |         await page.getByRole('button', { name: /Apply filters|Appliquer les filtres/ }).click()
  44  |         await expect(page).not.toHaveURL(/cursor=/)
  45  |         await expect(page.locator('[data-portfolio-account]')).toHaveCount(2)
  46  |         const views = page.locator('[data-portfolio-saved-views]')
  47  |         await views.locator(':scope > summary').click()
  48  |         await views.getByRole('textbox', { name: /New view name|Nom de la nouvelle vue/ }).fill('PORTFOLIO_SAVED')
  49  |         await views.getByRole('button', { name: /Save current filters|Enregistrer ces filtres/ }).click()
  50  |         await expect(page.getByRole('status')).toContainText(/View saved|Vue enregistrée/)
  51  |         await views.locator(':scope > summary').click()
  52  |         const view = views.getByRole('listitem').filter({ hasText: 'PORTFOLIO_SAVED' })
  53  |         await expect(view.getByRole('link')).toHaveAttribute('href', /attention=missing_data/)
  54  |         await view.locator('summary').click()
  55  |         await view.getByRole('textbox', { name: /View name|Nom de la vue/, exact: true }).fill('PORTFOLIO_RENAMED')
  56  |         await view.getByRole('button', { name: /Replace with current filters|Remplacer par les filtres affichés/ }).click()
  57  |         await expect(page.getByRole('status')).toContainText(/View saved|Vue enregistrée/)
  58  |         await expect(views.locator('a').filter({ hasText: 'PORTFOLIO_RENAMED' })).toHaveCount(1)
  59  |         if (await views.getAttribute('open') === null) await views.locator(':scope > summary').click()
  60  |         await expect(views.getByRole('link', { name: 'PORTFOLIO_RENAMED' })).toBeVisible()
  61  |         const stale = await context.newPage()
  62  |         await stale.goto('/portfolio?q=PORTFOLIO_')
  63  |         await stale.locator('[data-portfolio-saved-views] > summary').click()
  64  |         await stale.locator('[data-portfolio-saved-views] li summary').click()
  65  |         await db.query('update portfolio_views set version=$1 where workspace_id=$2 and name=$3', [randomUUID(), workspaceId, 'PORTFOLIO_RENAMED'])
  66  |         await stale.getByRole('button', { name: /Delete saved view|Supprimer la vue enregistrée/ }).click()
> 67  |         await expect(stale.getByRole('alert')).toContainText(/view changed|vue a changé/)
      |                                                ^ Error: expect(locator).toContainText(expected) failed
  68  |         await stale.close()
  69  |         await page.goto('/portfolio?q=PORTFOLIO_')
  70  |         await views.locator(':scope > summary').click()
  71  |         await views.locator('li summary').click()
  72  |         await views.getByRole('button', { name: /Delete saved view|Supprimer la vue enregistrée/ }).click()
  73  |         await expect(page.getByRole('status')).toContainText(/View deleted|Vue supprimée/)
  74  |         const unassigned = page.locator('[data-portfolio-workload]').filter({ hasText: /Tâches non attribuées|Unassigned tasks/ })
  75  |         await unassigned.getByRole('link', { name: /Review tasks|Revoir les tâches/ }).click()
  76  |         await expect(page).toHaveURL(/assignee=unassigned/)
  77  |         await expect(page.getByText('PORTFOLIO_MANUAL', { exact: true })).toBeVisible()
  78  |         await expect(page.getByText('PORTFOLIO_TASK', { exact: true })).toHaveCount(0)
  79  |         await page.goto(`/portfolio?assignee=${workspace.owner_user_id}`)
  80  |         await expect(page.locator('[data-portfolio-account]')).toHaveCount(1)
  81  |         await expect(page.locator('[data-portfolio-account]')).toContainText(/1 blocked|1 bloquées/)
  82  |         await db.query("update workspace_tasks set status='done' where id=$1", [taskId])
  83  |         await page.reload()
  84  |         await expect(page.locator('[data-portfolio-account]')).toHaveCount(0)
  85  |         await page.goto('/portfolio?q=PORTFOLIO_')
  86  |         await page.screenshot({ path: test.info().outputPath(`portfolio-desktop-${locale}.png`), fullPage: true })
  87  |         await page.setViewportSize({ width: 390, height: 844 })
  88  |         expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
  89  |         await page.screenshot({ path: test.info().outputPath(`portfolio-mobile-${locale}.png`), fullPage: true })
  90  |         await db.query("update workspaces set access_state='grace' where id=$1", [workspaceId])
  91  |         await page.reload()
  92  |         await expect(page.locator('[data-portfolio-account]')).toHaveCount(25)
  93  |         await views.locator(':scope > summary').click()
  94  |         await expect(views.getByRole('button')).toHaveCount(0)
  95  |         await db.query("update workspaces set access_state='internal' where id=$1", [workspaceId])
  96  |         const reader = await browser.newContext({ baseURL: process.env.PLAYWRIGHT_BASE_URL, storageState: process.env.PLAYWRIGHT_CLIENT_STORAGE_STATE })
  97  |         try {
  98  |           const clientPage = await reader.newPage(); await clientPage.goto('/portfolio?q=PORTFOLIO_')
  99  |           await expect(clientPage).not.toHaveURL(/\/portfolio/)
  100 |           await expect(clientPage.locator('[data-portfolio-account]')).toHaveCount(0)
  101 |         } finally { await reader.close() }
  102 |         const anonymous = await browser.newContext({ baseURL: process.env.PLAYWRIGHT_BASE_URL })
  103 |         try { const signedOut = await anonymous.newPage(); await signedOut.goto('/portfolio?q=PORTFOLIO_'); await expect(signedOut).toHaveURL(/sign-in/) } finally { await anonymous.close() }
  104 |         expect(errors).toEqual([])
  105 |       } finally {
  106 |         await context.close()
  107 |         await db.query('delete from portfolio_views where workspace_id=$1 and name like $2', [workspaceId, 'PORTFOLIO_%'])
  108 |         await db.query('delete from workspace_tasks where workspace_id=$1 and created_by=$2', [workspaceId, marker])
  109 |         await db.query('delete from clients where id=any($1::uuid[])', [ids])
  110 |         await db.query("update workspaces set locale='fr',access_state='internal' where id=$1", [workspaceId])
  111 |       }
  112 |     })
  113 |   })
  114 | }
  115 | 
```