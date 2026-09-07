import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { Client } from 'pg'
import { ACTIVATION_STAGES } from '../src/lib/activation-stages'

if (process.env.PLAYWRIGHT_LOCAL_FIXTURE === '1') {
  test('operations counts published reports and excludes legacy or future activation', async ({ browser }) => {
    const connectionString = process.env.DATABASE_SYSTEM_URL!, url = new URL(connectionString)
    if (!['localhost','127.0.0.1','[::1]'].includes(url.hostname) || !url.pathname.startsWith('/yodev_test')) throw new Error('Disposable database required')
    const db = new Client({ connectionString }), ids = [randomUUID(),randomUUID(),randomUUID(),randomUUID()], createdAt = new Date(Date.now()-3*86_400_000)
    await db.connect()
    const baseline = Number((await db.query("select count(distinct a.workspace_id) as total from activation_milestones a join workspaces w on w.id=a.workspace_id where w.access_state not in ('internal','deleted') and a.milestone='first_report_published' and a.occurred_at>=w.created_at and a.occurred_at<=now()")).rows[0].total)
    const analysisBaseline = Number((await db.query("select count(distinct a.workspace_id) as total from activation_milestones a join workspaces w on w.id=a.workspace_id where w.access_state not in ('internal','deleted') and a.milestone='first_qualified_analysis' and a.occurred_at>=w.created_at and a.occurred_at<=now()")).rows[0].total)
    const week = new Date(Date.UTC(createdAt.getUTCFullYear(), createdAt.getUTCMonth(), createdAt.getUTCDate()))
    week.setUTCDate(week.getUTCDate() - (week.getUTCDay() || 7) + 1)
    const through = new Date(week.getTime() + 7 * 86_400_000)
    const cohortBaseline = Number((await db.query("select count(*) as total from workspaces where access_state not in ('internal','deleted') and created_at >= $1 and created_at < $2 and created_at <= now()", [week, through])).rows[0].total)
    const stageBaseline = Object.fromEntries(await Promise.all(ACTIVATION_STAGES.map(async ({ milestone, field }) => [field, Number((await db.query("select count(distinct a.workspace_id) as total from activation_milestones a join workspaces w on w.id=a.workspace_id where w.access_state not in ('internal','deleted') and w.created_at >= $1 and w.created_at < $2 and a.milestone=$3 and a.occurred_at>=w.created_at and a.occurred_at<=now()", [week, through, milestone])).rows[0].total)])))
    const context = await browser.newContext({ baseURL: process.env.PLAYWRIGHT_BASE_URL, storageState: process.env.PLAYWRIGHT_OWNER_STORAGE_STATE, viewport: { width: 1440,height: 1000 } })
    await context.addCookies([{name:'yodev_cookie_consent',value:'rejected',url:process.env.PLAYWRIGHT_BASE_URL!}])
    try {
      await db.query("insert into workspaces(id,owner_user_id,name,slug,plan,access_state,created_at) select id,'activation-browser','Activation fixture','activation-'||id,'agency','active',$2 from unnest($1::uuid[]) id",[ids.slice(0, 2),createdAt])
      await db.query("insert into activation_milestones(workspace_id,milestone,actor_user_id,occurred_at) values($1,'first_report','fixture',now()),($2,'first_report_published','fixture',now()),($1,'first_report_published','fixture',now()+interval '1 day')",ids.slice(0, 2))
      await db.query("insert into activation_milestones(workspace_id,milestone,actor_user_id,occurred_at) values($1,'first_analysis','fixture',now()),($2,'first_qualified_analysis','fixture',now()),($1,'first_qualified_analysis','fixture',now()+interval '1 day')",ids.slice(0, 2))
      await db.query("insert into workspaces(id,owner_user_id,name,slug,plan,access_state,created_at) values($1,'activation-browser','Future fixture','activation-'||$1::uuid::text,'agency','active',now()+interval '1 day'),($2,'activation-browser','Internal fixture','activation-'||$2::uuid::text,'internal','internal',$3)", [ids[2], ids[3], createdAt])
      await db.query("insert into activation_milestones(workspace_id,milestone,actor_user_id,occurred_at) values($1,'google_connected','fixture',now()),($1,'accounts_synced','fixture',now()),($2,'accounts_synced','fixture',now()),($1,'accounts_selected','fixture',now()),($1,'first_monitor','fixture',now()),($2,'legal_accepted','fixture',now()),($3,'paid_conversion','fixture',now())", [ids[0], ids[1], ids[3]])
      const page=await context.newPage()
      await page.goto('/operations')
      const published=page.getByRole('progressbar',{name:'Premier rapport publié',exact:true})
      await expect(published).toHaveAttribute('value',String(baseline+1))
      await expect(page.getByRole('progressbar', { name: 'Première analyse qualifiée', exact: true })).toHaveAttribute('value', String(analysisBaseline + 1))
      await expect(page.getByText('Un rapport publié correspond à une édition disponible', { exact:false })).toBeVisible()
      await expect(page.getByText('Premier rapport',{exact:true})).toHaveCount(0)
      await expect(page.getByRole('combobox',{name:/Workspace actif|Active workspace/})).toBeVisible()
      const row = page.locator(`[data-cohort="${week.toISOString().slice(0, 10)}"]`)
      await expect(row.locator('[data-stage="workspaces"]')).toHaveText(String(cohortBaseline + 2))
      const additions: Record<string, number> = { googleConnected: 1, accountsSynced: 2, accountsSelected: 1, firstAnalysis: 1, firstMonitor: 1, firstReport: 1, legalAccepted: 1, paid: 0 }
      for (const { field } of ACTIVATION_STAGES) {
        const count = stageBaseline[field] + additions[field]
        await expect(row.locator(`[data-stage="${field}"]`)).toHaveText(`${count} (${Math.round(count / (cohortBaseline + 2) * 100)} %)`)
      }
      const region = page.getByRole('region', { name: 'Cohortes d’activation par semaine' })
      await region.scrollIntoViewIfNeeded()
      await page.screenshot({path:test.info().outputPath('activation-operations.png'),caret:'initial'})
      await page.setViewportSize({ width: 390, height: 950 })
      await region.focus()
      await page.keyboard.press('ArrowRight')
      await expect.poll(() => region.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
      await page.screenshot({path:test.info().outputPath('activation-operations-mobile.png'),caret:'initial'})
    } finally {
      await context.close()
      await db.query('delete from workspaces where id=any($1::uuid[])',[ids]);await db.end()
    }
  })
}
