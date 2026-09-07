import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { Client } from 'pg'
import { reportCalendarWindow } from '../src/lib/calendar-window'

if (process.env.PLAYWRIGHT_LOCAL_FIXTURE === '1') {
  const connectionString = process.env.DATABASE_SYSTEM_URL!, url = new URL(connectionString)
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || !url.pathname.startsWith('/yodev_test')) throw new Error('Disposable database required')
  const db = new Client({ connectionString }), workspaceId = '80000000-0000-4000-8000-000000000001', clientId = '80000000-0000-4000-8000-000000000091'
  test.describe.serial('complete analytical collections', () => {
    test.setTimeout(120_000)
    test.beforeAll(() => db.connect())
    test.afterAll(() => db.end())
    for (const locale of ['fr', 'en'] as const) test(`browses, searches and exports all stored rows in ${locale}`, async ({ browser }) => {
      await db.query('update workspaces set access_state=$1,plan=$2,locale=$3 where id=$4', ['internal', 'internal', locale, workspaceId])
      await db.query('insert into clients(id,workspace_id,google_customer_id,name,currency_code,timezone) values($1,$2,$3,$4,$5,$6)', [clientId, workspaceId, '8000000091', 'Complete collection fixture', 'EUR', 'Europe/Paris'])
      const periodWindow = reportCalendarWindow({ period: '30', now: new Date(), timezone: 'Europe/Paris' }), version = randomUUID()
      const rows = Array.from({ length: 701 }, (_, index) => ({ key: String(index), label: `ANALYTIC_ROW_${String(index + 1).padStart(3, '0')}${index === 650 ? ' %_ Élan 🚀 ' + 'W'.repeat(90) : ''}`, impressions: '1000', clicks: '100', costMicros: '-123000000', conversions: 1.25, conversionValueMicros: '90071992547409931234567' }))
      const coverage = { version: 1, queries: [{ queryHash: 'a'.repeat(64), rows: 701, pages: 1, bytes: 100000, limit: null, state: 'query_complete' }] }
      await db.query('insert into analytical_collections(workspace_id,client_id,family,contract_version,period_from,period_through,timezone,currency_code,source_version,observed_at,payload,coverage) values($1,$2,$3,1,$4,$5,$6,$7,$8,now(),$9,$10)', [workspaceId, clientId, 'devices', periodWindow.from, periodWindow.through, 'Europe/Paris', 'EUR', version, JSON.stringify(rows), JSON.stringify(coverage)])
      const context = await browser.newContext({ baseURL: process.env.PLAYWRIGHT_BASE_URL, storageState: process.env.PLAYWRIGHT_OWNER_STORAGE_STATE, viewport: { width: locale === 'fr' ? 390 : 1440, height: 900 } })
      const page = await context.newPage(), errors: string[] = []
      page.on('pageerror', (error) => errors.push(error.message))
      try {
        await page.goto(`/insights?client=${clientId}`)
        const consent = page.getByRole('button', { name: /Continuer sans mesure|Continue without/ })
        if (await consent.isVisible()) await consent.click()
        await expect(page.getByText(/100\/701/)).toBeVisible()
        await page.getByRole('link', { name: /Parcourir, rechercher et exporter|Browse, search and export/ }).first().click()
        await expect(page).toHaveURL(/\/insights\/devices\?/)
        await expect(page.locator('[data-analytical-record]')).toHaveCount(25)
        await expect(page.getByRole('heading', { name: 'ANALYTIC_ROW_001', exact: true })).toBeVisible()
        await page.getByRole('link', { name: /^(Next page|Page suivante)$/ }).click()
        await expect(page.getByRole('heading', { name: 'ANALYTIC_ROW_026', exact: true })).toBeVisible()
        const oldPage = page.url()
        await page.getByRole('searchbox').fill('%_')
        await page.getByRole('button', { name: /^(Search|Rechercher)$/ }).click()
        await expect(page.locator('[data-analytical-record]')).toHaveCount(1)
        await expect(page.getByRole('heading', { name: /ANALYTIC_ROW_651/ })).toBeVisible()
        await page.getByText(locale === 'en' ? 'All collected details' : 'Tous les détails collectés', { exact: true }).click()
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
        const downloadPromise = page.waitForEvent('download')
        await page.getByRole('link', { name: /Exporter toute la collecte|Export complete collection/ }).click()
        const download = await downloadPromise, filename = await download.path()
        expect(filename).toBeTruthy()
        const document = JSON.parse(await readFile(filename!, 'utf8'))
        expect(document.sourceVersion).toBe(version)
        expect(document.records).toEqual(rows)
        await page.screenshot({ caret: 'initial', path: test.info().outputPath(`analytical-search-${locale}.png`), fullPage: true })
        await db.query('update analytical_collections set source_version=$1 where client_id=$2', [randomUUID(), clientId])
        await page.goto(oldPage)
        await expect(page.getByRole('alert')).toContainText(locale === 'en' ? 'collection changed' : 'collecte a changé')
        await expect(page.locator('[data-analytical-record]')).toHaveCount(0)
        expect((await context.request.get(`/insights/devices/export?client=${clientId}&version=${version}`)).status()).toBe(409)
        await page.goto(`/insights/devices?client=${clientId}&cursor=forged`)
        await expect(page.getByRole('alert')).toContainText(locale === 'en' ? 'invalid or expired' : 'invalide ou expiré')
        expect((await page.goto(`/insights/devices?client=80000000-0000-4000-8000-000000000099`))?.status()).toBe(404)
        expect((await context.request.get(`/insights/devices/export?client=80000000-0000-4000-8000-000000000099&version=${version}`)).status()).toBe(404)
        const anonymous = await browser.newContext({ baseURL: process.env.PLAYWRIGHT_BASE_URL })
        try { expect((await anonymous.request.get(`/insights/devices/export?client=${clientId}&version=${version}`)).status()).toBe(403) } finally { await anonymous.close() }
        expect(errors).toEqual([])
      } finally { await context.close(); await db.query('delete from clients where id=$1', [clientId]) }
    })
  })
}
