# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: report-editions-local.spec.ts >> published report editions >> creates every period and preserves HTML PDF CSV through revision in en
- Location: e2e/report-editions-local.spec.ts:16:53

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByRole('heading', { name: 'Browser en previous_month', exact: true })
Expected: visible
Timeout: 15000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 15000ms
  - waiting for getByRole('heading', { name: 'Browser en previous_month', exact: true })
    - waiting for "http://localhost:3017/reports?notice=Report%20created.%20Reveal%20its%20URL%20within%20the%20next%20five%20minutes.&reveal=report-url&revealId=47d2c6b7-4f15-4cf9-bdd0-918865efa04c" navigation to finish...
    - navigated to "http://localhost:3017/reports?notice=Report%20created.%20Reveal%20its%20URL%20within%20the%20next%20five%20minutes.&reveal=report-url&revealId=47d2c6b7-4f15-4cf9-bdd0-918865efa04c"

```

```yaml
- link "Skip to content":
  - /url: "#main-content"
- complementary:
  - link "Élan Ανάλυση · WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW":
    - /url: /dashboard
  - navigation "Main navigation":
    - link "Getting started":
      - /url: /getting-started
    - link "Cockpit":
      - /url: /dashboard
    - link "Portfolio":
      - /url: /portfolio
    - link "Client accounts":
      - /url: /accounts
    - link "360 analysis":
      - /url: /analysis
    - link "Extended insights":
      - /url: /insights
    - link "History":
      - /url: /history
    - link "Alerts":
      - /url: /alerts
    - link "Tasks":
      - /url: /tasks
    - link "Autonomous monitors":
      - /url: /agents
    - link "Approvals":
      - /url: /approvals
    - link "Client reports":
      - /url: /reports
    - link "Support":
      - /url: /support
    - link "Audit log":
      - /url: /audit
    - link "Subscription":
      - /url: /billing
    - link "Settings":
      - /url: /settings
    - link "Operations":
      - /url: /operations
  - paragraph: Your monitor
  - paragraph: Pilotez chaque compte avec confiance.
- banner:
  - text: Browser main
  - link "Service health unverified":
    - /url: /status
  - combobox "Active workspace":
    - option "Browser foreign"
    - option "Browser main" [selected]
  - link "Account security":
    - /url: /account
  - button "Sign out"
