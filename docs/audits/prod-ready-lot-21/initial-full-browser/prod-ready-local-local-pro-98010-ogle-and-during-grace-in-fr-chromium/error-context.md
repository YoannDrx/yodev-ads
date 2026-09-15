# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: prod-ready-local.spec.ts >> local production readiness regression journeys >> stored analytics remain available without Google and during grace in fr
- Location: e2e/prod-ready-local.spec.ts:125:44

# Error details

```
Error: expect(locator).toHaveCount(expected) failed

Locator:  getByRole('button', { name: /Actualiser les données|Refresh data/ })
Expected: 0
Received: 1
Timeout:  15000ms

Call log:
  - Expect "toHaveCount" with timeout 15000ms
  - waiting for getByRole('button', { name: /Actualiser les données|Refresh data/ })
    34 × locator resolved to 1 element
       - unexpected value "1"

```

# Test source

```ts
  53  |         const previousVersion = await page.locator('input[name=version]').inputValue()
  54  |         await page.getByRole('button', { name: `${locale === 'en' ? 'Remove' : 'Retirer'} Selection C`, exact: true }).click()
  55  |         await page.getByRole('button', { name: locale === 'en' ? 'Save selection' : 'Enregistrer la sélection', exact: true }).click()
  56  |         await expect(page.getByText(locale === 'en' ? 'Selection saved.' : 'Sélection enregistrée.', { exact: true })).toBeVisible()
  57  |         await expect(page.locator('input[name=version]')).not.toHaveValue(previousVersion)
  58  |         expect((await db.query('select count(*) from clients where workspace_id=$1 and managed_selected and not is_manager', [workspaceId])).rows[0].count).toBe('3')
  59  |         // A concurrent administrator changes the effective plan after this page loaded.
  60  |         await db.query('update workspaces set plan=$1 where id=$2', ['studio', workspaceId])
  61  |         await page.getByRole('button', { name: locale === 'en' ? 'Save selection' : 'Enregistrer la sélection', exact: true }).click()
  62  |         await expect(page).toHaveURL(/selection=conflict/)
  63  |         await expect(page.getByText(/Your selection was not saved|Votre sélection n’a pas été enregistrée/)).toBeVisible()
  64  |         await page.getByRole('checkbox', { name: 'Selection E', exact: true }).check()
  65  |         await page.getByRole('button', { name: locale === 'en' ? 'Save selection' : 'Enregistrer la sélection', exact: true }).click()
  66  |         await expect(page).toHaveURL(/selection=saved/)
  67  |         expect((await db.query('select active,managed_selected from clients where id=$1', [ids[4]])).rows[0]).toEqual({ active: true, managed_selected: true })
  68  |         expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  69  |         await page.getByRole('textbox', { name: locale === 'en' ? 'Search by name or account ID' : 'Rechercher par nom ou identifiant' }).fill('Selection')
  70  |         await expect(page.getByRole('button', { name: locale === 'en' ? 'Next' : 'Suivant', exact: true })).toBeDisabled()
  71  |         await page.evaluate(() => window.scrollTo(0, 0))
  72  |         await page.screenshot({ path: test.info().outputPath(`account-selection-${locale}-${locale === 'fr' ? 390 : 1440}.png`), fullPage: true })
  73  |         const analyst = await pageFor(browser, 'analyst')
  74  |         try {
  75  |           await analyst.page.goto('/accounts')
  76  |           await expect(analyst.page.getByRole('checkbox')).toHaveCount(0)
  77  |           await expect(analyst.page.getByRole('button', { name: /Save selection|Enregistrer la sélection|Move up|Monter/ })).toHaveCount(0)
  78  |           await expect(analyst.page.getByRole('link', { name: /Manage connection|Gérer la connexion/ })).toHaveCount(0)
  79  |         } finally { await analyst.context.close() }
  80  |         expect(errors).toEqual([])
  81  |       } finally {
  82  |         await context.close()
  83  |         await db.query('delete from clients where id=any($1::uuid[])', [[...ids, ...inventoryIds]])
  84  |         await db.query('update workspaces set access_state=$1,plan=$2 where id=$3', ['internal', 'internal', workspaceId])
  85  |       }
  86  |     })
  87  |
  88  |     for (const locale of ['fr', 'en']) test(`pacing uses covered completed days and hides forecasts with a gap in ${locale}`, async ({ browser }) => {
  89  |       const clientId = '80000000-0000-4000-8000-000000000004'
  90  |       await db.query('update workspaces set access_state=$1, locale=$2 where id=$3', ['internal', locale, workspaceId])
  91  |       await db.query('delete from clients where id=$1', [clientId])
  92  |       await db.query('insert into clients(id,workspace_id,google_customer_id,name,currency_code,timezone) values($1,$2,$3,$4,$5,$6)', [clientId, workspaceId, '8000000004', 'History fixture', 'EUR', 'Europe/Paris'])
  93  |       await db.query('insert into client_goals(workspace_id,client_id,monthly_budget_micros,primary_kpi) values($1,$2,$3,$4)', [workspaceId, clientId, '300000000', 'cpa'])
  94  |       const today = accountCalendarDate(new Date(), 'Europe/Paris')
  95  |       const expectedDays = Number(today.slice(-2)) - 1
  96  |       const dates = expectedDays ? calendarDates({ from: `${today.slice(0, 7)}-01`, through: shiftCalendarDate(today, -1) }) : []
  97  |       for (const date of dates) await db.query('insert into daily_account_metrics(workspace_id,client_id,metric_date,currency_code,cost_micros,timezone,coverage_status,source_version) values($1,$2,$3,$4,$5,$6,$7,$8)', [workspaceId, clientId, date, 'EUR', '10000000', 'Europe/Paris', 'complete', 'browser-history'])
  98  |       const { page, context } = await pageFor(browser, 'owner', 1440)
  99  |       const errors: string[] = []
  100 |       page.on('pageerror', (error) => errors.push(error.message))
  101 |       try {
  102 |         expect((await page.goto(`/dashboard?client=${clientId}`))?.status()).toBe(200)
  103 |         const consent = page.getByRole('button', { name: /Continuer sans mesure|Continue without/ })
  104 |         if (await consent.isVisible()) { await consent.click(); await expect(consent).toBeHidden() }
  105 |         const spend = page.locator('[data-slot="card"]').filter({ has: page.getByText(locale === 'en' ? 'MTD spend' : 'Dépense MTD', { exact: true }) }).last()
  106 |         const forecast = page.locator('[data-slot="card"]').filter({ has: page.getByText(locale === 'en' ? 'End-of-month forecast' : 'Forecast fin de mois', { exact: true }) }).last()
  107 |         await expect(spend).toContainText(`${expectedDays}/${expectedDays}`)
  108 |         if (expectedDays) {
  109 |           await expect(forecast.locator('p.text-2xl')).not.toHaveText('—')
  110 |           await db.query('update daily_account_metrics set coverage_status=$1 where client_id=$2 and metric_date=$3', ['legacy', clientId, dates[0]])
  111 |           await page.reload()
  112 |           await expect(spend).toContainText(`${expectedDays - 1}/${expectedDays}`)
  113 |         }
  114 |         await expect(spend.locator('p.text-2xl')).toHaveText('—')
  115 |         await expect(forecast.locator('p.text-2xl')).toHaveText('—')
  116 |         await expect(page.getByText(locale === 'en' ? 'Daily collection required' : 'Collecte journalière requise', { exact: true })).toBeVisible()
  117 |         await page.screenshot({ path: test.info().outputPath(`pacing-gap-${locale}-1440.png`), fullPage: true })
  118 |         expect(errors).toEqual([])
  119 |       } finally {
  120 |         await context.close()
  121 |         await db.query('delete from clients where id=$1', [clientId])
  122 |       }
  123 |     })
  124 |
  125 |     for (const locale of ['fr', 'en']) test(`stored analytics remain available without Google and during grace in ${locale}`, async ({ browser }) => {
  126 |       const clientId = '80000000-0000-4000-8000-000000000005'
  127 |       await db.query('update workspaces set access_state=$1, locale=$2 where id=$3', ['internal', locale, workspaceId])
  128 |       await db.query('delete from clients where id=$1', [clientId])
  129 |       await db.query('insert into clients(id,workspace_id,google_customer_id,name,currency_code,timezone) values($1,$2,$3,$4,$5,$6)', [clientId, workspaceId, '8000000005', 'Stored analysis fixture', 'EUR', 'Europe/Paris'])
  130 |       const window = reportCalendarWindow({ period: '30', now: new Date(), timezone: 'Europe/Paris' })
  131 |       await db.query(`insert into daily_account_metrics(workspace_id,client_id,metric_date,currency_code,timezone,coverage_status,source_version,cost_micros)
  132 |         select $1,$2,to_char(day,'YYYY-MM-DD'),'EUR','Europe/Paris','complete','browser-account-history',case when day=$3::date then 456000000 else 0 end
  133 |         from generate_series($3::date,$4::date,interval '1 day') day`, [workspaceId, clientId, window.from, window.through])
  134 |       const campaign = { id: '42', name: 'Stored brand campaign', status: 'ENABLED', channelType: 'SEARCH', budgetResourceName: 'customers/8000000005/campaignBudgets/1', budgetMicros: '10000000', costMicros: '123000000', clicks: '200', impressions: '1000', conversions: 12, conversionValueMicros: '500000000', searchBudgetLostImpressionShare: null, searchRankLostImpressionShare: null }
  135 |       const datasets = { campaigns: [campaign], searchTerms: [], keywords: [], ads: [], tracking: { status: 'MANAGED_BY_THIS_CUSTOMER', managerCustomer: null, acceptedCustomerDataTerms: true, enhancedConversionsForLeadsEnabled: true }, devices: [{ key: 'MOBILE', label: 'MOBILE', impressions: '1000', clicks: '200', costMicros: '123000000', conversions: 12, conversionValueMicros: '500000000' }] }
  136 |       for (const [family, payload] of Object.entries(datasets)) await db.query('insert into analytical_collections(workspace_id,client_id,family,contract_version,period_from,period_through,timezone,currency_code,source_version,observed_at,payload) values($1,$2,$3,1,$4,$5,$6,$7,$8,now(),$9)', [workspaceId, clientId, family, window.from, window.through, 'Europe/Paris', 'EUR', clientId, JSON.stringify(payload)])
  137 |       const receivedCoverage = { version: 1, queries: [{ queryHash: 'a'.repeat(64), rows: 1, pages: 1, bytes: 100, limit: null, state: 'query_complete' }] }
  138 |       const limitedCoverage = { version: 1, queries: [{ queryHash: 'b'.repeat(64), rows: 500, pages: 1, bytes: 50000, limit: 500, state: 'limit_reached' }] }
  139 |       await db.query('update analytical_collections set coverage=$1 where client_id=$2 and family=$3', [JSON.stringify(receivedCoverage), clientId, 'campaigns'])
  140 |       await db.query('update analytical_collections set coverage=$1 where client_id=$2 and family=$3', [JSON.stringify(limitedCoverage), clientId, 'devices'])
  141 |       const { page, context } = await pageFor(browser, 'owner', 1440)
  142 |       const errors: string[] = []
  143 |       page.on('pageerror', (error) => errors.push(error.message))
  144 |       try {
  145 |         for (const state of ['internal', 'grace']) {
  146 |           await db.query('update workspaces set access_state=$1 where id=$2', [state, workspaceId])
  147 |           expect((await page.goto(`/dashboard?client=${clientId}`))?.status()).toBe(200)
  148 |           await expect(page.getByText('Stored brand campaign', { exact: true })).toBeVisible()
  149 |           const spendCard = page.locator('[data-slot="card"]').filter({ has: page.getByText(locale === 'en' ? 'Spend' : 'Investissement', { exact: true }) })
  150 |           await expect(spendCard).toContainText('456')
  151 |           await expect(spendCard).toContainText('30/30')
  152 |           await expect(page.getByRole('region', { name: /Synchronisation des données|Data synchronization/ })).toContainText('6/17')
> 153 |           await expect(page.getByRole('button', { name: /Actualiser les données|Refresh data/ })).toHaveCount(0)
      |                                                                                                   ^ Error: expect(locator).toHaveCount(expected) failed
  154 |           expect((await page.goto(`/analysis?client=${clientId}`))?.status()).toBe(200)
  155 |           await expect(page.getByText(locale === 'en' ? 'Opportunity score' : 'Score d’opportunité', { exact: true })).toBeVisible()
  156 |           expect((await page.goto(`/insights?client=${clientId}`))?.status()).toBe(200)
  157 |           await expect(page.getByRole('cell', { name: 'MOBILE', exact: true })).toBeVisible()
  158 |         }
  159 |         await db.query(`update analytical_collections set observed_at=now()-interval '3 days' where client_id=$1`, [clientId])
  160 |         await page.reload()
  161 |         await page.getByText(locale === 'en' ? 'Collection details' : 'Détail des collectes', { exact: true }).click()
  162 |         await expect(page.getByText(locale === 'en' ? 'Devices · Older data' : 'Appareils · Données anciennes', { exact: true })).toBeVisible()
  163 |         await expect(page.getByText(locale === 'en' ? 'Collection limit reached; results are limited' : 'Plafond de collecte atteint ; résultats limités', { exact: true })).toBeVisible()
  164 |         await expect(page.getByText(locale === 'en' ? 'All available query pages received' : 'Toutes les pages disponibles reçues', { exact: true })).toBeVisible()
  165 |         await expect(page.getByText(locale === 'en' ? 'Collection coverage not verified' : 'Couverture de collecte non vérifiée', { exact: true })).toHaveCount(4)
  166 |         await expect(page.getByRole('cell', { name: 'MOBILE', exact: true })).toBeVisible()
  167 |         const consent = page.getByRole('button', { name: /Continuer sans mesure|Continue without/ })
  168 |         if (await consent.isVisible()) { await consent.click(); await expect(consent).toBeHidden() }
  169 |         await page.screenshot({ path: test.info().outputPath(`stored-insights-${locale}-1440.png`), fullPage: true })
  170 |         expect(errors).toEqual([])
  171 |       } finally {
  172 |         await context.close()
  173 |         await db.query('delete from clients where id=$1', [clientId])
  174 |       }
  175 |     })
  176 |
  177 |     if (process.env.PLAYWRIGHT_ANALYTICS_CONTROLS === '1') for (const locale of ['fr', 'en']) test(`analytical refresh enqueues once and handles revoked connections in ${locale}`, async ({ browser }) => {
  178 |       const clientId = '80000000-0000-4000-8000-000000000006'
  179 |       const connectionId = '80000000-0000-4000-8000-000000000007'
  180 |       await db.query('update workspaces set access_state=$1, locale=$2 where id=$3', ['internal', locale, workspaceId])
  181 |       await db.query('insert into clients(id,workspace_id,google_customer_id,name,currency_code,timezone) values($1,$2,$3,$4,$5,$6)', [clientId, workspaceId, '8000000006', 'Refresh fixture', 'EUR', 'Europe/Paris'])
  182 |       await db.query('insert into google_ads_connections(id,workspace_id,manager_customer_id,encrypted_refresh_token,connected_by) values($1,$2,$3,$4,$5)', [connectionId, workspaceId, '8000000007', 'invalid-fixture-token-cannot-be-decrypted', 'browser-fixture'])
  183 |       const { page, context } = await pageFor(browser, 'owner', 1440)
  184 |       const errors: string[] = []
  185 |       page.on('pageerror', (error) => errors.push(error.message))
  186 |       const readJobs = () => db.query(`select type,status from jobs where workspace_id=$1 and payload->>'clientId'=$2`, [workspaceId, clientId])
  187 |       try {
  188 |         await page.goto(`/dashboard?client=${clientId}`)
  189 |         const consent = page.getByRole('button', { name: /Continuer sans mesure|Continue without/ })
  190 |         if (await consent.isVisible()) { await consent.click(); await expect(consent).toBeHidden() }
  191 |         const refresh = page.getByRole('button', { name: /Actualiser les données|Refresh data/ })
  192 |         await refresh.click()
  193 |         await expect(page).toHaveURL(/sync=queued/)
  194 |         await expect(page.getByRole('region', { name: /Synchronisation des données|Data synchronization/ })).toContainText(locale === 'en' ? 'Collection queued.' : 'Collecte planifiée.')
  195 |         await expect(refresh).toBeDisabled()
  196 |         expect((await readJobs()).rows).toHaveLength(18)
  197 |         await refresh.evaluate((element) => (element as HTMLButtonElement).form!.requestSubmit())
  198 |         await expect(page).toHaveURL(/sync=pending/)
  199 |         expect((await readJobs()).rows).toHaveLength(18)
  200 |         const analyst = await pageFor(browser, 'analyst', 1440)
  201 |         try {
  202 |           await analyst.page.goto(`/dashboard?client=${clientId}`)
  203 |           await expect(analyst.page.getByRole('button', { name: /Actualiser les données|Refresh data/ })).toHaveCount(0)
  204 |           await expect(analyst.page.getByRole('region', { name: /Synchronisation des données|Data synchronization/ }).getByRole('link', { name: /Connexion|Connection/ })).toHaveCount(0)
  205 |         } finally { await analyst.context.close() }
  206 |         await db.query(`delete from jobs where workspace_id=$1 and payload->>'clientId'=$2`, [workspaceId, clientId])
  207 |         await db.query('update google_ads_connections set status=$1 where id=$2', ['revoked', connectionId])
  208 |         await page.goto(`/dashboard?client=${clientId}`)
  209 |         await refresh.click()
  210 |         await expect(page).toHaveURL(/sync=unavailable/)
  211 |         await expect(page.getByRole('region', { name: /Synchronisation des données|Data synchronization/ })).toContainText(locale === 'en' ? 'Collection unavailable.' : 'Collecte indisponible.')
  212 |         expect((await readJobs()).rows).toHaveLength(0)
  213 |         expect(errors).toEqual([])
  214 |       } finally {
  215 |         await context.close()
  216 |         await db.query('delete from google_ads_connections where id=$1', [connectionId])
  217 |         await db.query('delete from clients where id=$1', [clientId])
  218 |       }
  219 |     })
  220 |
  221 |     test('grace permits stored views while hiding mutations', async ({ browser }) => {
  222 |       await db.query('update workspaces set access_state=$1 where id=$2', ['grace', workspaceId])
  223 |       for (const role of ['owner', 'analyst']) {
  224 |         const { page, context } = await pageFor(browser, role)
  225 |         try {
  226 |           for (const path of ['/accounts', '/history', '/alerts', '/tasks', '/approvals', '/reports']) {
  227 |             expect((await page.goto(path))?.status()).toBe(200)
  228 |             await expect(page).toHaveURL(new RegExp(`${path}$`))
  229 |             await expect(page.locator('main')).toBeVisible()
  230 |             await expect(page.getByRole('button', { name: /Générer le lien|Analyser maintenant|Créer une tâche|Approuver/ })).toHaveCount(0)
  231 |           }
  232 |           if (role === 'owner') expect((await page.goto('/audit'))?.status()).toBe(200)
  233 |         } finally { await context.close() }
  234 |       }
  235 |     })
  236 |     test('suspended members have an accessible recovery destination without redirect loops', async ({ browser }) => {
  237 |       await db.query('update workspaces set access_state=$1 where id=$2', ['suspended', workspaceId])
  238 |       for (const role of ['owner', 'admin', 'client']) {
  239 |         const { page, context } = await pageFor(browser, role)
  240 |         try {
  241 |           expect((await page.goto('/dashboard'))?.status()).toBe(200)
  242 |           await expect(page).toHaveURL(role === 'owner' ? /\/billing\?/ : /\/support\?/)
  243 |           await expect(page.locator('main')).toBeVisible()
  244 |         } finally { await context.close() }
  245 |       }
  246 |     })
  247 |     for (const locale of ['fr', 'en']) for (const width of [390, 768]) {
  248 |       test(`full navigation and workspace selection work at ${width}px in ${locale}`, async ({ browser }) => {
  249 |         await db.query('update workspaces set access_state=$1, locale=$2 where id=$3', ['internal', locale, workspaceId])
  250 |         const { page, context } = await pageFor(browser, 'owner', width)
  251 |         try {
  252 |           await page.goto('/dashboard')
  253 |           const consent = page.getByRole('button', { name: /Continuer sans mesure|Continue without/ })
```
