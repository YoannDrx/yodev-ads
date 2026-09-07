import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { Client } from 'pg'

if (process.env.PLAYWRIGHT_LOCAL_FIXTURE === '1' && process.env.PLAYWRIGHT_SECURITY_CONTROLS === '1') for (const [index, locale] of ['fr', 'en'].entries()) {
  test(`personal notifications ${locale} accessible to analyst, tenant bound, and explicit for client`, async ({ browser }) => {
    const url = new URL(process.env.DATABASE_SYSTEM_URL!)
    if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || !url.pathname.startsWith('/yodev_test')) throw new Error('Disposable database required')
    const db = new Client({ connectionString: url.href }), workspaceId = '80000000-0000-4000-8000-000000000001', actor = 'local-browser-fixture-analyst'
    await db.connect()
    const original = (await db.query('select access_state,plan,locale from workspaces where id=$1', [workspaceId])).rows[0]
    const context = await browser.newContext({ baseURL: process.env.PLAYWRIGHT_BASE_URL, storageState: process.env.PLAYWRIGHT_ANALYST_STORAGE_STATE, viewport: { width: locale === 'fr' ? 390 : 1440, height: 950 }, extraHTTPHeaders: { 'x-forwarded-for': `198.18.40.${index + 1}` } })
    const client = await browser.newContext({ baseURL: process.env.PLAYWRIGHT_BASE_URL, storageState: process.env.PLAYWRIGHT_CLIENT_STORAGE_STATE })
    let preferenceId: string | undefined
    try {
      await context.addCookies([{ name: 'yodev_cookie_consent', value: 'rejected', url: process.env.PLAYWRIGHT_BASE_URL! }, { name: 'yodev_locale', value: locale, url: process.env.PLAYWRIGHT_BASE_URL! }])
      await client.addCookies([{ name: 'yodev_cookie_consent', value: 'rejected', url: process.env.PLAYWRIGHT_BASE_URL! }])
      expect((await db.query('select count(*) from member_notification_preferences where workspace_id=$1 and auth_user_id=$2', [workspaceId, actor])).rows[0].count).toBe('0')
      await db.query("update workspaces set access_state='active',plan='agency',locale=$1 where id=$2", [locale, workspaceId])
      const page = await context.newPage(), errors: string[] = []
      page.on('pageerror', (error) => errors.push(error.message))
      await page.goto('/account')
      await page.getByRole('link', { name: locale === 'fr' ? 'Mes notifications de tâches' : 'My task notifications', exact: true }).click()
      await expect(page).toHaveURL(/\/account\/notifications$/)
      const form = page.locator('form:has(input[name="mentionHandle"])')
      await form.locator('[name="mentionHandle"]').fill(`analyst_${randomUUID().slice(0, 8)}`)
      await form.locator('[name="digestCadence"]').selectOption('weekly')
      await form.locator('[name="digestHour"]').fill('7')
      await form.locator('[name="timezone"]').fill('America/Montreal')
      await form.getByRole('button').click()
      await expect(page.getByText(locale === 'fr' ? 'Préférences personnelles de tâches enregistrées.' : 'Personal task preferences saved.', { exact: true })).toBeVisible()
      await expect(page).toHaveURL(/\/account\/notifications\?notice=/)
      preferenceId = (await db.query('select id from member_notification_preferences where workspace_id=$1 and auth_user_id=$2', [workspaceId, actor])).rows[0].id
      await page.reload(); await expect(form.locator('[name="digestHour"]')).toHaveValue('7')
      await form.evaluate((element) => element.scrollIntoView({ block: 'center', behavior: 'instant' }))
      await page.screenshot({ path: test.info().outputPath(`personal-notifications-${locale}.png`), fullPage: true })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
      // A form from another workspace cannot silently change the current member's preferences.
      await form.locator('[name="workspaceId"]').evaluate((element) => { (element as HTMLInputElement).value = '80000000-0000-4000-8000-000000000002' })
      await form.locator('[name="digestHour"]').fill('10'); await form.getByRole('button').click()
      await expect(page.getByText(locale === 'fr' ? 'L’espace actif a changé. Rechargez la page avant d’enregistrer.' : 'The active workspace changed. Reload this page before saving.', { exact: true })).toBeVisible()
      expect((await db.query('select digest_hour from member_notification_preferences where id=$1', [preferenceId])).rows[0].digest_hour).toBe(7)
      const clientPage = await client.newPage(); await clientPage.goto('/account/notifications')
      await expect(clientPage.getByRole('status')).toContainText(locale === 'fr' ? 'aucun email de tâche ne vous sera envoyé' : 'no task emails will be sent to you')
      await expect(clientPage.locator('[name="mentionHandle"]')).toHaveValue('')
      await db.query("update workspaces set access_state='grace' where id=$1", [workspaceId])
      await page.goto('/account/notifications'); await expect(page).toHaveURL(/\/support\?notice=/)
      await page.goto('/account'); await expect(page.getByRole('heading', { name: /Account security|Sécurité du compte/ })).toBeVisible()
      expect((await db.query("select count(*) from audit_events where workspace_id=$1 and action='member.task_notification_preferences_updated' and entity_id=$2", [workspaceId, preferenceId])).rows[0].count).toBe('1')
      expect(errors).toEqual([])
    } finally {
      await context.close().catch(() => {}); await client.close().catch(() => {})
      if (preferenceId) { await db.query('delete from audit_events where workspace_id=$1 and entity_id=$2', [workspaceId, preferenceId]); await db.query('delete from member_notification_preferences where id=$1', [preferenceId]) }
      await db.query('update workspaces set access_state=$1,plan=$2,locale=$3 where id=$4', [original.access_state, original.plan, original.locale, workspaceId]); await db.end()
    }
  })
}
