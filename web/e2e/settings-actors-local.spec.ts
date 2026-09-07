import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { Client } from 'pg'

if (process.env.PLAYWRIGHT_LOCAL_FIXTURE === '1') for (const [index, locale] of ['fr', 'en'].entries()) {
  test(`settings actor ${locale} saves current policy and rejects downgraded or revoked forms`, async ({ browser }) => {
    const url = new URL(process.env.DATABASE_SYSTEM_URL!)
    if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || !url.pathname.startsWith('/yodev_test')) throw new Error('Disposable database required')
    const db = new Client({ connectionString: url.href }), workspaceId = '80000000-0000-4000-8000-000000000001', actor = 'local-browser-fixture-admin', marker = `Settings ${randomUUID()}`
    await db.connect()
    const original = (await db.query('select access_state,plan,locale,required_approvals,allow_self_approval,approval_mode,brand_name,brand_tagline,accent_color from workspaces where id=$1', [workspaceId])).rows[0]
    const member = (await db.query("select id,role from auth_members where organization_id='local-browser-fixture-main' and user_id=$1", [actor])).rows[0]
    const beforeAudits = (await db.query('select id from audit_events where workspace_id=$1 and actor_user_id=$2', [workspaceId, actor])).rows.map((row) => row.id)
    const context = await browser.newContext({ baseURL: process.env.PLAYWRIGHT_BASE_URL, storageState: process.env.PLAYWRIGHT_ADMIN_STORAGE_STATE, viewport: { width: locale === 'fr' ? 390 : 1440, height: 950 }, extraHTTPHeaders: { 'x-forwarded-for': `198.18.37.${index + 1}` } })
    await context.addCookies([{ name: 'yodev_cookie_consent', value: 'rejected', url: process.env.PLAYWRIGHT_BASE_URL! }])
    try {
      await db.query("update workspaces set access_state='active',plan='agency',locale=$1,required_approvals=1,allow_self_approval=false,approval_mode='single' where id=$2", [locale, workspaceId])
      const page = await context.newPage(), errors: string[] = []
      page.on('pageerror', (error) => errors.push(error.message)); page.setDefaultTimeout(15_000)
      await page.goto('/settings')
      const language = page.locator('form:has(select[name="locale"])')
      await language.getByRole('combobox').selectOption(locale === 'fr' ? 'en' : 'fr'); await language.getByRole('button').click()
      await expect(language.getByRole('combobox')).toHaveValue(locale === 'fr' ? 'en' : 'fr')
      // Wait for the new language render before changing it back.
      await expect(page.getByRole('heading', { name: locale === 'fr' ? 'Settings' : 'Réglages', exact: true })).toBeVisible()
      await language.getByRole('combobox').selectOption(locale); await language.getByRole('button').click()
      await expect(page.getByRole('heading', { name: locale === 'fr' ? 'Réglages' : 'Settings', exact: true })).toBeVisible()
      const policy = page.locator('form:has(select[name="requiredApprovals"])')
      await policy.getByRole('combobox').selectOption('2'); await policy.getByRole('button').click()
      await expect(page.getByText(locale === 'fr' ? 'Politique d’approbation mise à jour.' : 'Approval policy updated.', { exact: true })).toBeVisible()
      expect((await db.query('select required_approvals,approval_mode from workspaces where id=$1', [workspaceId])).rows[0]).toEqual({ required_approvals: 2, approval_mode: 'dual' })
      const branding = page.locator('form:has(input[name="brandName"])')
      await branding.locator('[name="brandName"]').fill(marker)
      await branding.locator('[name="brandTagline"]').fill('Settings workflow fixture')
      await branding.locator('[name="accentColor"]').fill('#126456')
      await branding.getByRole('button').click()
      await expect(page.getByText(locale === 'fr' ? 'Identité de marque enregistrée.' : 'Brand identity saved.', { exact: true })).toBeVisible()
      expect((await db.query('select brand_name,accent_color from workspaces where id=$1', [workspaceId])).rows[0]).toEqual({ brand_name: marker, accent_color: '#126456' })
      for (const [form, name] of [[branding, 'branding'], [policy, 'policy']] as const) {
        // Center the form so the sticky application header does not obscure its controls in the evidence.
        await form.evaluate((element) => element.scrollIntoView({ block: 'center', behavior: 'instant' }))
        await form.screenshot({ path: test.info().outputPath(`settings-${name}-${locale}.png`), caret: 'initial' })
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
      // An already displayed dual-approval form must not bypass a downgrade.
      await db.query("update workspaces set plan='solo' where id=$1", [workspaceId])
      await policy.getByRole('button').click(); await expect(page).toHaveURL(/error=/)
      expect((await db.query('select count(*) from audit_events where workspace_id=$1 and actor_user_id=$2 and action=$3 and not(id=any($4::uuid[]))', [workspaceId, actor, 'workspace.approval_policy_updated', beforeAudits])).rows[0].count).toBe('1')
      await db.query("update workspaces set plan='agency' where id=$1", [workspaceId]); await page.goto('/settings')
      await branding.locator('[name="brandName"]').fill('Forbidden brand')
      await db.query("update auth_members set role='analyst' where id=$1", [member.id])
      await branding.getByRole('button').click()
      await expect(page).toHaveURL(/\/support\?error=/)
      await expect(page.getByRole('heading', { name: /Get help from Yodev|Obtenir l’aide de Yodev/ })).toBeVisible()
      await expect(branding).toHaveCount(0)
      const settingsDenied = await page.request.get('/settings', { maxRedirects: 0 })
      expect(settingsDenied.status()).toBe(307)
      expect(new URL(settingsDenied.headers().location, process.env.PLAYWRIGHT_BASE_URL).pathname).toBe('/support')
      expect((await db.query('select brand_name from workspaces where id=$1', [workspaceId])).rows[0].brand_name).toBe(marker)
      // Analysts can prepare personal views; a subsequent client role cannot submit the old form.
      await page.goto('/portfolio')
      const views = page.locator('[data-portfolio-saved-views]')
      await views.locator(':scope > summary').click()
      await views.getByRole('textbox', { name: /New view name|Nom de la nouvelle vue/ }).fill(marker)
      await db.query("update auth_members set role='client' where id=$1", [member.id])
      await views.getByRole('button', { name: /Save current filters|Enregistrer ces filtres/ }).click()
      await expect(page).toHaveURL(/\/support\?error=/)
      await expect(page.getByRole('heading', { name: /Get help from Yodev|Obtenir l’aide de Yodev/ })).toBeVisible()
      await expect(views).toHaveCount(0)
      const portfolioDenied = await page.request.get('/portfolio', { maxRedirects: 0 })
      expect(portfolioDenied.status()).toBe(307)
      expect(new URL(portfolioDenied.headers().location, process.env.PLAYWRIGHT_BASE_URL).pathname).toBe('/support')
      expect((await db.query('select count(*) from portfolio_views where workspace_id=$1 and user_id=$2 and name=$3', [workspaceId, actor, marker])).rows[0].count).toBe('0')
      expect(errors).toEqual([])
    } finally {
      await context.close().catch(() => {})
      await db.query('update auth_members set role=$1 where id=$2', [member.role, member.id])
      await db.query('delete from audit_events where workspace_id=$1 and actor_user_id=$2 and not(id=any($3::uuid[]))', [workspaceId, actor, beforeAudits])
      await db.query('delete from portfolio_views where workspace_id=$1 and user_id=$2 and name=$3', [workspaceId, actor, marker])
      await db.query('update workspaces set access_state=$1,plan=$2,locale=$3,required_approvals=$4,allow_self_approval=$5,approval_mode=$6,brand_name=$7,brand_tagline=$8,accent_color=$9 where id=$10', [original.access_state, original.plan, original.locale, original.required_approvals, original.allow_self_approval, original.approval_mode, original.brand_name, original.brand_tagline, original.accent_color, workspaceId])
      await db.end()
    }
  })
}
