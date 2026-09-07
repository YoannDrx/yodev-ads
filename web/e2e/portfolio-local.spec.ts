import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { Client } from 'pg'

if (process.env.PLAYWRIGHT_LOCAL_FIXTURE === '1') {
  const connectionString = process.env.DATABASE_SYSTEM_URL!, url = new URL(connectionString)
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || !url.pathname.startsWith('/yodev_test')) throw new Error('Disposable database required')
  const db = new Client({ connectionString }), workspaceId = '80000000-0000-4000-8000-000000000001', marker = 'portfolio-browser-fixture'
  test.describe.serial('agency portfolio', () => {
    test.setTimeout(150_000)
    test.beforeAll(() => db.connect())
    test.afterAll(() => db.end())
    for (const locale of ['fr', 'en'] as const) test(`reviews 50 accounts, personal views and team workload in ${locale}`, async ({ browser }) => {
      const ids = Array.from({ length: 50 }, () => randomUUID()), taskId = randomUUID()
      const workspace = (await db.query('update workspaces set access_state=$1,plan=$2,locale=$3 where id=$4 returning owner_user_id', ['internal', 'internal', locale, workspaceId])).rows[0]
      await db.query(`insert into clients(id,workspace_id,google_customer_id,name,currency_code,timezone,created_at)
        select id,$1,(8400000000+n)::text,'PORTFOLIO_'||lpad(n::text,2,'0'),case when n%2=0 then 'EUR' else 'USD' end,case when n%2=0 then 'Europe/Paris' else 'America/New_York' end,now()-interval '1 day'+n*interval '1 microsecond'
        from unnest($2::uuid[]) with ordinality as t(id,n)`, [workspaceId, ids])
      await db.query(`insert into daily_account_metrics(workspace_id,client_id,metric_date,currency_code,timezone,cost_micros,clicks,conversions,conversion_value_micros,coverage_status,source_version,source_observed_at)
        select workspace_id,id,((now() at time zone timezone)::date-days)::text,currency_code,timezone,'1000000','10','1.25','2000000','complete',$2,now() from clients cross join generate_series(1,30) days where id=any($1::uuid[])`, [ids, marker])
      await db.query("update daily_account_metrics set source_observed_at=now()-interval '3 days' where client_id=$1", [ids[0]])
      await db.query("delete from daily_account_metrics where client_id=$1", [ids[1]])
      await db.query(`insert into workspace_tasks(id,workspace_id,client_id,created_by,assigned_to,title,description,status,priority,due_at) values($1,$2,$3,$4,$5,'PORTFOLIO_TASK','Fixture','blocked','urgent',now()-interval '1 day')`, [taskId, workspaceId, ids[49], marker, workspace.owner_user_id])
      await db.query(`insert into workspace_tasks(workspace_id,created_by,title,description,status) values($1,$2,'PORTFOLIO_MANUAL','Fixture','todo')`, [workspaceId, marker])
      const context = await browser.newContext({ baseURL: process.env.PLAYWRIGHT_BASE_URL, storageState: process.env.PLAYWRIGHT_OWNER_STORAGE_STATE, viewport: { width: 1440, height: 1000 } })
      await context.addCookies([{ name: 'yodev_cookie_consent', value: 'rejected', url: process.env.PLAYWRIGHT_BASE_URL! }])
      await context.addInitScript(() => {
        document.addEventListener('securitypolicyviolation', (event) => {
          console.log('PORTFOLIO_CSP', JSON.stringify({ directive: event.effectiveDirective, source: event.sourceFile, target: (event.target as Element)?.tagName }))
        })
      })
      const page = await context.newPage(), errors: string[] = []
      let developmentStyleViolations = 0
      page.on('pageerror', (error) => errors.push(error.message))
      page.on('console', (message) => {
        // CSP errors are checked through their structured violation event below,
        // distinguishing the development overlay from actual application styles.
        if (message.type() === 'error' && !message.text().startsWith('Applying inline style violates')) errors.push(message.text())
        if (message.text().startsWith('PORTFOLIO_CSP ')) {
          const violation = JSON.parse(message.text().slice('PORTFOLIO_CSP '.length))
          if (violation.directive === 'style-src-elem' && /\/_next\/static\/chunks\/.*next-devtools/.test(violation.source) && ['NEXTJS-PORTAL', 'STYLE'].includes(violation.target)) developmentStyleViolations += 1
          else errors.push(message.text())
        }
      })
      try {
        await page.goto('/portfolio?q=PORTFOLIO_')
        await expect(page.getByRole('heading', { name: /Portefeuille clients|Client portfolio/ })).toBeVisible()
        await expect(page.locator('[data-portfolio-account]')).toHaveCount(25)
        await expect(page.locator('[data-portfolio-group]')).toHaveCount(2)
        await expect(page.locator('[data-portfolio-group]').filter({ hasText: 'EUR' })).toContainText('24/25')
        await expect(page.locator('[data-portfolio-group]').filter({ hasText: 'USD' })).toContainText('24/25')
        await expect(page.getByRole('link', { name: 'PORTFOLIO_50', exact: true })).toBeVisible()
        await page.getByRole('link', { name: /^(Older results|Résultats plus anciens)$/ }).click()
        await expect(page).toHaveURL(/cursor=/)
        await expect(page.getByRole('link', { name: 'PORTFOLIO_01', exact: true })).toBeVisible()
        await expect(page.locator('[data-portfolio-account]').filter({ hasText: 'PORTFOLIO_01' })).toContainText(/Données anciennes|Stale data/)
        await expect(page.locator('[data-portfolio-account]').filter({ hasText: 'PORTFOLIO_02' }).locator('td').first()).toHaveText('—')
        await page.getByRole('combobox', { name: /Priority filter|Filtrer les priorités/ }).selectOption('missing_data')
        await page.getByRole('button', { name: /Apply filters|Appliquer les filtres/ }).click()
        await expect(page).not.toHaveURL(/cursor=/)
        await expect(page.locator('[data-portfolio-account]')).toHaveCount(2)
        const views = page.locator('[data-portfolio-saved-views]')
        await views.locator(':scope > summary').click()
        await views.getByRole('textbox', { name: /New view name|Nom de la nouvelle vue/ }).fill('PORTFOLIO_SAVED')
        await views.getByRole('button', { name: /Save current filters|Enregistrer ces filtres/ }).click()
        await expect(page.getByRole('status')).toContainText(/View saved|Vue enregistrée/)
        await views.locator(':scope > summary').click()
        const view = views.getByRole('listitem').filter({ hasText: 'PORTFOLIO_SAVED' })
        await expect(view.getByRole('link')).toHaveAttribute('href', /attention=missing_data/)
        await view.locator('summary').click()
        await view.getByRole('textbox', { name: /View name|Nom de la vue/, exact: true }).fill('PORTFOLIO_RENAMED')
        await view.getByRole('button', { name: /Replace with current filters|Remplacer par les filtres affichés/ }).click()
        await expect(page.getByRole('status')).toContainText(/View saved|Vue enregistrée/)
        await expect(views.locator('a').filter({ hasText: 'PORTFOLIO_RENAMED' })).toHaveCount(1)
        if (await views.getAttribute('open') === null) await views.locator(':scope > summary').click()
        await expect(views.getByRole('link', { name: 'PORTFOLIO_RENAMED' })).toBeVisible()
        const stale = await context.newPage()
        await stale.goto('/portfolio?q=PORTFOLIO_')
        await stale.locator('[data-portfolio-saved-views] > summary').click()
        await stale.locator('[data-portfolio-saved-views] li summary').click()
        await db.query('update portfolio_views set version=$1 where workspace_id=$2 and name=$3', [randomUUID(), workspaceId, 'PORTFOLIO_RENAMED'])
        await stale.getByRole('button', { name: /Delete saved view|Supprimer la vue enregistrée/ }).click()
        await expect(stale.getByRole('alert').filter({ hasText: /view changed|vue a changé/ })).toBeVisible()
        await stale.close()
        await page.goto('/portfolio?q=PORTFOLIO_')
        await views.locator(':scope > summary').click()
        await views.locator('li summary').click()
        await views.getByRole('button', { name: /Delete saved view|Supprimer la vue enregistrée/ }).click()
        await expect(page.getByRole('status')).toContainText(/View deleted|Vue supprimée/)
        const unassigned = page.locator('[data-portfolio-workload]').filter({ hasText: /Tâches non attribuées|Unassigned tasks/ })
        await unassigned.getByRole('link', { name: /Review tasks|Revoir les tâches/ }).click()
        await expect(page).toHaveURL(/assignee=unassigned/)
        await expect(page.getByText('PORTFOLIO_MANUAL', { exact: true })).toBeVisible()
        await expect(page.getByText('PORTFOLIO_TASK', { exact: true })).toHaveCount(0)
        await page.goto(`/portfolio?assignee=${workspace.owner_user_id}`)
        await expect(page.locator('[data-portfolio-account]')).toHaveCount(1)
        await expect(page.locator('[data-portfolio-account]')).toContainText(/1 blocked|1 bloquées/)
        await db.query("update workspace_tasks set status='done' where id=$1", [taskId])
        await page.reload()
        await expect(page.locator('[data-portfolio-account]')).toHaveCount(0)
        await page.goto('/portfolio?q=PORTFOLIO_')
        await expect(page.getByRole('combobox', { name: /Workspace actif|Active workspace/ })).toBeVisible()
        await page.screenshot({ path: test.info().outputPath(`portfolio-desktop-${locale}.png`), fullPage: true, caret: 'initial' })
        await page.setViewportSize({ width: 390, height: 844 })
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
        await page.screenshot({ path: test.info().outputPath(`portfolio-mobile-${locale}.png`), fullPage: true, caret: 'initial' })
        await db.query("update workspaces set access_state='grace' where id=$1", [workspaceId])
        await page.reload()
        await expect(page.locator('[data-portfolio-account]')).toHaveCount(25)
        await views.locator(':scope > summary').click()
        await expect(views.getByRole('button')).toHaveCount(0)
        await db.query("update workspaces set access_state='internal' where id=$1", [workspaceId])
        const reader = await browser.newContext({ baseURL: process.env.PLAYWRIGHT_BASE_URL, storageState: process.env.PLAYWRIGHT_CLIENT_STORAGE_STATE })
        try {
          const clientPage = await reader.newPage(); await clientPage.goto('/portfolio?q=PORTFOLIO_')
          await expect(clientPage).not.toHaveURL(/\/portfolio/)
          await expect(clientPage.locator('[data-portfolio-account]')).toHaveCount(0)
        } finally { await reader.close() }
        const anonymous = await browser.newContext({ baseURL: process.env.PLAYWRIGHT_BASE_URL })
        try { const signedOut = await anonymous.newPage(); await signedOut.goto('/portfolio?q=PORTFOLIO_'); await expect(signedOut).toHaveURL(/sign-in/) } finally { await anonymous.close() }
        expect(errors).toEqual([])
        console.log(JSON.stringify({ locale, developmentStyleViolations, applicationErrors: errors.length }))
      } finally {
        await context.close()
        await db.query('delete from portfolio_views where workspace_id=$1 and name like $2', [workspaceId, 'PORTFOLIO_%'])
        await db.query('delete from workspace_tasks where workspace_id=$1 and created_by=$2', [workspaceId, marker])
        await db.query('delete from clients where id=any($1::uuid[])', [ids])
        await db.query("update workspaces set locale='fr',access_state='internal' where id=$1", [workspaceId])
      }
    })
  })
}
