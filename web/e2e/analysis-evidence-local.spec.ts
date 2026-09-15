import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { Client } from 'pg'
import { reportCalendarWindow } from '../src/lib/calendar-window'

if (process.env.PLAYWRIGHT_LOCAL_FIXTURE === '1') for (const [index, locale] of ['fr', 'en'].entries()) {
  test(`analysis evidence ${locale} excludes empty and unqualified sources before first activation`, async ({ browser }) => {
    const connectionString = process.env.DATABASE_SYSTEM_URL!, url = new URL(connectionString)
    if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || !url.pathname.startsWith('/yodev_test')) throw new Error('Disposable database required')
    const db = new Client({ connectionString }), workspaceId = '80000000-0000-4000-8000-000000000001', clientId = randomUUID()
    await db.connect()
    const original = (await db.query('select access_state,plan,locale from workspaces where id=$1', [workspaceId])).rows[0]
    const context = await browser.newContext({ baseURL: process.env.PLAYWRIGHT_BASE_URL, storageState: process.env.PLAYWRIGHT_OWNER_STORAGE_STATE, viewport: { width: locale === 'fr' ? 390 : 1440, height: 950 }, extraHTTPHeaders: { 'x-forwarded-for': `198.18.29.${index + 1}` } })
    await context.addCookies([{ name: 'yodev_cookie_consent', value: 'rejected', url: process.env.PLAYWRIGHT_BASE_URL! }])
    const milestones = async () => (await db.query("select id,occurred_at,metadata,source_entity_id from activation_milestones where workspace_id=$1 and milestone='first_qualified_analysis'", [workspaceId])).rows
    try {
      expect(await milestones()).toHaveLength(0)
      await db.query("update workspaces set access_state='internal',plan='internal',locale=$1 where id=$2", [locale, workspaceId])
      await db.query("insert into clients(id,workspace_id,google_customer_id,name,currency_code,timezone) values($1,$2,'8000000094','Qualified analysis fixture','EUR','Europe/Paris')", [clientId, workspaceId])
      await db.query("insert into activation_milestones(workspace_id,milestone,actor_user_id,source_entity_id) values($1,'first_analysis','fixture',$2) on conflict do nothing", [workspaceId, clientId])
      const period = reportCalendarWindow({ period: '30', now: new Date(), timezone: 'Europe/Paris' })
      const coverage = { version: 1, queries: [{ queryHash: 'a'.repeat(64), rows: 1, pages: 1, bytes: 100, limit: 500, state: 'query_complete' }] }
      const datasets = { campaigns: [], searchTerms: [], keywords: [], ads: [], tracking: { status: 'MANAGED_BY_THIS_CUSTOMER', managerCustomer: null, acceptedCustomerDataTerms: true, enhancedConversionsForLeadsEnabled: true } }
      const sourceVersions = Object.fromEntries(Object.keys(datasets).map((family) => [family, randomUUID()]))
      for (const [family, payload] of Object.entries(datasets)) await db.query('insert into analytical_collections(workspace_id,client_id,family,contract_version,period_from,period_through,timezone,currency_code,source_version,observed_at,payload,coverage) values($1,$2,$3,1,$4,$5,$6,$7,$8,now(),$9,$10)', [workspaceId, clientId, family, period.from, period.through, 'Europe/Paris', 'EUR', sourceVersions[family], JSON.stringify(payload), JSON.stringify(coverage)])
      const page = await context.newPage(), errors: string[] = []
      page.on('pageerror', (error) => errors.push(error.message))
      await page.goto(`/analysis?client=${clientId}`)
      await expect(page.getByRole('heading', { name: /Analysis not yet available|Analyse pas encore disponible/ })).toBeVisible()
      expect(await milestones()).toHaveLength(0)
      const campaign = { id: '42', name: 'Analysis campaign', status: 'ENABLED', channelType: 'SEARCH', budgetResourceName: 'customers/8000000094/campaignBudgets/1', budgetMicros: '10000000', costMicros: '123000000', clicks: '200', impressions: '1000', conversions: 12, conversionValueMicros: '500000000', searchBudgetLostImpressionShare: null, searchRankLostImpressionShare: null }
      await db.query("update analytical_collections set payload=$1 where client_id=$2 and family='campaigns'", [JSON.stringify([campaign]), clientId])
      for (const state of ['unknown', 'stale', 'limited']) {
        await db.query('update analytical_collections set observed_at=now(),coverage=$1 where client_id=$2', [JSON.stringify(coverage), clientId])
        await db.query("update analytical_collections set observed_at=$1,coverage=$2 where client_id=$3 and family='keywords'", [state === 'stale' ? new Date(Date.now() - 27 * 3600_000) : new Date(), state === 'unknown' ? null : JSON.stringify(state === 'limited' ? { version: 1, queries: [{ ...coverage.queries[0], rows: 500, state: 'limit_reached' }] } : coverage), clientId])
        await page.reload()
        await expect(page.locator('[data-analysis-score]')).toHaveText('—')
        expect(await milestones()).toHaveLength(0)
      }
      await db.query('update analytical_collections set observed_at=now(),coverage=$1 where client_id=$2', [JSON.stringify(coverage), clientId])
      await page.reload()
      await expect(page.locator('[data-analysis-score]')).toHaveText('100')
      await expect(page.getByRole('progressbar', { name: /Opportunity score|Score d’opportunité/ })).toHaveAttribute('value', '100')
      const events = await milestones()
      expect(events).toHaveLength(1)
      expect(events[0].source_entity_id).toBe(clientId)
      expect(events[0].metadata).toMatchObject({ evidence: 'analysis_sources_v1', periodFrom: period.from, periodThrough: period.through, sourceVersions })
      expect((await db.query("select count(*)::int as count from activation_milestones where workspace_id=$1 and milestone='first_analysis'", [workspaceId])).rows[0].count).toBe(1)
      await page.reload()
      expect(await milestones()).toEqual(events)
      await page.screenshot({ path: test.info().outputPath(`qualified-analysis-${locale}.png`), caret: 'initial', fullPage: true })
      await db.query("update analytical_collections set observed_at=now()-interval '2 days' where client_id=$1", [clientId])
      await page.reload()
      await expect(page.locator('[data-analysis-score]')).toHaveText('—')
      expect(await milestones()).toEqual(events)
      expect(errors).toEqual([])
    } finally {
      await context.close()
      await db.query('delete from activation_milestones where workspace_id=$1 and source_entity_id=$2', [workspaceId, clientId])
      await db.query('delete from clients where id=$1', [clientId])
      await db.query('update workspaces set access_state=$1,plan=$2,locale=$3 where id=$4', [original.access_state, original.plan, original.locale, workspaceId])
      await db.end()
    }
  })
}
