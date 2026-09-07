import { expect, test, type Browser } from '@playwright/test'
import { Client } from 'pg'
import { accountCalendarDate, calendarDates, reportCalendarWindow, shiftCalendarDate } from '../src/lib/calendar-window'

// State-changing checks only run against the disposable local fixture.
if (process.env.PLAYWRIGHT_LOCAL_FIXTURE === '1') {
  const connectionString = process.env.DATABASE_SYSTEM_URL!
  const url = new URL(connectionString)
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || !url.pathname.startsWith('/yodev_test')) throw new Error('Local disposable browser database required')
  const workspaceId = '80000000-0000-4000-8000-000000000001'
  const db = new Client({ connectionString })
  async function pageFor(browser: Browser, role: string, width = 1280) {
    const context = await browser.newContext({ baseURL: process.env.PLAYWRIGHT_BASE_URL, storageState: process.env[`PLAYWRIGHT_${role.toUpperCase()}_STORAGE_STATE`], viewport: { width, height: 844 } })
    return { context, page: await context.newPage() }
  }
  test.describe.serial('local production readiness regression journeys', () => {
    test.setTimeout(120_000)
    test.beforeAll(async () => { await db.connect() })
    test.afterAll(async () => {
      await db.query('update workspaces set access_state=$1, locale=$2 where id=$3', ['internal', 'fr', workspaceId])
      await db.end()
    })
    for (const locale of ['fr', 'en']) test(`managed account selection preserves priorities and enforces quota in ${locale}`, async ({ browser }) => {
      const ids = Array.from({ length: 5 }, (_, index) => `80000000-0000-4000-8000-00000000001${index}`)
      await db.query('update workspaces set access_state=$1, plan=$2, locale=$3 where id=$4', ['active', 'agency', locale, workspaceId])
      for (const [index, id] of ids.entries()) await db.query('insert into clients(id,workspace_id,google_customer_id,name,currency_code,timezone,active,managed_selected,management_priority,google_accessible) values($1,$2,$3,$4,$5,$6,$7,$8,$9,true)', [id, workspaceId, String(8000000010 + index), `Selection ${String.fromCharCode(65 + index)}`, 'EUR', 'Europe/Paris', index < 4, index < 4, index])
      const inventoryIds = Array.from({ length: 26 }, (_, index) => `81000000-0000-4000-8000-${String(index).padStart(12, '0')}`)
      for (const [index, id] of inventoryIds.entries()) await db.query('insert into clients(id,workspace_id,google_customer_id,name,active,managed_selected,google_accessible) values($1,$2,$3,$4,false,false,true)', [id, workspaceId, String(8100000000 + index), `Z inventory ${String(index).padStart(2, '0')}`])
      const { page, context } = await pageFor(browser, 'owner', locale === 'fr' ? 390 : 1440)
      const errors: string[] = []
      page.on('pageerror', (error) => errors.push(error.message))
      try {
        await page.goto('/billing')
        await expect(page.getByText(locale === 'en' ? '1 accounts would pause' : '1 comptes seraient mis en pause', { exact: true })).toBeVisible()
        await db.query('update workspaces set plan=$1 where id=$2', ['solo', workspaceId])
        await db.query('update clients set active=false where id=$1', [ids[3]])
        await page.goto('/accounts')
        const consent = page.getByRole('button', { name: /Continuer sans mesure|Continue without/ })
        if (await consent.isVisible()) { await consent.click(); await expect(consent).toBeHidden() }
        await page.getByRole('button', { name: locale === 'en' ? 'Next' : 'Suivant', exact: true }).click()
        await expect(page.getByRole('navigation', { name: locale === 'en' ? 'Inventory pages' : 'Pages de l’inventaire' })).toContainText('2 / 2')
        await page.getByRole('textbox', { name: locale === 'en' ? 'Search by name or account ID' : 'Rechercher par nom ou identifiant' }).fill('Selection')
        await expect(page.getByRole('navigation', { name: locale === 'en' ? 'Inventory pages' : 'Pages de l’inventaire' })).toContainText('1 / 1')
        await page.getByRole('textbox', { name: locale === 'en' ? 'Search by name or account ID' : 'Rechercher par nom ou identifiant' }).press('Enter')
        await expect(page).toHaveURL(/\/accounts$/)
        await expect(page.getByRole('button', { name: locale === 'en' ? 'Save selection' : 'Enregistrer la sélection', exact: true })).toBeDisabled()
        for (let index = 0; index < 3; index++) await page.getByRole('button', { name: `${locale === 'en' ? 'Move up' : 'Monter'} Selection D`, exact: true }).click()
        await page.getByRole('button', { name: locale === 'en' ? 'Save priorities only' : 'Enregistrer uniquement les priorités', exact: true }).click()
        await expect(page).toHaveURL(/selection=saved/)
        const active = await db.query('select id from clients where workspace_id=$1 and active and not is_manager order by management_priority', [workspaceId])
        expect(active.rows.map((row) => row.id)).toEqual([ids[3], ids[0], ids[1]])
        await expect(page.getByRole('checkbox', { name: 'Selection E', exact: true })).toBeDisabled()
        const previousVersion = await page.locator('input[name=version]').inputValue()
        await page.getByRole('button', { name: `${locale === 'en' ? 'Remove' : 'Retirer'} Selection C`, exact: true }).click()
        await page.getByRole('button', { name: locale === 'en' ? 'Save selection' : 'Enregistrer la sélection', exact: true }).click()
        await expect(page.getByText(locale === 'en' ? 'Selection saved.' : 'Sélection enregistrée.', { exact: true })).toBeVisible()
        await expect(page.locator('input[name=version]')).not.toHaveValue(previousVersion)
        expect((await db.query('select count(*) from clients where workspace_id=$1 and managed_selected and not is_manager', [workspaceId])).rows[0].count).toBe('3')
        // A concurrent administrator changes the effective plan after this page loaded.
        await db.query('update workspaces set plan=$1 where id=$2', ['studio', workspaceId])
        await page.getByRole('button', { name: locale === 'en' ? 'Save selection' : 'Enregistrer la sélection', exact: true }).click()
        await expect(page).toHaveURL(/selection=conflict/)
        await expect(page.getByText(/Your selection was not saved|Votre sélection n’a pas été enregistrée/)).toBeVisible()
        await page.getByRole('checkbox', { name: 'Selection E', exact: true }).check()
        await page.getByRole('button', { name: locale === 'en' ? 'Save selection' : 'Enregistrer la sélection', exact: true }).click()
        await expect(page).toHaveURL(/selection=saved/)
        expect((await db.query('select active,managed_selected from clients where id=$1', [ids[4]])).rows[0]).toEqual({ active: true, managed_selected: true })
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
        await page.getByRole('textbox', { name: locale === 'en' ? 'Search by name or account ID' : 'Rechercher par nom ou identifiant' }).fill('Selection')
        await expect(page.getByRole('button', { name: locale === 'en' ? 'Next' : 'Suivant', exact: true })).toBeDisabled()
        await page.evaluate(() => window.scrollTo(0, 0))
        await page.screenshot({ path: test.info().outputPath(`account-selection-${locale}-${locale === 'fr' ? 390 : 1440}.png`), fullPage: true })
        const analyst = await pageFor(browser, 'analyst')
        try {
          await analyst.page.goto('/accounts')
          await expect(analyst.page.getByRole('checkbox')).toHaveCount(0)
          await expect(analyst.page.getByRole('button', { name: /Save selection|Enregistrer la sélection|Move up|Monter/ })).toHaveCount(0)
          await expect(analyst.page.getByRole('link', { name: /Manage connection|Gérer la connexion/ })).toHaveCount(0)
        } finally { await analyst.context.close() }
        expect(errors).toEqual([])
      } finally {
        await context.close()
        await db.query('delete from clients where id=any($1::uuid[])', [[...ids, ...inventoryIds]])
        await db.query('update workspaces set access_state=$1,plan=$2 where id=$3', ['internal', 'internal', workspaceId])
      }
    })

    for (const locale of ['fr', 'en']) test(`pacing uses covered completed days and hides forecasts with a gap in ${locale}`, async ({ browser }) => {
      const clientId = '80000000-0000-4000-8000-000000000004'
      await db.query('update workspaces set access_state=$1, locale=$2 where id=$3', ['internal', locale, workspaceId])
      await db.query('delete from clients where id=$1', [clientId])
      await db.query('insert into clients(id,workspace_id,google_customer_id,name,currency_code,timezone) values($1,$2,$3,$4,$5,$6)', [clientId, workspaceId, '8000000004', 'History fixture', 'EUR', 'Europe/Paris'])
      await db.query('insert into client_goals(workspace_id,client_id,monthly_budget_micros,primary_kpi) values($1,$2,$3,$4)', [workspaceId, clientId, '300000000', 'cpa'])
      const today = accountCalendarDate(new Date(), 'Europe/Paris')
      const expectedDays = Number(today.slice(-2)) - 1
      const dates = expectedDays ? calendarDates({ from: `${today.slice(0, 7)}-01`, through: shiftCalendarDate(today, -1) }) : []
      for (const date of dates) await db.query('insert into daily_account_metrics(workspace_id,client_id,metric_date,currency_code,cost_micros,timezone,coverage_status,source_version) values($1,$2,$3,$4,$5,$6,$7,$8)', [workspaceId, clientId, date, 'EUR', '10000000', 'Europe/Paris', 'complete', 'browser-history'])
      const { page, context } = await pageFor(browser, 'owner', 1440)
      const errors: string[] = []
      page.on('pageerror', (error) => errors.push(error.message))
      try {
        expect((await page.goto(`/dashboard?client=${clientId}`))?.status()).toBe(200)
        const consent = page.getByRole('button', { name: /Continuer sans mesure|Continue without/ })
        if (await consent.isVisible()) { await consent.click(); await expect(consent).toBeHidden() }
        const spend = page.locator('[data-slot="card"]').filter({ has: page.getByText(locale === 'en' ? 'MTD spend' : 'Dépense MTD', { exact: true }) }).last()
        const forecast = page.locator('[data-slot="card"]').filter({ has: page.getByText(locale === 'en' ? 'End-of-month forecast' : 'Forecast fin de mois', { exact: true }) }).last()
        await expect(spend).toContainText(`${expectedDays}/${expectedDays}`)
        if (expectedDays) {
          await expect(forecast.locator('p.text-2xl')).not.toHaveText('—')
          await db.query('update daily_account_metrics set coverage_status=$1 where client_id=$2 and metric_date=$3', ['legacy', clientId, dates[0]])
          await page.reload()
          await expect(spend).toContainText(`${expectedDays - 1}/${expectedDays}`)
        }
        await expect(spend.locator('p.text-2xl')).toHaveText('—')
        await expect(forecast.locator('p.text-2xl')).toHaveText('—')
        await expect(page.getByText(locale === 'en' ? 'Daily collection required' : 'Collecte journalière requise', { exact: true })).toBeVisible()
        await page.screenshot({ path: test.info().outputPath(`pacing-gap-${locale}-1440.png`), fullPage: true })
        expect(errors).toEqual([])
      } finally {
        await context.close()
        await db.query('delete from clients where id=$1', [clientId])
      }
    })

    for (const locale of ['fr', 'en']) test(`stored analytics remain available without Google and during grace in ${locale}`, async ({ browser }) => {
      const clientId = '80000000-0000-4000-8000-000000000005'
      await db.query('update workspaces set access_state=$1, locale=$2 where id=$3', ['internal', locale, workspaceId])
      await db.query('delete from clients where id=$1', [clientId])
      await db.query('insert into clients(id,workspace_id,google_customer_id,name,currency_code,timezone) values($1,$2,$3,$4,$5,$6)', [clientId, workspaceId, '8000000005', 'Stored analysis fixture', 'EUR', 'Europe/Paris'])
      const window = reportCalendarWindow({ period: '30', now: new Date(), timezone: 'Europe/Paris' })
      await db.query(`insert into daily_account_metrics(workspace_id,client_id,metric_date,currency_code,timezone,coverage_status,source_version,cost_micros)
        select $1,$2,to_char(day,'YYYY-MM-DD'),'EUR','Europe/Paris','complete','browser-account-history',case when day=$3::date then 456000000 else 0 end
        from generate_series($3::date,$4::date,interval '1 day') day`, [workspaceId, clientId, window.from, window.through])
      const campaign = { id: '42', name: 'Stored brand campaign', status: 'ENABLED', channelType: 'SEARCH', budgetResourceName: 'customers/8000000005/campaignBudgets/1', budgetMicros: '10000000', costMicros: '123000000', clicks: '200', impressions: '1000', conversions: 12, conversionValueMicros: '500000000', searchBudgetLostImpressionShare: null, searchRankLostImpressionShare: null }
      const datasets = { campaigns: [campaign], searchTerms: [], keywords: [], ads: [], tracking: { status: 'MANAGED_BY_THIS_CUSTOMER', managerCustomer: null, acceptedCustomerDataTerms: true, enhancedConversionsForLeadsEnabled: true }, devices: [{ key: 'MOBILE', label: 'MOBILE', impressions: '1000', clicks: '200', costMicros: '123000000', conversions: 12, conversionValueMicros: '500000000' }] }
      for (const [family, payload] of Object.entries(datasets)) await db.query('insert into analytical_collections(workspace_id,client_id,family,contract_version,period_from,period_through,timezone,currency_code,source_version,observed_at,payload) values($1,$2,$3,1,$4,$5,$6,$7,$8,now(),$9)', [workspaceId, clientId, family, window.from, window.through, 'Europe/Paris', 'EUR', clientId, JSON.stringify(payload)])
      const { page, context } = await pageFor(browser, 'owner', 1440)
      const errors: string[] = []
      page.on('pageerror', (error) => errors.push(error.message))
      try {
        for (const state of ['internal', 'grace']) {
          await db.query('update workspaces set access_state=$1 where id=$2', [state, workspaceId])
          expect((await page.goto(`/dashboard?client=${clientId}`))?.status()).toBe(200)
          await expect(page.getByText('Stored brand campaign', { exact: true })).toBeVisible()
          const spendCard = page.locator('[data-slot="card"]').filter({ has: page.getByText(locale === 'en' ? 'Spend' : 'Investissement', { exact: true }) })
          await expect(spendCard).toContainText('456')
          await expect(spendCard).toContainText('30/30')
          await expect(page.getByRole('region', { name: /Synchronisation des données|Data synchronization/ })).toContainText('6/17')
          await expect(page.getByRole('button', { name: /Actualiser les données|Refresh data/ })).toHaveCount(0)
          expect((await page.goto(`/analysis?client=${clientId}`))?.status()).toBe(200)
          await expect(page.getByText(locale === 'en' ? 'Opportunity score' : 'Score d’opportunité', { exact: true })).toBeVisible()
          expect((await page.goto(`/insights?client=${clientId}`))?.status()).toBe(200)
          await expect(page.getByRole('cell', { name: 'MOBILE', exact: true })).toBeVisible()
        }
        await db.query(`update analytical_collections set observed_at=now()-interval '3 days' where client_id=$1`, [clientId])
        await page.reload()
        await page.getByText(locale === 'en' ? 'Collection details' : 'Détail des collectes', { exact: true }).click()
        await expect(page.getByText(locale === 'en' ? 'Devices · Older data' : 'Appareils · Données anciennes', { exact: true })).toBeVisible()
        await expect(page.getByRole('cell', { name: 'MOBILE', exact: true })).toBeVisible()
        const consent = page.getByRole('button', { name: /Continuer sans mesure|Continue without/ })
        if (await consent.isVisible()) { await consent.click(); await expect(consent).toBeHidden() }
        await page.screenshot({ path: test.info().outputPath(`stored-insights-${locale}-1440.png`), fullPage: true })
        expect(errors).toEqual([])
      } finally {
        await context.close()
        await db.query('delete from clients where id=$1', [clientId])
      }
    })

    if (process.env.PLAYWRIGHT_ANALYTICS_CONTROLS === '1') for (const locale of ['fr', 'en']) test(`analytical refresh enqueues once and handles revoked connections in ${locale}`, async ({ browser }) => {
      const clientId = '80000000-0000-4000-8000-000000000006'
      const connectionId = '80000000-0000-4000-8000-000000000007'
      await db.query('update workspaces set access_state=$1, locale=$2 where id=$3', ['internal', locale, workspaceId])
      await db.query('insert into clients(id,workspace_id,google_customer_id,name,currency_code,timezone) values($1,$2,$3,$4,$5,$6)', [clientId, workspaceId, '8000000006', 'Refresh fixture', 'EUR', 'Europe/Paris'])
      await db.query('insert into google_ads_connections(id,workspace_id,manager_customer_id,encrypted_refresh_token,connected_by) values($1,$2,$3,$4,$5)', [connectionId, workspaceId, '8000000007', 'invalid-fixture-token-cannot-be-decrypted', 'browser-fixture'])
      const { page, context } = await pageFor(browser, 'owner', 1440)
      const errors: string[] = []
      page.on('pageerror', (error) => errors.push(error.message))
      const readJobs = () => db.query(`select type,status from jobs where workspace_id=$1 and payload->>'clientId'=$2`, [workspaceId, clientId])
      try {
        await page.goto(`/dashboard?client=${clientId}`)
        const consent = page.getByRole('button', { name: /Continuer sans mesure|Continue without/ })
        if (await consent.isVisible()) { await consent.click(); await expect(consent).toBeHidden() }
        const refresh = page.getByRole('button', { name: /Actualiser les données|Refresh data/ })
        await refresh.click()
        await expect(page).toHaveURL(/sync=queued/)
        await expect(page.getByRole('region', { name: /Synchronisation des données|Data synchronization/ })).toContainText(locale === 'en' ? 'Collection queued.' : 'Collecte planifiée.')
        await expect(refresh).toBeDisabled()
        expect((await readJobs()).rows).toHaveLength(18)
        await refresh.evaluate((element) => (element as HTMLButtonElement).form!.requestSubmit())
        await expect(page).toHaveURL(/sync=pending/)
        expect((await readJobs()).rows).toHaveLength(18)
        const analyst = await pageFor(browser, 'analyst', 1440)
        try {
          await analyst.page.goto(`/dashboard?client=${clientId}`)
          await expect(analyst.page.getByRole('button', { name: /Actualiser les données|Refresh data/ })).toHaveCount(0)
          await expect(analyst.page.getByRole('region', { name: /Synchronisation des données|Data synchronization/ }).getByRole('link', { name: /Connexion|Connection/ })).toHaveCount(0)
        } finally { await analyst.context.close() }
        await db.query(`delete from jobs where workspace_id=$1 and payload->>'clientId'=$2`, [workspaceId, clientId])
        await db.query('update google_ads_connections set status=$1 where id=$2', ['revoked', connectionId])
        await page.goto(`/dashboard?client=${clientId}`)
        await refresh.click()
        await expect(page).toHaveURL(/sync=unavailable/)
        await expect(page.getByRole('region', { name: /Synchronisation des données|Data synchronization/ })).toContainText(locale === 'en' ? 'Collection unavailable.' : 'Collecte indisponible.')
        expect((await readJobs()).rows).toHaveLength(0)
        expect(errors).toEqual([])
      } finally {
        await context.close()
        await db.query('delete from google_ads_connections where id=$1', [connectionId])
        await db.query('delete from clients where id=$1', [clientId])
      }
    })

    test('grace permits stored views while hiding mutations', async ({ browser }) => {
      await db.query('update workspaces set access_state=$1 where id=$2', ['grace', workspaceId])
      for (const role of ['owner', 'analyst']) {
        const { page, context } = await pageFor(browser, role)
        try {
          for (const path of ['/accounts', '/history', '/alerts', '/tasks', '/approvals', '/reports']) {
            expect((await page.goto(path))?.status()).toBe(200)
            await expect(page).toHaveURL(new RegExp(`${path}$`))
            await expect(page.locator('main')).toBeVisible()
            await expect(page.getByRole('button', { name: /Générer le lien|Analyser maintenant|Créer une tâche|Approuver/ })).toHaveCount(0)
          }
          if (role === 'owner') expect((await page.goto('/audit'))?.status()).toBe(200)
        } finally { await context.close() }
      }
    })
    test('suspended members have an accessible recovery destination without redirect loops', async ({ browser }) => {
      await db.query('update workspaces set access_state=$1 where id=$2', ['suspended', workspaceId])
      for (const role of ['owner', 'admin', 'client']) {
        const { page, context } = await pageFor(browser, role)
        try {
          expect((await page.goto('/dashboard'))?.status()).toBe(200)
          await expect(page).toHaveURL(role === 'owner' ? /\/billing\?/ : /\/support\?/)
          await expect(page.locator('main')).toBeVisible()
        } finally { await context.close() }
      }
    })
    for (const locale of ['fr', 'en']) for (const width of [390, 768]) {
      test(`full navigation and workspace selection work at ${width}px in ${locale}`, async ({ browser }) => {
        await db.query('update workspaces set access_state=$1, locale=$2 where id=$3', ['internal', locale, workspaceId])
        const { page, context } = await pageFor(browser, 'owner', width)
        try {
          await page.goto('/dashboard')
          const consent = page.getByRole('button', { name: /Continuer sans mesure|Continue without/ })
          if (await consent.isVisible()) { await consent.click(); await expect(consent).toBeHidden() }
          await expect(page.getByRole('combobox', { name: /Workspace actif|Active workspace/ })).toBeVisible()
          const menu = page.locator('summary').filter({ hasText: /^Menu$/ })
          await menu.click()
          const navigation = page.getByRole('navigation', { name: /Navigation complète|Full navigation/ })
          await expect(navigation).toBeVisible()
          for (const href of ['/accounts', '/insights', '/history', '/tasks', '/agents', '/reports', '/support', '/audit', '/settings']) await expect(navigation.locator(`a[href="${href}"]`)).toBeVisible()
          await page.screenshot({ path: test.info().outputPath(`menu-${locale}-${width}.png`) })
          await menu.press('Escape')
          await expect(navigation).not.toBeVisible()
          await expect(menu).toBeFocused()
          await menu.press('Enter')
          await navigation.locator('a[href="/settings"]').click()
          await expect(page).toHaveURL(/\/settings$/, { timeout: 15_000 })
          await expect(navigation).not.toBeVisible()
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
        } finally { await context.close() }
      })
    }
    test('workspace selection switches context and permissions on mobile', async ({ browser }) => {
      await db.query('update workspaces set access_state=$1, locale=$2 where id=$3', ['internal', 'fr', workspaceId])
      const { page, context } = await pageFor(browser, 'owner', 390)
      try {
        await page.goto('/dashboard')
        const consent = page.getByRole('button', { name: /Continuer sans mesure|Continue without/ })
        if (await consent.isVisible()) { await consent.click(); await expect(consent).toBeHidden() }
        const selector = page.getByRole('combobox', { name: /Workspace actif|Active workspace/ })
        await selector.selectOption('local-browser-fixture-foreign')
        await expect(page).toHaveURL(/\/support/)
        await expect(selector).toHaveValue('local-browser-fixture-foreign')
        await page.locator('summary').filter({ hasText: /^Menu$/ }).click()
        await expect(page.getByRole('navigation', { name: /Navigation complète|Full navigation/ }).locator('a[href="/settings"]')).toHaveCount(0)
        await selector.selectOption('local-browser-fixture-main')
        await expect(page).toHaveURL(/\/dashboard$/)
        await expect(selector).toHaveValue('local-browser-fixture-main')
      } finally { await context.close() }
    })
    test('analysts do not see monitoring controls denied by their role', async ({ browser }) => {
      await db.query('update workspaces set access_state=$1, locale=$2 where id=$3', ['internal', 'fr', workspaceId])
      const { page, context } = await pageFor(browser, 'analyst')
      try {
        await page.goto('/agents')
        await expect(page.getByRole('button', { name: /Analyser maintenant|Créer|Activer|Suspendre/ })).toHaveCount(0)
      } finally { await context.close() }
    })
  })
}
