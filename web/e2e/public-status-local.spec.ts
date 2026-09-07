import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { Client } from 'pg'

if (process.env.PLAYWRIGHT_LOCAL_FIXTURE === '1') {
  const connectionString = process.env.DATABASE_SYSTEM_URL!, url = new URL(connectionString)
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || !url.pathname.startsWith('/yodev_test')) throw new Error('Disposable database required')
  const db = new Client({ connectionString }), author = 'public-status-browser'
  test.describe.serial('truthful public status', () => {
    test.setTimeout(120_000)
    test.beforeAll(() => db.connect())
    test.afterAll(() => db.end())
    for (const locale of ['fr', 'en'] as const) test(`shows unknown health and complete incident history in ${locale}`, async ({ browser }) => {
      const activeId = randomUUID(), privateId = randomUUID()
      const context = await browser.newContext({ baseURL: process.env.PLAYWRIGHT_BASE_URL, viewport: { width: locale === 'fr' ? 390 : 1440, height: 900 } })
      await context.addCookies([{ name: 'yodev_locale', value: locale, url: process.env.PLAYWRIGHT_BASE_URL! }, { name: 'yodev_cookie_consent', value: 'rejected', url: process.env.PLAYWRIGHT_BASE_URL! }])
      const page = await context.newPage(), errors: string[] = []
      page.on('pageerror', (error) => errors.push(error.message))
      try {
        await page.goto('/status')
        await expect(page.getByRole('heading', { name: /État du service non vérifié|Service health unverified/ })).toBeVisible()
        await expect(page.getByText(/Système opérationnel|All systems operational|^Operational$|^Opérationnel$/)).toHaveCount(0)
        await page.screenshot({ path: test.info().outputPath(`status-unknown-${locale}.png`), fullPage: true })
        await db.query("insert into platform_incidents(created_by,title_fr,title_en,component,impact,status,created_at,started_at) select $1,'Résolu '||n,'Resolved '||n,'email','degraded','resolved',now()-interval '1 day'+n*interval '1 microsecond',now()-interval '1 day' from generate_series(1,101) n", [author])
        await db.query("insert into platform_incidents(id,created_by,title_fr,title_en,component,impact,status,created_at,started_at) values($1,$2,'Ancien incident actif','Old active incident','google_ads','major_outage','investigating',now()-interval '400 days',now()-interval '400 days')", [activeId, author])
        await db.query("insert into platform_incidents(id,created_by,title_fr,title_en,component,impact,status,public) values($1,$2,'Privé','Private','email','major_outage','investigating',false)", [privateId, author])
        await db.query("insert into platform_incident_updates(incident_id,created_by,status,message_fr,message_en,created_at) select $1,$2,'investigating','MESSAGE_'||n,'MESSAGE_'||n,now()-interval '1 day'+n*interval '1 microsecond' from generate_series(1,701) n", [activeId, author])
        await page.reload()
        await expect(page.getByRole('heading', { name: /Incident majeur|Major outage/ })).toBeVisible()
        await expect(page.locator('[data-public-incident]')).toHaveCount(25)
        await expect(page.getByText(/25 affichés · 102 résultats|25 shown · 102 results/)).toBeVisible()
        await page.getByRole('link', { name: /^(Actifs|Active)$/ }).click()
        await expect(page.locator('[data-public-incident]')).toHaveCount(1)
        await expect(page.locator('[data-public-incident-update]')).toHaveCount(3)
        await expect(page.getByText('MESSAGE_701', { exact: true })).toBeVisible()
        await page.getByRole('link', { name: /3 derniers messages|Latest 3 updates/ }).click()
        await expect(page.locator('[data-public-incident-update]')).toHaveCount(25)
        await page.getByRole('link', { name: /Résultats plus anciens|Older results/ }).click()
        await expect(page.getByText('MESSAGE_676', { exact: true })).toBeVisible()
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
        await page.screenshot({ path: test.info().outputPath(`status-history-${locale}.png`), fullPage: true })
        await page.goto('/status?cursor=forged')
        await expect(page.getByRole('alert')).toBeVisible()
        await expect(page.getByRole('heading', { name: /Incident majeur|Major outage/ })).toBeVisible()
        expect((await page.goto(`/status/${privateId}`))?.status()).toBe(404)
        expect((await page.goto('/status/invalid'))?.status()).toBe(404)
        expect(errors).toEqual([])
      } finally { await context.close(); await db.query('delete from platform_incidents where created_by=$1', [author]) }
    })
  })
}
