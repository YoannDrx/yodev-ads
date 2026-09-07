import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { Client } from 'pg'

if (process.env.PLAYWRIGHT_LOCAL_FIXTURE === '1' && process.env.PLAYWRIGHT_ANALYTICS_CONTROLS === '1') for (const [index, locale] of ['fr', 'en'].entries()) {
  test(`monitoring actor ${locale} preserves authorized controls and rejects a revoked form`, async ({ browser }) => {
    const url = new URL(process.env.DATABASE_SYSTEM_URL!)
    if (!['localhost','127.0.0.1','[::1]'].includes(url.hostname) || !url.pathname.startsWith('/yodev_test')) throw new Error('Disposable database required')
    const db = new Client({ connectionString: url.href }), workspaceId = '80000000-0000-4000-8000-000000000001', userId = 'local-browser-fixture-strategist', clientId = randomUUID(), incidentId = randomUUID()
    await db.connect()
    const original = (await db.query('select access_state,plan,locale from workspaces where id=$1',[workspaceId])).rows[0]
    const member = (await db.query("select id,role from auth_members where organization_id='local-browser-fixture-main' and user_id=$1",[userId])).rows[0]
    const context = await browser.newContext({ baseURL: process.env.PLAYWRIGHT_BASE_URL, storageState: process.env.PLAYWRIGHT_STRATEGIST_STORAGE_STATE, viewport: { width: locale==='fr'?390:1440, height:950 }, extraHTTPHeaders:{'x-forwarded-for':`198.18.35.${index+1}`} })
    await context.addCookies([{ name:'yodev_cookie_consent',value:'rejected',url:process.env.PLAYWRIGHT_BASE_URL! }])
    let agentId: string | undefined
    try {
      await db.query("update workspaces set access_state='internal',plan='internal',locale=$1 where id=$2",[locale,workspaceId])
      await db.query("insert into clients(id,workspace_id,google_customer_id,name) values($1,$2,'8000000034','Actor workflow account')",[clientId,workspaceId])
      const page=await context.newPage(), errors:string[]=[]
      page.on('pageerror',(error)=>errors.push(error.message));page.setDefaultTimeout(15000)
      await page.goto('/agents')
      const create=page.locator('form:has(input[name="kind"][value="no_delivery"])')
      await create.getByRole('combobox',{name:/^(Scope|Périmètre)$/}).selectOption(clientId)
      await create.getByRole('button',{name:/^(Enable|Activer)$/}).click()
      await expect(page).toHaveURL(/notice=/)
      agentId=(await db.query('select id from monitoring_agents where client_id=$1',[clientId])).rows[0].id
      const toggle=page.locator(`form:has(input[name="agentId"][value="${agentId}"]):has(input[name="enabled"])`)
      await toggle.getByRole('button').click()
      await expect.poll(async()=> (await db.query('select enabled from monitoring_agents where id=$1',[agentId])).rows[0].enabled).toBe(false)
      await toggle.getByRole('button',{name:/Reactivate|Réactiver/}).click()
      await expect.poll(async()=> (await db.query('select enabled from monitoring_agents where id=$1',[agentId])).rows[0].enabled).toBe(true)
      await page.locator(`form:has(input[name="agentId"][value="${agentId}"]):not(:has(input[name="enabled"]))`).getByRole('button').click()
      await expect(page).toHaveURL(/\/alerts\?notice=/)
      expect(Number((await db.query("select count(*) from jobs where workspace_id=$1 and type in ('monitoring.scan','monitoring.scan_chunk') and status in ('queued','running','retrying')",[workspaceId])).rows[0].count)).toBeGreaterThan(0)
      await db.query("insert into alert_incidents(id,workspace_id,client_id,agent_id,fingerprint,title,description) values($1,$2,$3,$4,$1::uuid::text,'Actor workflow alert','Fixture')",[incidentId,workspaceId,clientId,agentId])
      await page.goto(`/alerts?id=${incidentId}`)
      const workflow=page.locator(`form:has(input[name="incidentId"][value="${incidentId}"]):has(select[name="operation"])`)
      await workflow.getByRole('combobox').selectOption('acknowledge');await workflow.getByRole('button').click()
      await expect.poll(async()=> (await db.query('select status from alert_incidents where id=$1',[incidentId])).rows[0].status).toBe('acknowledged')
      await workflow.getByRole('combobox').selectOption('resolve');await workflow.getByRole('button').click()
      await expect.poll(async()=> (await db.query('select status from alert_incidents where id=$1',[incidentId])).rows[0].status).toBe('resolved')
      await page.getByRole('button',{name:/^(Reopen|Rouvrir)$/}).click()
      await expect.poll(async()=> (await db.query('select status from alert_incidents where id=$1',[incidentId])).rows[0].status).toBe('reopened')
      await workflow.getByRole('combobox').selectOption('resolve')
      await db.query("update auth_members set role='analyst' where id=$1",[member.id])
      await workflow.getByRole('button').click()
      await expect(page).toHaveURL(/error=/)
      expect((await db.query('select status from alert_incidents where id=$1',[incidentId])).rows[0].status).toBe('reopened')
      await expect(workflow).toHaveCount(0)
      await db.query("update auth_members set role='strategist' where id=$1",[member.id]);await page.reload()
      await expect(workflow).toBeVisible()
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true)
      await page.evaluate(()=>window.scrollTo(0,0))
      await page.screenshot({path:test.info().outputPath(`monitoring-actor-${locale}.png`),fullPage:true,caret:'initial'})
      expect(errors).toEqual([])
    } finally {
      await context.close().catch(()=>{})
      await db.query('update auth_members set role=$1 where id=$2',[member.role,member.id])
      const removedJobs = await db.query("delete from jobs where workspace_id=$1 and payload->>'agentId'=$2 returning id",[workspaceId,agentId??''])
      await db.query("delete from activation_milestones where workspace_id=$1 and milestone='first_monitor' and source_entity_id=$2",[workspaceId,agentId??''])
      await db.query('delete from audit_events where workspace_id=$1 and entity_id=any($2::text[])',[workspaceId,[clientId,incidentId,...(agentId?[agentId]:[]),...removedJobs.rows.map((job)=>job.id)]])
      await db.query('delete from clients where id=$1',[clientId])
      if(agentId) await db.query('delete from monitoring_agents where id=$1',[agentId])
      await db.query('update workspaces set access_state=$1,plan=$2,locale=$3 where id=$4',[original.access_state,original.plan,original.locale,workspaceId])
      await db.end()
    }
  })
}
