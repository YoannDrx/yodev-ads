import { expect, test } from '@playwright/test'
import { Client } from 'pg'
import { createHmac } from 'node:crypto'
import { accountCalendarDate, reportCalendarWindow, shiftCalendarDate } from '../src/lib/calendar-window'

if (process.env.PLAYWRIGHT_LOCAL_FIXTURE === '1') {
  const connectionString = process.env.DATABASE_SYSTEM_URL!
  const url = new URL(connectionString)
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || !url.pathname.startsWith('/yodev_test')) throw new Error('Disposable database required')
  const workspaceId = '80000000-0000-4000-8000-000000000001', clientId = '80000000-0000-4000-8000-000000000070'
  const db = new Client({ connectionString })
  test.describe.serial('published report editions', () => {
    test.setTimeout(120_000)
    test.beforeAll(async () => { await db.connect() })
    test.afterAll(async () => { await db.end() })
    for (const locale of ['fr', 'en'] as const) test(`creates every period and preserves HTML PDF CSV through revision in ${locale}`, async ({ browser }) => {
      await db.query('update workspaces set access_state=$1,plan=$2,locale=$3 where id=$4', ['internal', 'internal', locale, workspaceId])
      await db.query('insert into clients(id,workspace_id,google_customer_id,name,currency_code,timezone) values($1,$2,$3,$4,$5,$6)', [clientId, workspaceId, '8000000070', 'Edition fixture', 'EUR', 'Europe/Paris'])
      await db.query('update workspaces set brand_name=$1,accent_color=$2 where id=$3', ['Élan Ανάλυση · ' + 'W'.repeat(80), locale === 'fr' ? '#fff050' : '#092a3b', workspaceId])
      const commentary = 'Évaluation 東京 🚀 ' + 'é'.repeat(4966) + ' COMMENT_END', actionPlan = 'ACTION_START ' + 'x'.repeat(4976) + ' ACTION_END'
      const today = accountCalendarDate(new Date(), 'Europe/Paris')
      await db.query(`insert into daily_account_metrics(workspace_id,client_id,metric_date,currency_code,timezone,coverage_status,source_version,cost_micros)
        select $1,$2,to_char(day,'YYYY-MM-DD'),'EUR','Europe/Paris','complete','browser-edition-v1',2000000
        from generate_series($3::date,$4::date,interval '1 day') day`, [workspaceId, clientId, shiftCalendarDate(today, -100), shiftCalendarDate(today, -1)])
      await db.query('update daily_account_metrics set cost_micros=$1 where client_id=$2 and metric_date=$3', ['9007199254740993010000', clientId, shiftCalendarDate(today, -1)])
      await db.query(`insert into approval_requests(workspace_id,client_id,requested_by,kind,title,payload,expires_at) values($1,$2,'fixture','campaign.pause','Client feedback fixture','{}',now()+interval '1 day')`, [workspaceId, clientId])
      const readerIp = locale === 'fr' ? '198.51.100.70' : '198.51.100.71'
      const ipKeys = ['public-report-ip', 'public-report-pdf-ip'].map((namespace) => createHmac('sha256', process.env.RATE_LIMIT_HASH_KEY!).update(`${namespace}:${readerIp}`).digest('hex'))
      await db.query('delete from rate_limit_buckets where key_hash=any($1::text[])', [ipKeys])
      const context = await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': readerIp }, baseURL: process.env.PLAYWRIGHT_BASE_URL, storageState: process.env.PLAYWRIGHT_OWNER_STORAGE_STATE, viewport: { width: locale === 'fr' ? 390 : 1440, height: 900 } })
      const page = await context.newPage(), publicPage = await context.newPage()
      const errors: string[] = []
      for (const p of [page, publicPage]) p.on('pageerror', (error) => errors.push(error.message))
      const periods = ['7', '30', '90', 'previous_month', 'custom'] as const
      let initialUrl = '', initialCsv = '', initialPdf: Buffer | undefined, initialEdition = ''
      try {
        await page.goto('/reports')
        await expect(page.getByRole('button', { name: /Create schedule|Créer la planification/ })).toHaveCount(0)
        const consent = page.getByRole('button', { name: /Continuer sans mesure|Continue without/ })
        if (await consent.isVisible()) { await consent.click(); await expect(consent).toBeHidden() }
        for (const period of periods) {
          const name = `Browser ${locale} ${period}`
          await page.locator('#report-label').fill(name)
          await page.locator('#report-client').selectOption(clientId)
          await expect(page.locator('#report-locale')).toHaveValue(locale)
          await page.locator('#report-comment').fill(period === '7' ? commentary : '')
          await page.locator('#report-plan').fill(period === '7' ? actionPlan : '')
          await page.locator('#report-period').selectOption(period)
          const custom = { from: shiftCalendarDate(today, -12), through: shiftCalendarDate(today, -3) }
          if (period === 'custom') { await page.locator('#report-period-from').fill(custom.from); await page.locator('#report-period-through').fill(custom.through) }
          await page.getByRole('button', { name: locale === 'en' ? 'Generate link' : 'Générer le lien', exact: true }).click()
          await expect(page.getByRole('heading', { name, exact: true })).toBeVisible()
          await page.getByRole('button', { name: locale === 'en' ? 'Reveal link now' : 'Révéler le lien maintenant', exact: true }).click()
          const revealed = page.locator('input[readonly]').filter({ visible: true })
          await expect(revealed).toHaveValue(/\/r\/.+\?edition=/)
          const reportUrl = await revealed.inputValue()
          const editionId = new URL(reportUrl).searchParams.get('edition')!
          await publicPage.goto(reportUrl)
          const window = reportCalendarWindow({ period, custom: period === 'custom' ? custom : undefined, now: new Date(), timezone: 'Europe/Paris' })
          await expect(publicPage.locator('header')).toHaveCSS('background-color', locale === 'fr' ? 'rgb(255, 240, 80)' : 'rgb(9, 42, 59)')
          await expect(publicPage.getByText(`${window.from} → ${window.through} · Europe/Paris`, { exact: true })).toBeVisible()
          const csvHref = await publicPage.getByRole('link', { name: /CSV/ }).getAttribute('href')
          const pdfHref = await publicPage.getByRole('link', { name: /PDF/ }).getAttribute('href')
          const csv = await context.request.get(csvHref!), pdf = await context.request.get(pdfHref!)
          expect(csv.status()).toBe(200); expect(pdf.status()).toBe(200)
          expect(csv.headers()['x-report-edition']).toBe(editionId); expect(pdf.headers()['x-report-edition']).toBe(editionId)
          expect(await csv.text()).toContain(window.from); expect(await csv.text()).toContain(window.through)
          expect((await pdf.body()).subarray(0, 4).toString()).toBe('%PDF')
          expect(await publicPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
          if (period === '7') {
            await expect(publicPage.getByText(commentary, { exact: true })).toBeVisible()
            await expect(publicPage.getByText(actionPlan, { exact: true })).toBeVisible()
            await publicPage.screenshot({ caret: 'initial', path: test.info().outputPath(`report-long-${locale}.png`), fullPage: true })
            // With transport disabled, even the failure path must keep the edition being read.
            await publicPage.getByRole('textbox', { name: /Your email|Votre email/ }).fill('report-fixture@example.test')
            await publicPage.getByRole('button', { name: /Receive a code|Recevoir un code/ }).click()
            await expect(publicPage).toHaveURL(new RegExp(`edition=${editionId}`))
            await expect(publicPage).toHaveURL(/error=/)
            await publicPage.goto(`${reportUrl}&otp=1`)
            await publicPage.getByRole('textbox', { name: /Six-digit code|Code à six chiffres/ }).fill('000000')
            await publicPage.getByRole('button', { name: /^(Verify|Vérifier)$/ }).click()
            await expect(publicPage).toHaveURL(new RegExp(`edition=${editionId}`))
            await expect(publicPage).toHaveURL(/error=.*otp=1/)
            await expect(publicPage.locator('header')).toHaveCSS('background-color', locale === 'fr' ? 'rgb(255, 240, 80)' : 'rgb(9, 42, 59)')
            initialUrl = reportUrl; initialCsv = await csv.text(); initialPdf = await pdf.body(); initialEdition = editionId }
        }
        await db.query('update daily_account_metrics set cost_micros=9000000,source_version=$1 where client_id=$2 and metric_date=$3', ['browser-correction-v2', clientId, shiftCalendarDate(today, -1)])
        await publicPage.goto(initialUrl)
        expect(await (await context.request.get((await publicPage.getByRole('link', { name: /CSV/ }).getAttribute('href'))!)).text()).toBe(initialCsv)
        expect(await (await context.request.get((await publicPage.getByRole('link', { name: /PDF/ }).getAttribute('href'))!)).body()).toEqual(initialPdf)
        const revisionForm = page.locator('form').filter({ has: page.locator(`input[name=previousEditionId][value="${initialEdition}"]`) })
        await revisionForm.getByRole('button').click()
        await expect(page).toHaveURL(/revealId=/)
        await page.getByRole('button', { name: locale === 'en' ? 'Reveal link now' : 'Révéler le lien maintenant', exact: true }).click()
        await expect(page.locator('input[readonly]')).not.toHaveValue(initialUrl)
        const revisionUrl = await page.locator('input[readonly]').inputValue()
        await publicPage.goto(revisionUrl)
        await expect(publicPage.getByText(/Édition figée|Immutable edition/)).toBeVisible()
        const revisedCsv = await context.request.get((await publicPage.getByRole('link', { name: /CSV/ }).getAttribute('href'))!)
        expect(await revisedCsv.text()).not.toBe(initialCsv)
        await page.screenshot({ caret: 'initial', path: test.info().outputPath(`report-editions-${locale}.png`), fullPage: true })
        await publicPage.screenshot({ caret: 'initial', path: test.info().outputPath(`report-public-${locale}.png`), fullPage: true })
        // Missing history rejects a new report while the already published edition remains readable.
        await db.query('delete from daily_account_metrics where client_id=$1 and metric_date=$2', [clientId, shiftCalendarDate(today, -1)])
        await page.locator('#report-label').fill(`Incomplete ${locale}`)
        await page.locator('#report-client').selectOption(clientId); await page.locator('#report-period').selectOption('7')
        await page.getByRole('button', { name: locale === 'en' ? 'Generate link' : 'Générer le lien', exact: true }).click()
        await expect(page).toHaveURL(/error=/)
        if (locale === 'en') await expect(page.getByText('Complete data for this period is unavailable. Refresh the account history before publishing this report.')).toBeVisible()
        expect((await db.query('select count(*) from share_links where workspace_id=$1 and label=$2', [workspaceId, `Incomplete ${locale}`])).rows[0].count).toBe('0')
        await publicPage.goto(initialUrl); await expect(publicPage.getByRole('link', { name: /CSV/ })).toBeVisible()
        await db.query('update rate_limit_buckets set count=20 where key_hash=$1', [ipKeys[1]])
        const limited = await context.request.get(`${new URL(initialUrl).pathname}/pdf?edition=${initialEdition}`)
        expect(limited.status()).toBe(429); expect(Number(limited.headers()['retry-after'])).toBeGreaterThan(0)
        const shareId = (await db.query('select share_id from report_editions where id=$1', [initialEdition])).rows[0].share_id
        await db.query('update share_links set active=false where id=$1', [shareId])
        expect((await context.request.get(`${new URL(initialUrl).pathname}/csv?edition=${initialEdition}`)).status()).toBe(404)
        const readerContext = await browser.newContext({ baseURL: process.env.PLAYWRIGHT_BASE_URL, storageState: process.env.PLAYWRIGHT_STRATEGIST_STORAGE_STATE })
        try { const reader = await readerContext.newPage(); await reader.goto('/reports'); await expect(reader.locator('#report-label')).toHaveCount(0); await expect(reader.getByRole('button', { name: /Publish corrected edition|Publier une édition corrigée/ })).toHaveCount(0) } finally { await readerContext.close() }
        expect(errors).toEqual([])
      } finally {
        await context.close()
        await db.query('delete from rate_limit_buckets where key_hash=any($1::text[])', [ipKeys])
        await db.query('delete from clients where id=$1', [clientId])
        await db.query('update workspaces set locale=$1 where id=$2', ['fr', workspaceId])
      }
    })
  })
}