- main:
  - paragraph: Client portal
  - heading "Shareable reports" [level=1]
  - paragraph: Publish a dated report or a dynamic link from complete stored account data, then schedule its delivery.
  - text: Report created. Reveal its URL within the next five minutes.
  - paragraph: New report link · one-time reveal
  - button "Reveal link now"
  - text: Create one-off report Internal name
  - textbox "Internal name":
    - /placeholder: ACME monthly report
  - text: Client account
  - combobox "Client account":
    - option "Edition fixture" [selected]
  - text: Language
  - combobox "Language":
    - option "Français"
    - option "English" [selected]
  - text: Period
  - combobox "Period":
    - option "7 completed days"
    - option "30 completed days" [selected]
    - option "90 completed days"
    - option "Previous calendar month"
    - option "Custom dates"
  - paragraph: Complete days in the client account’s timezone. Publishing requires complete stored history for the entire period.
  - text: Report type
  - combobox "Report type":
    - option "Immutable dated report" [selected]
    - option "Dynamic link to current stored data"
  - text: Editorial comment
  - textbox "Editorial comment":
    - /placeholder: What the client should take away from this period…
  - text: Action plan
  - textbox "Action plan":
    - /placeholder: Decisions and next steps…
  - button "Generate link"
  - text: Create editorial template Template name
  - textbox "Template name":
    - /placeholder: Monthly review
  - text: Language
  - combobox "Language":
    - option "Français"
    - option "English" [selected]
  - text: Period
  - combobox "Period":
    - option "7 completed days"
    - option "30 completed days" [selected]
    - option "90 completed days"
    - option "Previous calendar month"
    - option "Custom dates"
  - paragraph: Complete days in the client account’s timezone. Publishing requires complete stored history for the entire period.
  - text: Reusable comment
  - textbox "Reusable comment":
    - /placeholder: Editorial context shared by each delivery…
  - text: Reusable action plan
  - textbox "Reusable action plan":
    - /placeholder: Next-step structure…
  - button "Save template"
  - paragraph: Scheduled delivery is temporarily paused. Dated reports and their downloads remain available.
  - heading "Scheduled deliveries" [level=2]
  - text: No scheduled delivery.
  - heading "Active and historical links" [level=2]
  - text: Connected ya_share_h31••••
  - heading "Browser en 90" [level=3]
  - paragraph: Edition fixture · EN · 90 completed days · Immutable · created on 07/09/2026 · expires on 06/12/2026
  - button "Revoke"
  - text: Connected ya_share_vMT••••
  - heading "Browser en 30" [level=3]
  - paragraph: Edition fixture · EN · 30 completed days · Immutable · created on 07/09/2026 · expires on 06/12/2026
  - button "Revoke"
  - text: Connected ya_share_YDk••••
  - heading "Browser en 7" [level=3]
  - paragraph: Edition fixture · EN · 7 completed days · Immutable · created on 07/09/2026 · expires on 06/12/2026
  - button "Revoke"
  - heading "Recent published editions" [level=2]
  - paragraph: The latest 100 editions. A revision keeps the original dates and branding, using corrected stored data.
  - heading "Browser en 90 · Edition 1" [level=3]
  - paragraph: 2026-06-09 → 2026-09-06 · Europe/Paris
  - paragraph: "Published : 07/09/2026, 08:39:37 · d7f1707828e3"
  - button "Publish corrected edition"
  - heading "Browser en 30 · Edition 1" [level=3]
  - paragraph: 2026-08-08 → 2026-09-06 · Europe/Paris
  - paragraph: "Published : 07/09/2026, 08:39:37 · 8577ca62120d"
  - button "Publish corrected edition"
  - heading "Browser en 7 · Edition 1" [level=3]
  - paragraph: 2026-08-31 → 2026-09-06 · Europe/Paris
  - paragraph: "Published : 07/09/2026, 08:39:35 · 7dc0f3a7f1e7"
  - button "Publish corrected edition"
  - text: Tokens stay out of internal URLs and logs. Scheduled deliveries use an idempotency key and their link is revoked as soon as they are suspended.
