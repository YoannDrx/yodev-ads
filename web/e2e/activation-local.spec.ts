import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { Client } from 'pg'

if (process.env.PLAYWRIGHT_LOCAL_FIXTURE === '1') {
  test('operations counts published reports and excludes legacy or future activation', async ({ browser }) => {
    const connectionString = process.env.DATABASE_SYSTEM_URL!, url = new URL(connectionString)
    if (!['localhost','127.0.0.1','[::1]'].includes(url.hostname) || !url.pathname.startsWith('/yodev_test')) throw new Error('Disposable database required')
    const db = new Client({ connectionString }), ids = [randomUUID(),randomUUID()], createdAt = new Date(Date.now()-3*86_400_000)
    await db.connect()
    const baseline = Number((await db.query("select count(distinct a.workspace_id) as total from activation_milestones a join workspaces w on w.id=a.workspace_id where w.access_state not in ('internal','deleted') and a.milestone='first_report_published' and a.occurred_at>=w.created_at and a.occurred_at<=now()")).rows[0].total)
    const context = await browser.newContext({ baseURL: process.env.PLAYWRIGHT_BASE_URL, storageState: process.env.PLAYWRIGHT_OWNER_STORAGE_STATE, viewport: { width: 1440,height: 1000 } })
    await context.addCookies([{name:'yodev_cookie_consent',value:'rejected',url:process.env.PLAYWRIGHT_BASE_URL!}])
    try {
      await db.query("insert into workspaces(id,owner_user_id,name,slug,plan,access_state,created_at) select id,'activation-browser','Activation fixture','activation-'||id,'agency','active',$2 from unnest($1::uuid[]) id",[ids,createdAt])
      await db.query("insert into activation_milestones(workspace_id,milestone,actor_user_id,occurred_at) values($1,'first_report','fixture',now()),($2,'first_report_published','fixture',now()),($1,'first_report_published','fixture',now()+interval '1 day')",ids)
      const page=await context.newPage()
      await page.goto('/operations')
      const published=page.getByRole('progressbar',{name:'Premier rapport publié',exact:true})
      await expect(published).toHaveAttribute('value',String(baseline+1))
      await expect(page.getByText('Un rapport publié correspond à une édition disponible', { exact:false })).toBeVisible()
      await expect(page.getByText('Premier rapport',{exact:true})).toHaveCount(0)
      await expect(page.getByRole('combobox',{name:/Workspace actif|Active workspace/})).toBeVisible()
      await page.screenshot({path:test.info().outputPath('activation-operations.png'),caret:'initial'})
    } finally {
      await context.close()
      await db.query('delete from workspaces where id=any($1::uuid[])',[ids]);await db.end()
    }
  })
}
