import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { Client } from 'pg'

if (process.env.PLAYWRIGHT_LOCAL_FIXTURE === '1') for (const [index, locale] of ['fr', 'en'].entries()) {
  test(`alert quality ${locale} reviews a specific observation without changing workflow`, async ({ browser }) => {
    const connectionString = process.env.DATABASE_SYSTEM_URL!, url = new URL(connectionString)
    if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || !url.pathname.startsWith('/yodev_test')) throw new Error('Disposable database required')
    const db = new Client({ connectionString }), workspaceId = '80000000-0000-4000-8000-000000000001'
    const [clientId, agentId, incidentId] = [randomUUID(), randomUUID(), randomUUID()], marker = `QUALITY_${randomUUID()}`
    await db.connect()
    const original = (await db.query('select access_state,plan,locale from workspaces where id=$1', [workspaceId])).rows[0]
    const context = await browser.newContext({ baseURL: process.env.PLAYWRIGHT_BASE_URL, storageState: process.env.PLAYWRIGHT_OWNER_STORAGE_STATE, viewport: { width: locale === 'fr' ? 390 : 1440, height: 950 }, extraHTTPHeaders: { 'x-forwarded-for': `198.18.32.${index + 1}` } })
    await context.addCookies([{ name: 'yodev_cookie_consent', value: 'rejected', url: process.env.PLAYWRIGHT_BASE_URL! }])
    let reader: Awaited<ReturnType<typeof browser.newContext>> | undefined
    try {
      await db.query("update workspaces set access_state='internal',plan='internal',locale=$1 where id=$2", [locale, workspaceId])
      await db.query("insert into clients(id,workspace_id,google_customer_id,name) values($1,$2,'8000000088','Quality review account')", [clientId, workspaceId])
      await db.query("insert into monitoring_agents(id,workspace_id,created_by,kind,name,description,threshold) values($1,$2,'fixture','no_delivery','Quality review monitor','Fixture',1)", [agentId, workspaceId])
      await db.query("insert into alert_incidents(id,workspace_id,client_id,agent_id,fingerprint,title,description) values($1,$2,$3,$4,$5,$5,'Review fixture')", [incidentId, workspaceId, clientId, agentId, marker])
      await db.query("insert into alert_incidents(workspace_id,client_id,agent_id,fingerprint,title,description,quality_label,quality_occurrence,quality_version,quality_reviewed_by,quality_reviewed_at,created_at) select $1,$2,$3,$4||n,$4||n,'Fixture',case when n<=15 then 'noise' end,case when n<=15 then 1 end,case when n<=15 then 1 else 0 end,case when n<=15 then 'fixture' end,case when n<=15 then now() end,now()-interval '1 day' from generate_series(1,30) n", [workspaceId, clientId, agentId, marker])
      const page = await context.newPage(), errors: string[] = []
      page.on('pageerror', (error) => errors.push(error.message))
      await page.goto(`/alerts?id=${incidentId}`)
      const review = page.getByRole('region', { name: /^(Alert quality review|Qualité de l’alerte)$/ })
      const choose = review.getByRole('combobox', { name: /Your assessment|Votre évaluation/ })
      const save = review.getByRole('button', { name: /Save assessment|Enregistrer l’avis/ })
      await expect(review).toHaveAttribute('data-alert-quality-state', 'unreviewed')
      await choose.selectOption('useful'); await save.click()
      await expect(review).toHaveAttribute('data-alert-quality-state', 'current')
      let row = (await db.query('select quality_label,quality_version,status,occurrence_count from alert_incidents where id=$1', [incidentId])).rows[0]
      expect(row).toMatchObject({ quality_label: 'useful', quality_version: 1, status: 'open', occurrence_count: 1 })
      await db.query('update alert_incidents set occurrence_count=2 where id=$1', [incidentId])
      await choose.selectOption('noise'); await save.click()
      await expect(page).toHaveURL(/error=/)
      await expect(review).toHaveAttribute('data-alert-quality-state', 'stale')
      await expect(review.getByText(/nouvelle observation|new observation/)).toBeVisible()
      row = (await db.query('select quality_label,quality_version from alert_incidents where id=$1', [incidentId])).rows[0]
      expect(row).toEqual({ quality_label: 'useful', quality_version: 1 })
      await choose.selectOption('false_positive'); await save.click()
      await expect(review).toHaveAttribute('data-alert-quality-state', 'current')
      await page.goto(`/alerts?q=${marker}`)
      const summary = page.getByRole('region', { name: /Alert quality summary|Synthèse de qualité des alertes/ })
      await expect(summary.getByRole('heading')).toContainText('31')
      await expect(summary.locator('dl > div').filter({ has: page.getByText(/^(Bruit|Noise)$/) }).locator('dd')).toHaveText('15')
      await expect(summary.getByText(/16 (reviews|avis)/)).toBeVisible()
      await page.goto(`/alerts?id=${incidentId}`)
      await review.locator('summary').click()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
      await page.evaluate(() => window.scrollTo(0, 0))
      await page.screenshot({ path: test.info().outputPath(`alert-quality-${locale}.png`), fullPage: true, caret: 'initial' })
      await choose.selectOption('unreviewed'); await save.click()
      await expect(review).toHaveAttribute('data-alert-quality-state', 'unreviewed')
      row = (await db.query('select quality_label,quality_version,status from alert_incidents where id=$1', [incidentId])).rows[0]
      expect(row).toEqual({ quality_label: null, quality_version: 3, status: 'open' })
      expect((await db.query("select count(*)::int as count from audit_events where workspace_id=$1 and entity_id=$2 and action='monitoring.alert_quality_reviewed'", [workspaceId, incidentId])).rows[0].count).toBe(3)
      reader = await browser.newContext({ baseURL: process.env.PLAYWRIGHT_BASE_URL, storageState: process.env.PLAYWRIGHT_ANALYST_STORAGE_STATE, extraHTTPHeaders: { 'x-forwarded-for': `198.18.33.${index + 1}` } })
      const readPage = await reader.newPage()
      await readPage.goto(`/alerts?id=${incidentId}`)
      const readReview = readPage.getByRole('region', { name: /^(Alert quality review|Qualité de l’alerte)$/ })
      await expect(readReview).toBeVisible(); await expect(readReview.getByRole('combobox')).toHaveCount(0)
      await db.query("update workspaces set access_state='grace' where id=$1", [workspaceId])
      await page.reload()
      await expect(review).toBeVisible(); await expect(review.getByRole('combobox')).toHaveCount(0)
      expect(errors).toEqual([])
    } finally {
      await context.close(); await reader?.close()
      await db.query("delete from audit_events where workspace_id=$1 and entity_id=$2 and action='monitoring.alert_quality_reviewed'", [workspaceId, incidentId])
      await db.query('delete from monitoring_agents where id=$1', [agentId])
      await db.query('delete from clients where id=$1', [clientId])
      await db.query('update workspaces set access_state=$1,plan=$2,locale=$3 where id=$4', [original.access_state, original.plan, original.locale, workspaceId])
      await db.end()
    }
  })
}
