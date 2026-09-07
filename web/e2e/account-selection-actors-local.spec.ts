import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { Client } from 'pg'

if (process.env.PLAYWRIGHT_LOCAL_FIXTURE === '1') for (const [index, locale] of ['fr', 'en'].entries()) {
  test(`account selection actor ${locale} saves and refuses stale workspace, role and grace forms`, async ({ browser }) => {
    const url = new URL(process.env.DATABASE_SYSTEM_URL!)
    if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || !url.pathname.startsWith('/yodev_test')) throw new Error('Disposable database required')
    const db = new Client({ connectionString: url.href }), workspaceId = '80000000-0000-4000-8000-000000000001', actor = 'local-browser-fixture-admin'
    const ids = [randomUUID(), randomUUID()]
    await db.connect()
    const original = (await db.query('select access_state,plan,locale from workspaces where id=$1', [workspaceId])).rows[0]
    const context = await browser.newContext({ baseURL: process.env.PLAYWRIGHT_BASE_URL, storageState: process.env.PLAYWRIGHT_ADMIN_STORAGE_STATE, viewport: { width: locale === 'fr' ? 390 : 1440, height: 950 }, extraHTTPHeaders: { 'x-forwarded-for': `198.18.42.${index + 1}` } })
    try {
      await context.addCookies([{ name: 'yodev_cookie_consent', value: 'rejected', url: process.env.PLAYWRIGHT_BASE_URL! }])
      await db.query("update workspaces set access_state='active',plan='agency',locale=$1 where id=$2", [locale, workspaceId])
      await db.query("insert into clients(id,workspace_id,google_customer_id,name,managed_selected,management_priority,google_accessible,active) values($1,$3,'8420000001','Actor first',true,0,true,true),($2,$3,'8420000002','Actor second',true,1,true,true)", [ids[0], ids[1], workspaceId])
      const page = await context.newPage(), errors: string[] = []
      page.on('pageerror', (error) => errors.push(error.message))
      const order = async () => (await db.query('select id from clients where workspace_id=$1 and managed_selected order by management_priority', [workspaceId])).rows.map((row) => row.id)
      const saves = async () => (await db.query("select count(*) from audit_events where workspace_id=$1 and actor_user_id=$2 and action='google_ads.account_selection_saved'", [workspaceId, actor])).rows[0].count
      await page.goto('/accounts')
      const save = page.getByRole('button', { name: locale === 'fr' ? 'Enregistrer la sélection' : 'Save selection', exact: true })
      await page.getByRole('button', { name: `${locale === 'fr' ? 'Monter' : 'Move up'} Actor second`, exact: true }).click()
      await save.click(); await expect(page.getByText(locale === 'fr' ? 'Sélection enregistrée.' : 'Selection saved.', { exact: true })).toBeVisible()
      expect(await order()).toEqual([ids[1], ids[0]])
      await page.locator('[name="workspaceId"]').evaluate((element) => { (element as HTMLInputElement).value = '80000000-0000-4000-8000-000000000002' })
      await save.click(); await expect(page).toHaveURL(/selection=workspace_changed/)
      await expect(page.getByText(locale === 'fr' ? 'L’espace actif a changé. Vérifiez les comptes de cet espace avant d’enregistrer.' : 'The active workspace changed. Review this workspace’s accounts before saving.', { exact: true })).toBeVisible()
      expect(await saves()).toBe('1')
      await page.getByRole('button', { name: `${locale === 'fr' ? 'Retirer' : 'Remove'} Actor first`, exact: true }).click()
      await db.query("update auth_members set role='analyst' where organization_id='local-browser-fixture-main' and user_id=$1", [actor])
      await save.click(); await expect(page).toHaveURL(/selection=unavailable/)
      await expect(page.getByText(locale === 'fr' ? 'La sélection n’a pas pu être enregistrée. Vérifiez vos droits actuels, le quota du forfait et les comptes disponibles.' : 'Selection could not be saved. Check your current permissions, plan quota and available accounts.', { exact: true })).toBeVisible()
      await expect(save).toHaveCount(0); expect(await order()).toEqual([ids[1], ids[0]])
      await page.evaluate(() => document.fonts.ready)
      await page.screenshot({ path: test.info().outputPath(`account-selection-actor-${locale}.png`), fullPage: true })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await db.query("update auth_members set role='admin' where organization_id='local-browser-fixture-main' and user_id=$1", [actor])
      await page.goto('/accounts'); await page.getByRole('button', { name: locale === 'fr' ? 'Vider la sélection' : 'Clear selection', exact: true }).click()
      await db.query("update workspaces set access_state='grace' where id=$1", [workspaceId])
      await save.click(); await expect(save).toHaveCount(0)
      expect(await order()).toEqual([ids[1], ids[0]]); expect(await saves()).toBe('1'); expect(errors).toEqual([])
    } finally {
      await context.close().catch(() => {})
      await db.query("update auth_members set role='admin' where organization_id='local-browser-fixture-main' and user_id=$1", [actor])
      await db.query("delete from audit_events where workspace_id=$1 and actor_user_id=$2 and action='google_ads.account_selection_saved'", [workspaceId, actor])
      await db.query('delete from activation_milestones where workspace_id=$1 and source_entity_id=any($2::text[])', [workspaceId, ids])
      await db.query('delete from clients where id=any($1::uuid[])', [ids])
      await db.query('update workspaces set access_state=$1,plan=$2,locale=$3 where id=$4', [original.access_state, original.plan, original.locale, workspaceId]); await db.end()
    }
  })
}
