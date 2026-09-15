import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { Client } from 'pg'

if (process.env.PLAYWRIGHT_LOCAL_FIXTURE === '1' && process.env.PLAYWRIGHT_SECURITY_CONTROLS === '1') for (const [index, locale] of ['fr', 'en'].entries()) {
  test(`member preferences ${locale} persist personal settings and refuse a stale grace form`, async ({ browser }) => {
    const url = new URL(process.env.DATABASE_SYSTEM_URL!)
    if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || !url.pathname.startsWith('/yodev_test')) throw new Error('Disposable database required')
    const db = new Client({ connectionString: url.href }), workspaceId = '80000000-0000-4000-8000-000000000001', actor = 'local-browser-fixture-admin', handle = `pref_${randomUUID().slice(0, 8)}`
    await db.connect()
    const original = (await db.query('select access_state,plan,locale from workspaces where id=$1', [workspaceId])).rows[0]
    const context = await browser.newContext({ baseURL: process.env.PLAYWRIGHT_BASE_URL, storageState: process.env.PLAYWRIGHT_ADMIN_STORAGE_STATE, viewport: { width: locale === 'fr' ? 390 : 1440, height: 950 }, extraHTTPHeaders: { 'x-forwarded-for': `198.18.39.${index + 1}` } })
    await context.addCookies([{ name: 'yodev_cookie_consent', value: 'rejected', url: process.env.PLAYWRIGHT_BASE_URL! }])
    let preferenceId: string | undefined
    try {
      expect((await db.query('select count(*) from member_notification_preferences where workspace_id=$1 and auth_user_id=$2', [workspaceId, actor])).rows[0].count).toBe('0')
      await db.query("update workspaces set access_state='active',plan='agency',locale=$1 where id=$2", [locale, workspaceId])
      const page = await context.newPage(), errors: string[] = []
      page.on('pageerror', (error) => errors.push(error.message))
      await page.goto('/settings')
      const form = page.locator('form:has(input[name="mentionHandle"])')
      await form.locator('[name="mentionHandle"]').fill(handle)
      await form.locator('[name="digestCadence"]').selectOption('daily')
      await form.locator('[name="digestHour"]').fill('9')
      await form.locator('[name="timezone"]').fill('Asia/Tokyo')
      await form.locator('[name="mentionNotifications"]').uncheck()
      await form.getByRole('button').click()
      await expect(page.getByText(locale === 'fr' ? 'Préférences personnelles de tâches enregistrées.' : 'Personal task preferences saved.', { exact: true })).toBeVisible()
      const saved = (await db.query('select id,mention_handle,mention_notifications,digest_cadence,digest_hour,timezone from member_notification_preferences where workspace_id=$1 and auth_user_id=$2', [workspaceId, actor])).rows[0]
      preferenceId = saved.id
      expect(saved).toMatchObject({ mention_handle: handle, mention_notifications: false, digest_cadence: 'daily', digest_hour: 9, timezone: 'Asia/Tokyo' })
      await page.reload(); await expect(form.locator('[name="digestHour"]')).toHaveValue('9')
      await form.evaluate((element) => element.scrollIntoView({ block: 'center', behavior: 'instant' }))
      await form.screenshot({ path: test.info().outputPath(`member-preferences-${locale}.png`), caret: 'initial' })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
      await form.locator('[name="digestHour"]').fill('10')
      await db.query("update workspaces set access_state='grace' where id=$1", [workspaceId])
      await form.getByRole('button').click()
      await expect(page.getByRole('heading', { name: /Get help from Yodev|Obtenir l’aide de Yodev/ })).toBeVisible()
      expect((await db.query('select digest_hour from member_notification_preferences where id=$1', [preferenceId])).rows[0].digest_hour).toBe(9)
      expect((await db.query("select count(*) from audit_events where workspace_id=$1 and action='member.task_notification_preferences_updated' and entity_id=$2", [workspaceId, preferenceId])).rows[0].count).toBe('1')
      expect(errors).toEqual([])
    } finally {
      await context.close().catch(() => {})
      if (preferenceId) {
        await db.query('delete from audit_events where workspace_id=$1 and entity_id=$2', [workspaceId, preferenceId])
        await db.query('delete from member_notification_preferences where id=$1', [preferenceId])
      }
      await db.query('update workspaces set access_state=$1,plan=$2,locale=$3 where id=$4', [original.access_state, original.plan, original.locale, workspaceId])
      await db.end()
    }
  })
}