- alert
```

# Test source

```ts
  1   | import { expect, test } from '@playwright/test'
  2   | import { Client } from 'pg'
  3   | import { createHmac } from 'node:crypto'
  4   | import { accountCalendarDate, reportCalendarWindow, shiftCalendarDate } from '../src/lib/calendar-window'
  5   |
  6   | if (process.env.PLAYWRIGHT_LOCAL_FIXTURE === '1') {
  7   |   const connectionString = process.env.DATABASE_SYSTEM_URL!
  8   |   const url = new URL(connectionString)
  9   |   if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || !url.pathname.startsWith('/yodev_test')) throw new Error('Disposable database required')
  10  |   const workspaceId = '80000000-0000-4000-8000-000000000001', clientId = '80000000-0000-4000-8000-000000000070'
  11  |   const db = new Client({ connectionString })
  12  |   test.describe.serial('published report editions', () => {
  13  |     test.setTimeout(120_000)
  14  |     test.beforeAll(async () => { await db.connect() })
  15  |     test.afterAll(async () => { await db.end() })
  16  |     for (const locale of ['fr', 'en'] as const) test(`creates every period and preserves HTML PDF CSV through revision in ${locale}`, async ({ browser }) => {
  17  |       await db.query('update workspaces set access_state=$1,plan=$2,locale=$3 where id=$4', ['internal', 'internal', locale, workspaceId])
  18  |       await db.query('insert into clients(id,workspace_id,google_customer_id,name,currency_code,timezone) values($1,$2,$3,$4,$5,$6)', [clientId, workspaceId, '8000000070', 'Edition fixture', 'EUR', 'Europe/Paris'])
  19  |       await db.query('update workspaces set brand_name=$1,accent_color=$2 where id=$3', ['Élan Ανάλυση · ' + 'W'.repeat(80), locale === 'fr' ? '#fff050' : '#092a3b', workspaceId])
  20  |       const commentary = 'Évaluation 東京 🚀 ' + 'é'.repeat(4966) + ' COMMENT_END', actionPlan = 'ACTION_START ' + 'x'.repeat(4976) + ' ACTION_END'
  21  |       const today = accountCalendarDate(new Date(), 'Europe/Paris')
  22  |       await db.query(`insert into daily_account_metrics(workspace_id,client_id,metric_date,currency_code,timezone,coverage_status,source_version,cost_micros)
  23  |         select $1,$2,to_char(day,'YYYY-MM-DD'),'EUR','Europe/Paris','complete','browser-edition-v1',2000000
  24  |         from generate_series($3::date,$4::date,interval '1 day') day`, [workspaceId, clientId, shiftCalendarDate(today, -100), shiftCalendarDate(today, -1)])
  25  |       await db.query('update daily_account_metrics set cost_micros=$1 where client_id=$2 and metric_date=$3', ['9007199254740993010000', clientId, shiftCalendarDate(today, -1)])
  26  |       await db.query(`insert into approval_requests(workspace_id,client_id,requested_by,kind,title,payload,expires_at) values($1,$2,'fixture','campaign.pause','Client feedback fixture','{}',now()+interval '1 day')`, [workspaceId, clientId])
  27  |       const readerIp = locale === 'fr' ? '198.51.100.70' : '198.51.100.71'
  28  |       const ipKeys = ['public-report-ip', 'public-report-pdf-ip'].map((namespace) => createHmac('sha256', process.env.RATE_LIMIT_HASH_KEY!).update(`${namespace}:${readerIp}`).digest('hex'))
  29  |       await db.query('delete from rate_limit_buckets where key_hash=any($1::text[])', [ipKeys])
  30  |       const context = await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': readerIp }, baseURL: process.env.PLAYWRIGHT_BASE_URL, storageState: process.env.PLAYWRIGHT_OWNER_STORAGE_STATE, viewport: { width: locale === 'fr' ? 390 : 1440, height: 900 } })
  31  |       const page = await context.newPage(), publicPage = await context.newPage()
  32  |       const errors: string[] = []
  33  |       for (const p of [page, publicPage]) p.on('pageerror', (error) => errors.push(error.message))
  34  |       const periods = ['7', '30', '90', 'previous_month', 'custom'] as const
  35  |       let initialUrl = '', initialCsv = '', initialPdf: Buffer | undefined, initialEdition = ''
  36  |       try {
  37  |         await page.goto('/reports')
  38  |         await expect(page.getByRole('button', { name: /Create schedule|Créer la planification/ })).toHaveCount(0)
  39  |         const consent = page.getByRole('button', { name: /Continuer sans mesure|Continue without/ })
  40  |         if (await consent.isVisible()) { await consent.click(); await expect(consent).toBeHidden() }
  41  |         for (const period of periods) {
  42  |           const name = `Browser ${locale} ${period}`
  43  |           await page.locator('#report-label').fill(name)
  44  |           await page.locator('#report-client').selectOption(clientId)
  45  |           await expect(page.locator('#report-locale')).toHaveValue(locale)
  46  |           await page.locator('#report-comment').fill(period === '7' ? commentary : '')
  47  |           await page.locator('#report-plan').fill(period === '7' ? actionPlan : '')
  48  |           await page.locator('#report-period').selectOption(period)
  49  |           const custom = { from: shiftCalendarDate(today, -12), through: shiftCalendarDate(today, -3) }
  50  |           if (period === 'custom') { await page.locator('#report-period-from').fill(custom.from); await page.locator('#report-period-through').fill(custom.through) }
  51  |           await page.getByRole('button', { name: locale === 'en' ? 'Generate link' : 'Générer le lien', exact: true }).click()
> 52  |           await expect(page.getByRole('heading', { name, exact: true })).toBeVisible()
      |                                                                          ^ Error: expect(locator).toBeVisible() failed
  53  |           await page.getByRole('button', { name: locale === 'en' ? 'Reveal link now' : 'Révéler le lien maintenant', exact: true }).click()
  54  |           const revealed = page.locator('input[readonly]').filter({ visible: true })
  55  |           await expect(revealed).toHaveValue(/\/r\/.+\?edition=/)
  56  |           const reportUrl = await revealed.inputValue()
  57  |           const editionId = new URL(reportUrl).searchParams.get('edition')!
  58  |           await publicPage.goto(reportUrl)
  59  |           const window = reportCalendarWindow({ period, custom: period === 'custom' ? custom : undefined, now: new Date(), timezone: 'Europe/Paris' })
  60  |           await expect(publicPage.locator('header')).toHaveCSS('background-color', locale === 'fr' ? 'rgb(255, 240, 80)' : 'rgb(9, 42, 59)')
  61  |           await expect(publicPage.getByText(`${window.from} → ${window.through} · Europe/Paris`, { exact: true })).toBeVisible()
  62  |           const csvHref = await publicPage.getByRole('link', { name: /CSV/ }).getAttribute('href')
  63  |           const pdfHref = await publicPage.getByRole('link', { name: /PDF/ }).getAttribute('href')
  64  |           const csv = await context.request.get(csvHref!), pdf = await context.request.get(pdfHref!)
  65  |           expect(csv.status()).toBe(200); expect(pdf.status()).toBe(200)
  66  |           expect(csv.headers()['x-report-edition']).toBe(editionId); expect(pdf.headers()['x-report-edition']).toBe(editionId)
  67  |           expect(await csv.text()).toContain(window.from); expect(await csv.text()).toContain(window.through)
  68  |           expect((await pdf.body()).subarray(0, 4).toString()).toBe('%PDF')
  69  |           expect(await publicPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  70  |           if (period === '7') {
  71  |             await expect(publicPage.getByText(commentary, { exact: true })).toBeVisible()
  72  |             await expect(publicPage.getByText(actionPlan, { exact: true })).toBeVisible()
  73  |             await publicPage.screenshot({ path: test.info().outputPath(`report-long-${locale}.png`), fullPage: true })
  74  |             // With transport disabled, even the failure path must keep the edition being read.
  75  |             await publicPage.getByRole('textbox', { name: /Your email|Votre email/ }).fill('report-fixture@example.test')
  76  |             await publicPage.getByRole('button', { name: /Receive a code|Recevoir un code/ }).click()
  77  |             await expect(publicPage).toHaveURL(new RegExp(`edition=${editionId}`))
  78  |             await expect(publicPage).toHaveURL(/error=/)
  79  |             await publicPage.goto(`${reportUrl}&otp=1`)
  80  |             await publicPage.getByRole('textbox', { name: /Six-digit code|Code à six chiffres/ }).fill('000000')
  81  |             await publicPage.getByRole('button', { name: /^(Verify|Vérifier)$/ }).click()
  82  |             await expect(publicPage).toHaveURL(new RegExp(`edition=${editionId}`))
  83  |             await expect(publicPage).toHaveURL(/error=.*otp=1/)
  84  |             await expect(publicPage.locator('header')).toHaveCSS('background-color', locale === 'fr' ? 'rgb(255, 240, 80)' : 'rgb(9, 42, 59)')
  85  |             initialUrl = reportUrl; initialCsv = await csv.text(); initialPdf = await pdf.body(); initialEdition = editionId }
  86  |         }
  87  |         await db.query('update daily_account_metrics set cost_micros=9000000,source_version=$1 where client_id=$2 and metric_date=$3', ['browser-correction-v2', clientId, shiftCalendarDate(today, -1)])
  88  |         await publicPage.goto(initialUrl)
  89  |         expect(await (await context.request.get((await publicPage.getByRole('link', { name: /CSV/ }).getAttribute('href'))!)).text()).toBe(initialCsv)
  90  |         expect(await (await context.request.get((await publicPage.getByRole('link', { name: /PDF/ }).getAttribute('href'))!)).body()).toEqual(initialPdf)
  91  |         const revisionForm = page.locator('form').filter({ has: page.locator(`input[name=previousEditionId][value="${initialEdition}"]`) })
  92  |         await revisionForm.getByRole('button').click()
  93  |         await expect(page).toHaveURL(/revealId=/)
  94  |         await page.getByRole('button', { name: locale === 'en' ? 'Reveal link now' : 'Révéler le lien maintenant', exact: true }).click()
  95  |         await expect(page.locator('input[readonly]')).not.toHaveValue(initialUrl)
  96  |         const revisionUrl = await page.locator('input[readonly]').inputValue()
  97  |         await publicPage.goto(revisionUrl)
  98  |         await expect(publicPage.getByText(/Édition figée|Immutable edition/)).toBeVisible()
  99  |         const revisedCsv = await context.request.get((await publicPage.getByRole('link', { name: /CSV/ }).getAttribute('href'))!)
  100 |         expect(await revisedCsv.text()).not.toBe(initialCsv)
  101 |         await page.screenshot({ path: test.info().outputPath(`report-editions-${locale}.png`), fullPage: true })
  102 |         await publicPage.screenshot({ path: test.info().outputPath(`report-public-${locale}.png`), fullPage: true })
  103 |         // Missing history rejects a new report while the already published edition remains readable.
  104 |         await db.query('delete from daily_account_metrics where client_id=$1 and metric_date=$2', [clientId, shiftCalendarDate(today, -1)])
  105 |         await page.locator('#report-label').fill(`Incomplete ${locale}`)
  106 |         await page.locator('#report-client').selectOption(clientId); await page.locator('#report-period').selectOption('7')
  107 |         await page.getByRole('button', { name: locale === 'en' ? 'Generate link' : 'Générer le lien', exact: true }).click()
  108 |         await expect(page).toHaveURL(/error=/)
  109 |         if (locale === 'en') await expect(page.getByText('Complete data for this period is unavailable. Refresh the account history before publishing this report.')).toBeVisible()
  110 |         expect((await db.query('select count(*) from share_links where workspace_id=$1 and label=$2', [workspaceId, `Incomplete ${locale}`])).rows[0].count).toBe('0')
  111 |         await publicPage.goto(initialUrl); await expect(publicPage.getByRole('link', { name: /CSV/ })).toBeVisible()
  112 |         await db.query('update rate_limit_buckets set count=20 where key_hash=$1', [ipKeys[1]])
  113 |         const limited = await context.request.get(`${new URL(initialUrl).pathname}/pdf?edition=${initialEdition}`)
  114 |         expect(limited.status()).toBe(429); expect(Number(limited.headers()['retry-after'])).toBeGreaterThan(0)
  115 |         const shareId = (await db.query('select share_id from report_editions where id=$1', [initialEdition])).rows[0].share_id
  116 |         await db.query('update share_links set active=false where id=$1', [shareId])
  117 |         expect((await context.request.get(`${new URL(initialUrl).pathname}/csv?edition=${initialEdition}`)).status()).toBe(404)
  118 |         const readerContext = await browser.newContext({ baseURL: process.env.PLAYWRIGHT_BASE_URL, storageState: process.env.PLAYWRIGHT_STRATEGIST_STORAGE_STATE })
  119 |         try { const reader = await readerContext.newPage(); await reader.goto('/reports'); await expect(reader.locator('#report-label')).toHaveCount(0); await expect(reader.getByRole('button', { name: /Publish corrected edition|Publier une édition corrigée/ })).toHaveCount(0) } finally { await readerContext.close() }
  120 |         expect(errors).toEqual([])
  121 |       } finally {
  122 |         await context.close()
  123 |         await db.query('delete from rate_limit_buckets where key_hash=any($1::text[])', [ipKeys])
  124 |         await db.query('delete from clients where id=$1', [clientId])
  125 |         await db.query('update workspaces set locale=$1 where id=$2', ['fr', workspaceId])
  126 |       }
  127 |     })
  128 |   })
  129 | }
  130 |
```
