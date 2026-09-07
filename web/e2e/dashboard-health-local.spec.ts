import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { Client } from 'pg'
import { reportCalendarWindow } from '../src/lib/calendar-window'

if (process.env.PLAYWRIGHT_LOCAL_FIXTURE === '1') {
  const connectionString = process.env.DATABASE_SYSTEM_URL!, url = new URL(connectionString)
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || !url.pathname.startsWith('/yodev_test')) throw new Error('Disposable database required')
  const db = new Client({ connectionString }), workspaceId = '80000000-0000-4000-8000-000000000001'
  const clientId = '80000000-0000-4000-8000-000000000092', otherId = '80000000-0000-4000-8000-000000000093'
  test.describe.serial('qualified cockpit health', () => {
    test.setTimeout(120_000)
    test.beforeAll(() => db.connect())
    test.afterAll(() => db.end())
    for (const locale of ['fr', 'en'] as const) test(`counts all alerts and refuses unqualified scores in ${locale}`, async ({ browser }) => {
      const agentId = randomUUID()
      await db.query('update workspaces set access_state=$1,plan=$2,locale=$3 where id=$4', ['internal', 'internal', locale, workspaceId])
      await db.query('insert into clients(id,workspace_id,google_customer_id,name,currency_code,timezone) values($1,$3,$4,$6,$7,$8),($2,$3,$5,$6,$7,$8)', [clientId, otherId, workspaceId, '8000000092', '8000000093', 'Cockpit fixture', 'EUR', 'Europe/Paris'])
      await db.query("insert into monitoring_agents(id,workspace_id,created_by,name,kind,description,threshold) values($1,$2,'fixture','Cockpit monitor','budget_guard','Fixture','1')", [agentId, workspaceId])
      await db.query("insert into alert_incidents(workspace_id,client_id,agent_id,fingerprint,title,description,severity,status) select $1,$2,$3,'cockpit-'||n,'Fixture','Fixture',case when n<=2 then 'critical' else 'warning' end,case when n=2 then 'reopened' else 'open' end from generate_series(1,521) n", [workspaceId, clientId, agentId])
      await db.query("insert into alert_incidents(workspace_id,client_id,agent_id,fingerprint,title,description,severity,status,detected_at) select $1,$2,$3,'foreign-'||n,'Fixture','Fixture','critical','open',now()+interval '1 hour' from generate_series(1,301) n", [workspaceId, otherId, agentId])
      const periodWindow = reportCalendarWindow({ period: '30', now: new Date(), timezone: 'Europe/Paris' })
      const campaign = { id: '123', name: 'QUALIFIED_CAMPAIGN', resourceName: 'customers/8000000092/campaigns/123', status: 'ENABLED', channel: 'SEARCH', impressions: '1000', clicks: '100', costMicros: '1000000', conversions: 1, conversionValueMicros: '2000000', budgetMicros: '1000000', budgetResourceName: 'customers/8000000092/campaignBudgets/1' }
      const coverage = { version: 1, queries: [{ queryHash: 'a'.repeat(64), rows: 1, pages: 1, bytes: 1000, limit: 500, state: 'query_complete' }] }
      await db.query('insert into analytical_collections(workspace_id,client_id,family,contract_version,period_from,period_through,timezone,currency_code,source_version,observed_at,payload,coverage) values($1,$2,$3,1,$4,$5,$6,$7,$8,now(),$9,$10)', [workspaceId, clientId, 'campaigns', periodWindow.from, periodWindow.through, 'Europe/Paris', 'EUR', randomUUID(), JSON.stringify([campaign]), JSON.stringify(coverage)])
      const context = await browser.newContext({ baseURL: process.env.PLAYWRIGHT_BASE_URL, storageState: process.env.PLAYWRIGHT_OWNER_STORAGE_STATE, viewport: { width: locale === 'fr' ? 390 : 1440, height: 900 } })
      const page = await context.newPage(), errors: string[] = []
      page.on('pageerror', (error) => errors.push(error.message))
      try {
        await page.goto(`/dashboard?client=${clientId}`)
        const consent = page.getByRole('button', { name: /Continuer sans mesure|Continue without/ })
        if (await consent.isVisible()) await consent.click()
        await expect(page.locator('[data-dashboard-score]')).toHaveText('84 / 100')
        await expect(page.locator('[data-dashboard-alerts]')).toHaveText('521')
        await expect(page.getByRole('link', { name: /Ouvrir le centre d’alertes|Open alert center/ })).toHaveAttribute('href', `/alerts?client=${clientId}`)
        for (const state of ['stale', 'limited', 'unknown'] as const) {
          await db.query('update analytical_collections set observed_at=$1,coverage=$2 where client_id=$3', [state === 'stale' ? new Date(Date.now() - 27 * 3600_000) : new Date(), state === 'unknown' ? null : JSON.stringify(state === 'limited' ? { version: 1, queries: [{ ...coverage.queries[0], rows: 500, state: 'limit_reached' }] } : coverage), clientId])
          await page.reload()
          await expect(page.locator('[data-dashboard-score]')).toHaveText('— / 100')
          await expect(page.locator('[data-dashboard-alerts]')).toHaveText('521')
          await expect(page.getByText('QUALIFIED_CAMPAIGN', { exact: true }).first()).toBeVisible()
        }
        await db.query('delete from analytical_collections where client_id=$1', [clientId])
        await page.reload()
        await expect(page.getByRole('heading', { name: /Collecte en attente|Collection pending/ })).toBeVisible()
        await expect(page.locator('[data-dashboard-alerts]')).toHaveText('521')
        await expect(page.locator('[data-dashboard-score]')).toHaveText('— / 100')
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
        await page.screenshot({ path: test.info().outputPath(`cockpit-unqualified-${locale}.png`), fullPage: true })
        await page.locator('[data-dashboard-score]').scrollIntoViewIfNeeded()
        await page.screenshot({ path: test.info().outputPath(`cockpit-score-${locale}.png`) })
        await page.goto(`/dashboard?client=${otherId}`)
        await expect(page.locator('[data-dashboard-alerts]')).toHaveText('301')
        expect(errors).toEqual([])
      } finally {
        await context.close()
        await db.query('delete from clients where id=any($1::uuid[])', [[clientId, otherId]])
        await db.query('delete from monitoring_agents where id=$1', [agentId])
      }
    })
  })
}
