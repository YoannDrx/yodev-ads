import { expect, test } from '@playwright/test'
import { Client } from 'pg'

if (process.env.PLAYWRIGHT_LOCAL_FIXTURE === '1') {
  const connectionString = process.env.DATABASE_SYSTEM_URL!
  const url = new URL(connectionString)
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || !url.pathname.startsWith('/yodev_test')) throw new Error('Disposable database required')
  const workspaceId = '80000000-0000-4000-8000-000000000001', clientId = '80000000-0000-4000-8000-000000000078', agentId = '80000000-0000-4000-8000-000000000079'
  const db = new Client({ connectionString }), marker = 'collection-browser-fixture'
  test.describe.serial('workspace collection navigation', () => {
    test.setTimeout(120_000)
    test.beforeAll(() => db.connect())
    test.afterAll(() => db.end())
    for (const locale of ['fr', 'en'] as const) test(`searches older records and conversations in ${locale}`, async ({ browser }) => {
      await db.query('update workspaces set access_state=$1,plan=$2,locale=$3 where id=$4', ['internal', 'internal', locale, workspaceId])
      await db.query('update workspaces set brand_name=$1 where id=$2', ['Élan Ανάλυση · ' + 'W'.repeat(80), workspaceId])
      await db.query('insert into clients(id,workspace_id,google_customer_id,name) values($1,$2,$3,$4)', [clientId, workspaceId, '8000000078', 'Collection browser'])
      await db.query('insert into monitoring_agents(id,workspace_id,created_by,kind,name,description,threshold) values($1,$2,$3,$4,$5,$6,$7)', [agentId, workspaceId, marker, 'no_delivery', 'Collection browser', 'Fixture', '0'])
      await db.query(`insert into audit_events(workspace_id,actor_user_id,action,entity_type,created_at) select $1,$2,'COLL_AUDIT_'||lpad(n::text,3,'0'),'fixture',now()-interval '1 day'+n*interval '1 microsecond' from generate_series(1,521) n`, [workspaceId, marker])
      await db.query(`insert into workspace_tasks(workspace_id,created_by,title,description,created_at) select $1,$2,'COLL_TASK_'||lpad(n::text,3,'0'),'Fixture',now()-interval '1 day'+n*interval '1 microsecond' from generate_series(1,521) n`, [workspaceId, marker])
      await db.query(`insert into support_tickets(workspace_id,requested_by,subject,category,created_at) select $1,$2,'COLL_SUPPORT_'||lpad(n::text,3,'0'),'technical',now()-interval '1 day'+n*interval '1 microsecond' from generate_series(1,521) n`, [workspaceId, marker])
      await db.query(`insert into approval_requests(workspace_id,client_id,requested_by,kind,title,payload,expires_at,created_at) select $1,$2,$3,'campaign_status','COLL_APPROVAL_'||lpad(n::text,3,'0'),'{}',now()+interval '1 day',now()-interval '1 day'+n*interval '1 microsecond' from generate_series(1,521) n`, [workspaceId, clientId, marker])
      await db.query(`insert into alert_incidents(workspace_id,client_id,agent_id,fingerprint,title,description,created_at) select $1,$2,$3,'collection-browser-'||n,'COLL_ALERT_'||lpad(n::text,3,'0'),'Fixture',now()-interval '1 day'+n*interval '1 microsecond' from generate_series(1,521) n`, [workspaceId, clientId, agentId])
      const task = (await db.query('select id from workspace_tasks where workspace_id=$1 and title=$2', [workspaceId, 'COLL_TASK_001'])).rows[0]
      const ticket = (await db.query('select id from support_tickets where workspace_id=$1 and subject=$2', [workspaceId, 'COLL_SUPPORT_001'])).rows[0]
      await db.query(`insert into task_comments(workspace_id,task_id,author_user_id,body,created_at) select $1,$2,$3,'COLL_MESSAGE_'||lpad(n::text,3,'0'),now()-interval '1 day'+n*interval '1 microsecond' from generate_series(1,701) n`, [workspaceId, task.id, marker])
      await db.query(`insert into support_messages(workspace_id,ticket_id,author_user_id,author_kind,body,internal) values($1,$2,$3,'support','PRIVATE_INTERNAL_NOTE',true)`, [workspaceId, ticket.id, marker])
      const context = await browser.newContext({ baseURL: process.env.PLAYWRIGHT_BASE_URL, storageState: process.env.PLAYWRIGHT_OWNER_STORAGE_STATE, viewport: { width: locale === 'fr' ? 390 : 1440, height: 900 } })
      const page = await context.newPage(), errors: string[] = []
      page.on('pageerror', (error) => errors.push(error.message))
      try {
        for (const [kind, prefix] of [['audit', 'AUDIT'], ['tasks', 'TASK'], ['alerts', 'ALERT'], ['approvals', 'APPROVAL'], ['support', 'SUPPORT']]) {
          await page.goto(`/${kind}?q=COLL_${prefix}_`)
          const consent = page.getByRole('button', { name: /Continuer sans mesure|Continue without/ })
          if (await consent.isVisible()) await consent.click()
          await expect(page.getByText(/521 (matching results|résultats correspondants)/)).toBeVisible()
          await expect(page.getByText(`COLL_${prefix}_521`, { exact: true })).toBeVisible()
          await page.getByRole('link', { name: /^(Older results|Résultats plus anciens)$/ }).click()
          await expect(page).toHaveURL(/cursor=/)
          await expect(page.getByText(`COLL_${prefix}_496`, { exact: true })).toBeVisible()
          await expect(page.getByText(`COLL_${prefix}_521`, { exact: true })).toHaveCount(0)
          await page.getByRole('searchbox', { name: /Search all results|Rechercher dans tous/ }).fill(`COLL_${prefix}_001`)
          await page.getByRole('button', { name: /Apply filters|Appliquer les filtres/ }).click()
          await expect(page).not.toHaveURL(/cursor=/)
          await expect(page.getByText(`COLL_${prefix}_001`, { exact: true })).toBeVisible()
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
          if (kind === 'tasks') {
            await page.getByRole('textbox', { name: /Task comment|Commentaire de tâche/ }).fill('NEW_REPLY_FROM_OLD_RECORD')
            await page.getByRole('button', { name: /Add comment|Ajouter le commentaire/ }).click()
            await expect(page).toHaveURL(new RegExp(`id=${task.id}`))
            await expect(page.getByText('NEW_REPLY_FROM_OLD_RECORD', { exact: true })).toBeVisible()
            await expect(page.getByText('COLL_MESSAGE_701', { exact: true })).toBeVisible()
            await expect(page.getByText('COLL_MESSAGE_001', { exact: true })).toHaveCount(0)
            await page.getByRole('link', { name: /Latest 5 messages|5 derniers messages/ }).click()
            await expect(page).toHaveURL(new RegExp(`/discussions/tasks/${task.id}`))
            await expect(page.getByText(/702 (matching results|résultats correspondants)/)).toBeVisible()
            await page.getByRole('link', { name: /^(Older results|Résultats plus anciens)$/ }).click()
            await expect(page.getByText('COLL_MESSAGE_677', { exact: true })).toBeVisible()
            await page.getByRole('searchbox', { name: /Search all results|Rechercher dans tous/ }).fill('COLL_MESSAGE_001')
            await page.getByRole('button', { name: /Apply filters|Appliquer les filtres/ }).click()
            await expect(page.getByText('COLL_MESSAGE_001', { exact: true })).toBeVisible()
            await page.screenshot({ path: test.info().outputPath(`discussion-${locale}.png`), fullPage: true })
          }
          if (kind === 'support') await expect(page.getByText('PRIVATE_INTERNAL_NOTE')).toHaveCount(0)
        }
        await page.screenshot({ path: test.info().outputPath(`collections-${locale}.png`), fullPage: true })
        await page.goto('/tasks?cursor=forged')
        await expect(page.getByRole('alert')).toContainText(/invalid|invalide/)
        await expect(page.getByText('COLL_TASK_521', { exact: true })).toHaveCount(0)
        const clientContext = await browser.newContext({ baseURL: process.env.PLAYWRIGHT_BASE_URL, storageState: process.env.PLAYWRIGHT_CLIENT_STORAGE_STATE })
        try {
          const reader = await clientContext.newPage(); await reader.goto('/support?q=COLL_SUPPORT_')
          await expect(reader.getByText('COLL_SUPPORT_001', { exact: true })).toHaveCount(0)
          const response = await reader.goto(`/discussions/support/${ticket.id}`)
          expect(response?.status()).toBe(404)
          await expect(reader.getByText('PRIVATE_INTERNAL_NOTE')).toHaveCount(0)
        } finally { await clientContext.close() }
        expect(errors).toEqual([])
      } finally {
        await context.close()
        await db.query('delete from workspace_tasks where workspace_id=$1 and created_by=$2', [workspaceId, marker])
        await db.query('delete from support_tickets where workspace_id=$1 and requested_by=$2', [workspaceId, marker])
        await db.query('delete from audit_events where workspace_id=$1 and actor_user_id=$2', [workspaceId, marker])
        await db.query('delete from monitoring_agents where id=$1', [agentId])
        await db.query('delete from clients where id=$1', [clientId])
        await db.query('update workspaces set locale=$1 where id=$2', ['fr', workspaceId])
      }
    })
  })
}
