import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { Client } from 'pg'

if (process.env.PLAYWRIGHT_LOCAL_FIXTURE === '1' && process.env.PLAYWRIGHT_SECURITY_CONTROLS === '1') for (const [index, locale] of ['fr', 'en'].entries()) {
  test(`security actor ${locale} manages resources and rejects obsolete authority`, async ({ browser }) => {
    const url = new URL(process.env.DATABASE_SYSTEM_URL!)
    if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || !url.pathname.startsWith('/yodev_test')) throw new Error('Disposable database required')
    const db = new Client({ connectionString: url.href }), workspaceId = '80000000-0000-4000-8000-000000000001', actor = 'local-browser-fixture-owner', marker = `SECURITY_${randomUUID()}`, clientId = randomUUID(), jobId = randomUUID()
    await db.connect()
    const original = (await db.query('select access_state,plan,locale,owner_user_id,auth_owner_user_id,notification_email from workspaces where id=$1', [workspaceId])).rows[0]
    const member = (await db.query("select id,role from auth_members where organization_id='local-browser-fixture-main' and user_id=$1", [actor])).rows[0]
    const beforeAudits = (await db.query('select id from audit_events where workspace_id=$1 and actor_user_id=$2', [workspaceId, actor])).rows.map((row) => row.id)
    const context = await browser.newContext({ baseURL: process.env.PLAYWRIGHT_BASE_URL, storageState: process.env.PLAYWRIGHT_OWNER_STORAGE_STATE, viewport: { width: locale === 'fr' ? 390 : 1440, height: 950 }, extraHTTPHeaders: { 'x-forwarded-for': `198.18.38.${index + 1}` } })
    await context.addCookies([{ name: 'yodev_cookie_consent', value: 'rejected', url: process.env.PLAYWRIGHT_BASE_URL! }])
    let keyId: string | undefined, channelId: string | undefined
    try {
      await db.query("update workspaces set access_state='active',plan='agency',locale=$1 where id=$2", [locale, workspaceId])
      await db.query("insert into clients(id,workspace_id,google_customer_id,name,currency_code) values($1,$2,'8000000038',$3,'EUR')", [clientId, workspaceId, marker])
      await db.query("insert into jobs(id,workspace_id,type,status,attempt_count,maximum_attempts) values($1,$2,'notification.deliver','dead_letter',5,5)", [jobId, workspaceId])
      const page = await context.newPage(), errors: string[] = []
      page.on('pageerror', (error) => errors.push(error.message)); page.setDefaultTimeout(15_000)
      await page.goto('/settings')
      const keyForm = page.locator('form:has(input[placeholder="Codex production"])')
      await keyForm.getByRole('textbox').fill(marker); await keyForm.getByRole('button').click()
      await expect(page).toHaveURL(/reveal=api-key/)
      keyId = (await db.query('select id from api_keys where workspace_id=$1 and name=$2', [workspaceId, marker])).rows[0].id
      await page.getByRole('button', { name: /Reveal and copy now|Révéler et copier maintenant/ }).click()
      await expect(page.locator('input[readonly]')).toHaveValue(/^ya_live_/)
      expect((await page.request.post('/api/secret-revelation')).status()).toBe(404)
      await page.goto('/settings') // Discard the revealed secret before any screenshot.
      await page.locator(`form:has(input[name="keyId"][value="${keyId}"])`).getByRole('button').click()
      await expect(page.locator(`input[name="keyId"][value="${keyId}"]`)).toHaveCount(0)
      expect((await db.query('select revoked_at from api_keys where id=$1', [keyId])).rows[0].revoked_at).toBeTruthy()
      const channelForm = page.locator('form:has(input[name="destination"])')
      await channelForm.locator('[name="label"]').fill(marker)
      await channelForm.locator('[name="destination"]').fill('ops@example.test')
      await channelForm.getByRole('button').click()
      await expect(page.getByText(`${marker} · email`, { exact: true })).toBeVisible()
      channelId = (await db.query('select id from notification_channels where workspace_id=$1 and label=$2', [workspaceId, marker])).rows[0].id
      await page.locator(`form:has(input[name="channelId"][value="${channelId}"])`).getByRole('button').click()
      await expect(page.locator(`input[name="channelId"][value="${channelId}"]`)).toHaveCount(0)
      expect((await db.query('select enabled,destination_hint from notification_channels where id=$1', [channelId])).rows[0]).toEqual({ enabled: false, destination_hint: 'revoked' })
      const policy = page.locator('form:has(select[name="scope"])')
      await policy.locator('[name="scope"]').selectOption('campaign'); await policy.locator('[name="clientId"]').selectOption(clientId)
      await policy.locator('[name="campaignId"]').fill('12345'); await policy.locator('[name="maximumDailyBudget"]').fill('125.50')
      await policy.getByRole('button').click()
      await expect(page.getByText(/Campaign 12345|Campagne 12345/)).toBeVisible()
      expect((await db.query('select maximum_daily_budget_micros,currency_code from safety_policies where client_id=$1', [clientId])).rows[0]).toEqual({ maximum_daily_budget_micros: '125500000', currency_code: 'EUR' })
      await page.locator(`form:has(input[name="jobId"][value="${jobId}"])`).getByRole('button').click()
      await expect(page.locator(`input[name="jobId"][value="${jobId}"]`)).toHaveCount(0)
      expect((await db.query('select status,maximum_attempts from jobs where id=$1', [jobId])).rows[0]).toEqual({ status: 'queued', maximum_attempts: 10 })
      // An admin can manage settings but cannot create or revoke owner-only API keys.
      await db.query("update workspaces set owner_user_id='local-browser-fixture-admin',auth_owner_user_id='local-browser-fixture-admin' where id=$1", [workspaceId])
      await db.query("update auth_members set role='admin' where id=$1", [member.id]); await page.goto('/settings')
      await expect(keyForm).toHaveCount(0); await expect(channelForm).toBeVisible()
      await channelForm.evaluate((element) => element.scrollIntoView({ block: 'center', behavior: 'instant' }))
      await channelForm.screenshot({ path: test.info().outputPath(`security-channel-${locale}.png`), caret: 'initial' })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
      await channelForm.locator('[name="label"]').fill(`${marker}_denied`); await channelForm.locator('[name="destination"]').fill('ops@example.test')
      await db.query("update auth_members set role='analyst' where id=$1", [member.id]); await channelForm.getByRole('button').click()
      await expect(page.getByRole('heading', { name: /Get help from Yodev|Obtenir l’aide de Yodev/ })).toBeVisible()
      expect((await db.query('select count(*) from notification_channels where workspace_id=$1 and label=$2', [workspaceId, `${marker}_denied`])).rows[0].count).toBe('0')
      expect(errors).toEqual([])
    } finally {
      await context.close().catch(() => {})
      await db.query('update auth_members set role=$1 where id=$2', [member.role, member.id])
      await db.query('delete from audit_events where workspace_id=$1 and actor_user_id=$2 and not(id=any($3::uuid[]))', [workspaceId, actor, beforeAudits])
      await db.query('delete from api_keys where workspace_id=$1 and name=$2', [workspaceId, marker])
      await db.query("delete from secret_revelations where workspace_id=$1 and user_id=$2 and kind='api_key'", [workspaceId, actor])
      await db.query('delete from notification_channels where workspace_id=$1 and label=any($2::text[])', [workspaceId, [marker, `${marker}_denied`]])
      await db.query('delete from jobs where id=$1', [jobId]); await db.query('delete from clients where id=$1', [clientId])
      await db.query('update workspaces set access_state=$1,plan=$2,locale=$3,owner_user_id=$4,auth_owner_user_id=$5,notification_email=$6 where id=$7', [original.access_state, original.plan, original.locale, original.owner_user_id, original.auth_owner_user_id, original.notification_email, workspaceId])
      await db.end()
    }
  })
}
