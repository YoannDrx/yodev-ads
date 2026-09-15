import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { Client } from 'pg'

if (process.env.PLAYWRIGHT_LOCAL_FIXTURE === '1' && process.env.PLAYWRIGHT_SECURITY_CONTROLS === '1') for (const [index, locale] of ['fr', 'en'].entries()) {
  test(`secret revelation ${locale} binds the pending value, recovers offline and refuses revoked authority`, async ({ browser }) => {
    const url = new URL(process.env.DATABASE_SYSTEM_URL!)
    if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || !url.pathname.startsWith('/yodev_test')) throw new Error('Disposable database required')
    const db = new Client({ connectionString: url.href }), workspaceId = '80000000-0000-4000-8000-000000000001', actor = 'local-browser-fixture-owner', marker = `REVEAL_${randomUUID()}`
    await db.connect()
    const original = (await db.query('select access_state,plan,locale,owner_user_id,auth_owner_user_id from workspaces where id=$1', [workspaceId])).rows[0]
    const member = (await db.query("select id,role from auth_members where organization_id='local-browser-fixture-main' and user_id=$1", [actor])).rows[0]
    const context = await browser.newContext({ baseURL: process.env.PLAYWRIGHT_BASE_URL, storageState: process.env.PLAYWRIGHT_OWNER_STORAGE_STATE, viewport: { width: locale === 'fr' ? 390 : 1440, height: 950 }, extraHTTPHeaders: { 'x-forwarded-for': `198.18.44.${index + 1}` } })
    await context.addCookies([{ name: 'yodev_cookie_consent', value: 'rejected', url: process.env.PLAYWRIGHT_BASE_URL! }])
    // Keep this test's secret out of the host clipboard while exercising the browser copy command.
    await context.addInitScript(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text: string) => { (window as unknown as { copiedSecret: string }).copiedSecret = text } } }))
    const revelationIds: string[] = [], keyIds: string[] = []
    try {
      await db.query("update workspaces set access_state='active',plan='agency',locale=$1 where id=$2", [locale, workspaceId])
      const page = await context.newPage(), errors: string[] = []
      page.on('pageerror', (error) => errors.push(error.message))
      const reveal = page.getByRole('button', { name: /Reveal key now|Révéler la clé maintenant/ })
      async function create(number: number) {
        await page.goto('/settings')
        const form = page.locator('form:has(input[placeholder="Codex production"])')
        await form.getByRole('textbox').fill(`${marker}_${number}`); await form.getByRole('button').click()
        await expect(page).toHaveURL(/reveal=api-key.*revealId=/)
        const id = new URL(page.url()).searchParams.get('revealId')!
        revelationIds.push(id); keyIds.push((await db.query('select id from api_keys where workspace_id=$1 and name=$2', [workspaceId, `${marker}_${number}`])).rows[0].id)
        await expect(reveal).toBeVisible(); return id
      }
      async function untouched(id: string) { expect((await db.query('select revealed_at from secret_revelations where id=$1', [id])).rows[0].revealed_at).toBeNull() }
      const first = await create(1)
      await page.route('**/api/secret-revelation', (route) => route.abort('failed'), { times: 1 })
      await reveal.click(); await expect(page.locator('p[role="alert"]')).toContainText(locale === 'fr' ? 'La réponse n’a pas pu' : 'The response could not')
      await expect(reveal).toBeEnabled(); await untouched(first)
      expect((await page.request.post('/api/secret-revelation', { data: { workspaceId: randomUUID(), revelationId: first, kind: 'api_key' } })).status()).toBe(404)
      const second = await create(2)
      expect((await page.request.post('/api/secret-revelation', { data: { workspaceId, revelationId: first, kind: 'api_key' } })).status()).toBe(404)
      expect((await page.request.post('/api/secret-revelation', { data: { workspaceId, revelationId: second, kind: 'report_url' } })).status()).toBe(404)
      await untouched(first); await untouched(second)
      await reveal.click(); await expect(page.locator('input[readonly]')).toHaveValue(/^ya_live_/)
      await page.getByRole('button', { name: locale === 'fr' ? 'Copier' : 'Copy', exact: true }).click()
      await expect(page.getByRole('status')).toContainText(locale === 'fr' ? 'Copié.' : 'Copied.')
      expect(await page.evaluate(() => (window as unknown as { copiedSecret: string }).copiedSecret === (document.querySelector('input[readonly]') as HTMLInputElement).value)).toBe(true)
      expect((await page.request.post('/api/secret-revelation', { data: { workspaceId, revelationId: second, kind: 'api_key' } })).status()).toBe(404)
      const third = await create(3) // Discards the previously revealed secret before screenshots.
      await expect(page.locator('input[readonly]')).toHaveCount(0)
      await db.query("update workspaces set owner_user_id='local-browser-fixture-admin',auth_owner_user_id='local-browser-fixture-admin' where id=$1", [workspaceId])
      await db.query("update auth_members set role='admin' where id=$1", [member.id]); await reveal.click()
      await expect(page.locator('p[role="alert"]')).toContainText(locale === 'fr' ? 'vos droits ont changé' : 'your access has changed')
      await untouched(third); await expect(page.locator('input[readonly]')).toHaveCount(0)
      const panel = page.locator('div').filter({ has: reveal }).filter({ has: page.locator('p[role="alert"]') }).last()
      await panel.screenshot({ path: test.info().outputPath(`secret-revelation-denied-${locale}.png`), caret: 'initial' })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
      await db.query('update workspaces set owner_user_id=$1::text,auth_owner_user_id=$1::text where id=$2', [actor, workspaceId]); await db.query('update auth_members set role=$1 where id=$2', [member.role, member.id])
      await db.query('update api_keys set revoked_at=clock_timestamp() where id=$1', [keyIds[2]])
      const refused = page.waitForResponse((response) => response.url().endsWith('/api/secret-revelation'))
      await reveal.click(); expect((await refused).status()).toBe(404); await expect(page.locator('p[role="alert"]')).toBeVisible(); await untouched(third)
      expect(errors).toEqual([])
    } finally {
      await context.close()
      await db.query('update auth_members set role=$1 where id=$2', [member.role, member.id])
      await db.query('delete from audit_events where workspace_id=$1 and entity_id=any($2::text[])', [workspaceId, keyIds])
      await db.query('delete from secret_revelations where id=any($1::uuid[])', [revelationIds]); await db.query('delete from api_keys where id=any($1::uuid[])', [keyIds])
      await db.query('update workspaces set access_state=$1,plan=$2,locale=$3,owner_user_id=$4,auth_owner_user_id=$5 where id=$6', [original.access_state, original.plan, original.locale, original.owner_user_id, original.auth_owner_user_id, workspaceId]); await db.end()
    }
  })
}
