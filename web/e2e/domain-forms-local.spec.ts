import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { Client } from 'pg'

if (process.env.PLAYWRIGHT_LOCAL_FIXTURE === '1' && process.env.PLAYWRIGHT_DOMAIN_CONTROLS === '1') for (const locale of ['fr', 'en'] as const) {
  test(`custom domain ${locale} binds all forms to their workspace and permits removal after downgrade`, async ({ browser }, testInfo) => {
    const url = new URL(process.env.DATABASE_SYSTEM_URL!)
    if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || !url.pathname.startsWith('/yodev_test')) throw new Error('Disposable database required')
    const db = new Client({ connectionString: url.href }); await db.connect()
    const workspaceIds = ['80000000-0000-4000-8000-000000000001', '80000000-0000-4000-8000-000000000002']
    const actor = 'local-browser-fixture-owner', mainOrganization = 'local-browser-fixture-main', foreignOrganization = 'local-browser-fixture-foreign'
    const hostname = `domain-${randomUUID()}.example.test`
    const originals = (await db.query('select id,locale,plan,access_state from workspaces where id=any($1::uuid[])', [workspaceIds])).rows
    const member = (await db.query('select id,role from auth_members where user_id=$1 and organization_id=$2', [actor, foreignOrganization])).rows[0]
    const context = await browser.newContext({ baseURL: process.env.PLAYWRIGHT_BASE_URL, storageState: process.env.PLAYWRIGHT_OWNER_STORAGE_STATE, viewport: { width: locale === 'fr' ? 390 : 1440, height: 950 } })
    const switchWorkspace = async (organizationId: string) => {
      const response = await context.request.post('/api/auth/organization/set-active', { data: { organizationId }, headers: { origin: process.env.PLAYWRIGHT_BASE_URL! } })
      expect(response.ok()).toBe(true)
    }
    let revelationId: string | null = null
    try {
      await db.query("update workspaces set locale=$1,plan='agency',access_state='active' where id=any($2::uuid[])", [locale, workspaceIds])
      await db.query("update auth_members set role='admin' where id=$1", [member.id])
      await context.addCookies([{ name: 'yodev_cookie_consent', value: 'rejected', url: process.env.PLAYWRIGHT_BASE_URL! }])
      await switchWorkspace(mainOrganization)
      const page = await context.newPage(), errors: string[] = []
      page.on('pageerror', (error) => errors.push(error.message))
      await page.goto('/settings')
      const panel = page.getByRole('region', { name: locale === 'en' ? 'Custom domain' : 'Domaine personnalisé', exact: true })
      const draft = panel.locator('form').filter({ has: page.locator('#custom-domain-hostname') })
      await draft.getByRole('textbox').fill(hostname)
      await expect(draft.locator('[name="workspaceId"]')).toHaveValue(workspaceIds[0])
      await switchWorkspace(foreignOrganization)
      await draft.getByRole('button', { name: /Configure|Configurer/, exact: true }).click()
      const changed = locale === 'en' ? 'The active workspace changed. Reload this page before saving.' : 'L’espace actif a changé. Rechargez la page avant d’enregistrer.'
      await expect(page.getByText(changed, { exact: true })).toBeVisible()
      expect((await db.query('select 1 from workspace_domains where hostname=$1', [hostname])).rowCount).toBe(0)
      await expect(draft.locator('[name="workspaceId"]')).toHaveValue(workspaceIds[1]); await expect(draft.getByRole('textbox')).toHaveValue('')
      await draft.getByRole('textbox').fill(hostname); await draft.getByRole('textbox').press('Tab')
      await expect(draft.getByRole('button', { name: /Configure|Configurer/, exact: true })).toBeFocused()
      await draft.getByRole('button').click()
      await expect(page).toHaveURL(/reveal=domain-dns.*revealId=/)
      revelationId = new URL(page.url()).searchParams.get('revealId')
      const saved = (await db.query('select id,workspace_id,revoked_at,last_error from workspace_domains where hostname=$1', [hostname])).rows[0]
      expect(saved.workspace_id).toBe(workspaceIds[1]); expect(saved.revoked_at).toBeNull()
      await expect(panel.getByRole('button', { name: /Reveal TXT record|Révéler l’enregistrement TXT/ })).toBeVisible()
      // Do not display or copy the one-time DNS secret in this layout test.
      for (const operation of ['verify', 'revoke']) {
        await switchWorkspace(foreignOrganization); await page.goto('/settings')
        const button = panel.getByRole('button', { name: operation === 'verify' ? /Verify|Vérifier/ : /Revoke|Révoquer/, exact: true })
        const bound = button.locator('xpath=ancestor::form')
        await expect(bound.locator('[name="workspaceId"]')).toHaveValue(workspaceIds[1])
        await switchWorkspace(mainOrganization); await button.click()
        await expect(page.getByText(changed, { exact: true })).toBeVisible()
        expect((await db.query('select revoked_at,last_error from workspace_domains where id=$1', [saved.id])).rows[0]).toEqual({ revoked_at: null, last_error: null })
      }
      await switchWorkspace(foreignOrganization)
      await db.query("update workspaces set plan='solo' where id=$1", [workspaceIds[1]])
      await page.goto('/settings')
      await expect(panel.getByText(hostname, { exact: true })).toBeVisible()
      await expect(panel.getByRole('button', { name: /Verify|Vérifier/, exact: true })).toHaveCount(0)
      await expect(panel.getByRole('button', { name: /Revoke|Révoquer/, exact: true })).toBeEnabled()
      await panel.getByRole('button', { name: /Revoke|Révoquer/, exact: true }).click()
      const failure = locale === 'en' ? 'The domain operation could not be completed. Try again or contact support.' : 'Opération du domaine non finalisée. Réessayez ou contactez le support.'
      await expect(panel.getByText(failure, { exact: true })).toBeVisible()
      expect(page.url()).not.toMatch(/VERCEL_API_TOKEN|Capability|required|private/)
      expect((await db.query('select revoked_at,last_error from workspace_domains where id=$1', [saved.id])).rows[0]).toEqual({ revoked_at: null, last_error: 'Opération du domaine non finalisée. Réessayez ou contactez le support.' })
      await expect(panel.getByText(locale === 'en' ? /You can still remove/ : /Vous pouvez toujours retirer/)).toBeVisible()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
      await page.evaluate(() => document.fonts.ready)
      await panel.screenshot({ path: testInfo.outputPath(`domain-downgrade-${locale}.png`) })
      expect(errors).toEqual([])
    } finally {
      await switchWorkspace(mainOrganization); await context.close()
      if (revelationId) await db.query('delete from secret_revelations where id=$1', [revelationId])
      await db.query('delete from audit_events where entity_id in (select id::text from workspace_domains where hostname=$1)', [hostname])
      await db.query('delete from workspace_domains where hostname=$1', [hostname])
      await db.query('update auth_members set role=$1 where id=$2', [member.role, member.id])
      for (const original of originals) await db.query('update workspaces set locale=$1,plan=$2,access_state=$3 where id=$4', [original.locale, original.plan, original.access_state, original.id])
      await db.end()
    }
  })
}
