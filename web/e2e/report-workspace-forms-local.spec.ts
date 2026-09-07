import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { Client } from 'pg'

if (process.env.PLAYWRIGHT_LOCAL_FIXTURE === '1') for (const locale of ['fr', 'en'] as const) {
  test(`report draft ${locale} cannot cross workspaces after another tab switches the session`, async ({ browser }) => {
    const url = new URL(process.env.DATABASE_SYSTEM_URL!)
    if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || !url.pathname.startsWith('/yodev_test')) throw new Error('Disposable database required')
    const db = new Client({ connectionString: url.href }); await db.connect()
    const workspaceIds = ['80000000-0000-4000-8000-000000000001', '80000000-0000-4000-8000-000000000002']
    const actor = 'local-browser-fixture-owner', foreignOrganization = 'local-browser-fixture-foreign', mainOrganization = 'local-browser-fixture-main'
    const marker = `Workspace report ${randomUUID()}`
    const originals = (await db.query('select id,locale from workspaces where id=any($1::uuid[])', [workspaceIds])).rows
    const member = (await db.query('select id,role from auth_members where user_id=$1 and organization_id=$2', [actor, foreignOrganization])).rows[0]
    const context = await browser.newContext({ baseURL: process.env.PLAYWRIGHT_BASE_URL, storageState: process.env.PLAYWRIGHT_OWNER_STORAGE_STATE, viewport: { width: locale === 'fr' ? 390 : 1440, height: 950 } })
    const switchWorkspace = async (organizationId: string) => {
      const response = await context.request.post('/api/auth/organization/set-active', { data: { organizationId }, headers: { origin: process.env.PLAYWRIGHT_BASE_URL! } })
      expect(response.ok()).toBe(true)
    }
    try {
      await db.query('update workspaces set locale=$1 where id=any($2::uuid[])', [locale, workspaceIds])
      // The same actor is authorized in both spaces: the displayed form context must still be respected.
      await db.query("update auth_members set role='analyst' where id=$1", [member.id])
      await context.addCookies([{ name: 'yodev_cookie_consent', value: 'rejected', url: process.env.PLAYWRIGHT_BASE_URL! }])
      await switchWorkspace(mainOrganization)
      const page = await context.newPage(), errors: string[] = []
      page.on('pageerror', (error) => errors.push(error.message))
      await page.goto('/reports')
      const draft = page.locator('form').filter({ has: page.locator('#template-name') })
      await draft.locator('#template-name').fill(marker)
      await expect(draft.locator('[name="workspaceId"]')).toHaveValue(workspaceIds[0])
      // Same server/session transition as a workspace switch in another tab; leave the original DOM untouched.
      await switchWorkspace(foreignOrganization)
      await expect(draft.locator('#template-name')).toHaveValue(marker)
      await draft.getByRole('button', { name: /Save template|Enregistrer le modèle/, exact: true }).click()
      await expect(page.getByText(locale === 'en' ? 'The active workspace changed. Reload this page before saving.' : 'L’espace actif a changé. Rechargez la page avant d’enregistrer.', { exact: true })).toBeVisible()
      expect((await db.query('select id from report_templates where name=$1', [marker])).rowCount).toBe(0)
      // A rerender for the new workspace must not carry the uncontrolled draft into its fresh form.
      await expect(draft.locator('[name="workspaceId"]')).toHaveValue(workspaceIds[1])
      await expect(draft.locator('#template-name')).toHaveValue('')
      await draft.locator('#template-name').fill(`${marker} authorized`)
      await draft.getByRole('button', { name: /Save template|Enregistrer le modèle/, exact: true }).click()
      await expect(page.getByText(locale === 'en' ? 'Report template created.' : 'Modèle de rapport créé.', { exact: true })).toBeVisible()
      const saved = (await db.query('select workspace_id from report_templates where name=$1', [`${marker} authorized`])).rows
      expect(saved).toEqual([{ workspace_id: workspaceIds[1] }])
      expect(errors).toEqual([])
    } finally {
      await switchWorkspace(mainOrganization)
      await context.close()
      await db.query('delete from audit_events where entity_id in (select id::text from report_templates where name=any($1::text[]))', [[marker, `${marker} authorized`]])
      await db.query('delete from report_templates where name=any($1::text[])', [[marker, `${marker} authorized`]])
      await db.query('update auth_members set role=$1 where id=$2', [member.role, member.id])
      for (const original of originals) await db.query('update workspaces set locale=$1 where id=$2', [original.locale, original.id])
      await db.end()
    }
  })
}
