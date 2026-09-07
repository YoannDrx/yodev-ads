import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { Client } from 'pg'

if (process.env.PLAYWRIGHT_LOCAL_FIXTURE === '1' && process.env.PLAYWRIGHT_ANALYTICS_CONTROLS === '1' && process.env.PLAYWRIGHT_SECURITY_CONTROLS === '1') for (const locale of ['fr', 'en'] as const) {
  test(`analyst manages templates and schedules and loses write access in ${locale}`, async ({ browser }) => {
    const url = new URL(process.env.DATABASE_SYSTEM_URL!)
    if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || !url.pathname.startsWith('/yodev_test')) throw new Error('Disposable database required')
    const db = new Client({ connectionString: url.href }); await db.connect()
    const workspaceId = '80000000-0000-4000-8000-000000000001', actor = 'local-browser-fixture-analyst', clientId = randomUUID(), marker = `Management ${locale} ${randomUUID().slice(0, 8)}`
    const original = (await db.query('select plan,access_state,locale from workspaces where id=$1', [workspaceId])).rows[0]
    const membership = (await db.query("select id,role from auth_members where organization_id='local-browser-fixture-main' and user_id=$1", [actor])).rows[0]
    const beforeAudits = (await db.query('select id from audit_events where workspace_id=$1 and actor_user_id=$2', [workspaceId, actor])).rows.map((row) => row.id)
    const context = await browser.newContext({ baseURL: process.env.PLAYWRIGHT_BASE_URL, storageState: process.env.PLAYWRIGHT_ANALYST_STORAGE_STATE, viewport: { width: locale === 'fr' ? 390 : 1440, height: 950 } })
    try {
      await context.addCookies([{ name: 'yodev_cookie_consent', value: 'rejected', url: process.env.PLAYWRIGHT_BASE_URL! }])
      await db.query("update workspaces set plan='agency',access_state='active',locale=$1 where id=$2", [locale, workspaceId])
      await db.query("insert into clients(id,workspace_id,google_customer_id,name,active,managed_selected,google_accessible) values($1,$2,'8480000002','Management advertiser',true,true,true)", [clientId, workspaceId])
      const page = await context.newPage(), errors: string[] = []; page.on('pageerror', (error) => errors.push(error.message))
      await page.goto('/reports'); await page.locator('#template-name').fill(marker)
      await page.getByRole('button', { name: /Save template|Enregistrer le modèle/, exact: true }).click()
      await expect(page.getByRole('button', { name: /Save new version|Enregistrer une version/, exact: true })).toBeVisible()
      const templateId = (await db.query('select id from report_templates where workspace_id=$1 and name=$2', [workspaceId, marker])).rows[0].id
      const templateForm = page.locator('form').filter({ has: page.locator(`[name="templateId"][value="${templateId}"]`) })
      const edit = templateForm.filter({ has: page.locator('[name="expectedVersion"]') })
      await edit.locator('[name="name"]').fill(`${marker} edited`); await edit.getByRole('button').click()
      await expect(edit.locator('[name="expectedVersion"]')).toHaveValue('2')
      expect((await db.query('select count(*) from report_template_versions where template_id=$1', [templateId])).rows[0].count).toBe('2')
      await page.locator('#schedule-name').fill(marker); await page.locator('#schedule-client').selectOption(clientId); await page.locator('#schedule-template').selectOption(templateId); await page.locator('#schedule-recipients').fill('fixture@example.test')
      await page.getByRole('button', { name: /Create schedule|Créer la planification/, exact: true }).click()
      await expect(page.locator('section').filter({ has: page.getByRole('heading', { name: /Scheduled deliveries|Envois planifiés/, exact: true }) }).getByRole('heading', { name: marker, exact: true })).toBeVisible()
      const scheduleId = (await db.query('select id from report_schedules where workspace_id=$1 and name=$2', [workspaceId, marker])).rows[0].id
      const scheduleForm = page.locator('form').filter({ has: page.locator(`[name="scheduleId"][value="${scheduleId}"]`) })
      const tokenHash = async () => (await db.query('select token_hash from share_links l join report_schedules s on s.share_id=l.id where s.id=$1', [scheduleId])).rows[0].token_hash
      const firstHash = await tokenHash()
      await scheduleForm.getByRole('button', { name: /Renew link|Renouveler le lien/, exact: true }).click()
      await expect.poll(tokenHash).not.toBe(firstHash)
      await scheduleForm.getByRole('button', { name: /Suspend and revoke|Suspendre et révoquer/, exact: true }).click()
      await expect(scheduleForm.getByRole('button', { name: /Reactivate|Réactiver/, exact: true })).toBeVisible()
      await scheduleForm.getByRole('button', { name: /Reactivate|Réactiver/, exact: true }).click()
      await expect(scheduleForm.getByRole('button', { name: /Renew link|Renouveler le lien/, exact: true })).toBeVisible()
      await templateForm.getByRole('button', { name: /Deactivate|Désactiver/, exact: true }).click()
      await expect(edit).toHaveCount(0)
      await page.locator('#template-name').fill(`${marker} denied`)
      await db.query("update auth_members set role='client' where id=$1", [membership.id])
      await page.getByRole('button', { name: /Save template|Enregistrer le modèle/, exact: true }).click()
      await expect(page.getByRole('heading', { name: /Get help from Yodev|Obtenir l’aide de Yodev/ })).toBeVisible()
      expect((await db.query('select count(*) from report_templates where workspace_id=$1 and name=$2', [workspaceId, `${marker} denied`])).rows[0].count).toBe('0')
      expect(errors).toEqual([])
    } finally {
      await context.close(); await db.query('update auth_members set role=$1 where id=$2', [membership.role, membership.id])
      await db.query('delete from clients where id=$1', [clientId])
      await db.query('delete from report_templates where workspace_id=$1 and name=any($2::text[])', [workspaceId, [marker, `${marker} edited`, `${marker} denied`]])
      await db.query('delete from audit_events where workspace_id=$1 and actor_user_id=$2 and not(id=any($3::uuid[]))', [workspaceId, actor, beforeAudits])
      await db.query('update workspaces set plan=$1,access_state=$2,locale=$3 where id=$4', [original.plan, original.access_state, original.locale, workspaceId]); await db.end()
    }
  })
}
