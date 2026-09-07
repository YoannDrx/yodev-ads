# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: monitoring-actors-local.spec.ts >> monitoring actor en preserves authorized controls and rejects a revoked form
- Location: e2e/monitoring-actors-local.spec.ts:6:7

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: "resolved"
Received: "acknowledged"

Call Log:
- Timeout 15000ms exceeded while waiting on the predicate
```

# Test source

```ts
  1  | import { expect, test } from '@playwright/test'
  2  | import { randomUUID } from 'node:crypto'
  3  | import { Client } from 'pg'
  4  |
  5  | if (process.env.PLAYWRIGHT_LOCAL_FIXTURE === '1' && process.env.PLAYWRIGHT_ANALYTICS_CONTROLS === '1') for (const [index, locale] of ['fr', 'en'].entries()) {
  6  |   test(`monitoring actor ${locale} preserves authorized controls and rejects a revoked form`, async ({ browser }) => {
  7  |     const url = new URL(process.env.DATABASE_SYSTEM_URL!)
  8  |     if (!['localhost','127.0.0.1','[::1]'].includes(url.hostname) || !url.pathname.startsWith('/yodev_test')) throw new Error('Disposable database required')
  9  |     const db = new Client({ connectionString: url.href }), workspaceId = '80000000-0000-4000-8000-000000000001', userId = 'local-browser-fixture-strategist', clientId = randomUUID(), incidentId = randomUUID()
  10 |     await db.connect()
  11 |     const original = (await db.query('select access_state,plan,locale from workspaces where id=$1',[workspaceId])).rows[0]
  12 |     const member = (await db.query("select id,role from auth_members where organization_id='local-browser-fixture-main' and user_id=$1",[userId])).rows[0]
  13 |     const context = await browser.newContext({ baseURL: process.env.PLAYWRIGHT_BASE_URL, storageState: process.env.PLAYWRIGHT_STRATEGIST_STORAGE_STATE, viewport: { width: locale==='fr'?390:1440, height:950 }, extraHTTPHeaders:{'x-forwarded-for':`198.18.35.${index+1}`} })
  14 |     await context.addCookies([{ name:'yodev_cookie_consent',value:'rejected',url:process.env.PLAYWRIGHT_BASE_URL! }])
  15 |     let agentId: string | undefined
  16 |     try {
  17 |       await db.query("update workspaces set access_state='internal',plan='internal',locale=$1 where id=$2",[locale,workspaceId])
  18 |       await db.query("insert into clients(id,workspace_id,google_customer_id,name) values($1,$2,'8000000034','Actor workflow account')",[clientId,workspaceId])
  19 |       const page=await context.newPage(), errors:string[]=[]
  20 |       page.on('pageerror',(error)=>errors.push(error.message));page.setDefaultTimeout(15000)
  21 |       await page.goto('/agents')
  22 |       const create=page.locator('form:has(input[name="kind"][value="no_delivery"])')
  23 |       await create.getByRole('combobox',{name:/^(Scope|Périmètre)$/}).selectOption(clientId)
  24 |       await create.getByRole('button',{name:/^(Enable|Activer)$/}).click()
  25 |       await expect(page).toHaveURL(/notice=/)
  26 |       agentId=(await db.query('select id from monitoring_agents where client_id=$1',[clientId])).rows[0].id
  27 |       const toggle=page.locator(`form:has(input[name="agentId"][value="${agentId}"]):has(input[name="enabled"])`)
  28 |       await toggle.getByRole('button').click()
  29 |       await expect.poll(async()=> (await db.query('select enabled from monitoring_agents where id=$1',[agentId])).rows[0].enabled).toBe(false)
  30 |       await toggle.getByRole('button',{name:/Reactivate|Réactiver/}).click()
  31 |       await expect.poll(async()=> (await db.query('select enabled from monitoring_agents where id=$1',[agentId])).rows[0].enabled).toBe(true)
  32 |       await page.locator(`form:has(input[name="agentId"][value="${agentId}"]):not(:has(input[name="enabled"]))`).getByRole('button').click()
  33 |       await expect(page).toHaveURL(/\/alerts\?notice=/)
  34 |       expect(Number((await db.query("select count(*) from jobs where workspace_id=$1 and type in ('monitoring.scan','monitoring.scan_chunk') and status in ('queued','running','retrying')",[workspaceId])).rows[0].count)).toBeGreaterThan(0)
  35 |       await db.query("insert into alert_incidents(id,workspace_id,client_id,agent_id,fingerprint,title,description) values($1,$2,$3,$4,$1::uuid::text,'Actor workflow alert','Fixture')",[incidentId,workspaceId,clientId,agentId])
  36 |       await page.goto(`/alerts?id=${incidentId}`)
  37 |       const workflow=page.locator(`form:has(input[name="incidentId"][value="${incidentId}"]):has(select[name="operation"])`)
  38 |       await workflow.getByRole('combobox').selectOption('acknowledge');await workflow.getByRole('button').click()
  39 |       await expect.poll(async()=> (await db.query('select status from alert_incidents where id=$1',[incidentId])).rows[0].status).toBe('acknowledged')
  40 |       await workflow.getByRole('combobox').selectOption('resolve');await workflow.getByRole('button').click()
> 41 |       await expect.poll(async()=> (await db.query('select status from alert_incidents where id=$1',[incidentId])).rows[0].status).toBe('resolved')
     |                                                                                                                                   ^ Error: expect(received).toBe(expected) // Object.is equality
  42 |       await page.getByRole('button',{name:/^(Reopen|Rouvrir)$/}).click()
  43 |       await expect.poll(async()=> (await db.query('select status from alert_incidents where id=$1',[incidentId])).rows[0].status).toBe('reopened')
  44 |       await workflow.getByRole('combobox').selectOption('resolve')
  45 |       await db.query("update auth_members set role='analyst' where id=$1",[member.id])
  46 |       await workflow.getByRole('button').click()
  47 |       await expect(page).toHaveURL(/error=/)
  48 |       await expect(page.getByText(locale === 'fr'
  49 |         ? 'Vos droits actuels ne permettent pas cette action. Rechargez la page ou contactez un administrateur.'
  50 |         : 'Your current permissions do not allow this action. Reload the page or contact an administrator.', { exact: true })).toBeVisible()
  51 |       expect((await db.query('select status from alert_incidents where id=$1',[incidentId])).rows[0].status).toBe('reopened')
  52 |       await expect(workflow).toHaveCount(0)
  53 |       await db.query("update auth_members set role='strategist' where id=$1",[member.id]);await page.reload()
  54 |       await expect(workflow).toBeVisible()
  55 |       expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true)
  56 |       await page.evaluate(()=>window.scrollTo(0,0))
  57 |       await page.screenshot({path:test.info().outputPath(`monitoring-actor-${locale}.png`),fullPage:true,caret:'initial'})
  58 |       expect(errors).toEqual([])
  59 |     } finally {
  60 |       await context.close().catch(()=>{})
  61 |       await db.query('update auth_members set role=$1 where id=$2',[member.role,member.id])
  62 |       const removedJobs = await db.query("delete from jobs where workspace_id=$1 and payload->>'agentId'=$2 returning id",[workspaceId,agentId??''])
  63 |       await db.query("delete from activation_milestones where workspace_id=$1 and milestone='first_monitor' and source_entity_id=$2",[workspaceId,agentId??''])
  64 |       await db.query('delete from audit_events where workspace_id=$1 and entity_id=any($2::text[])',[workspaceId,[clientId,incidentId,...(agentId?[agentId]:[]),...removedJobs.rows.map((job)=>job.id)]])
  65 |       await db.query('delete from clients where id=$1',[clientId])
  66 |       if(agentId) await db.query('delete from monitoring_agents where id=$1',[agentId])
  67 |       await db.query('update workspaces set access_state=$1,plan=$2,locale=$3 where id=$4',[original.access_state,original.plan,original.locale,workspaceId])
  68 |       await db.end()
  69 |     }
  70 |   })
  71 | }
  72 |
```
