import { expect, test, type BrowserContext } from '@playwright/test'
import { Client } from 'pg'

if (process.env.PLAYWRIGHT_LOCAL_FIXTURE === '1') {
  for (const [index, locale] of ['fr', 'en'].entries()) test(`ownership transfer ${locale} rechecks old owner authority and preserves other agencies`, async ({ browser }) => {
    const connectionString = process.env.DATABASE_SYSTEM_URL!, url = new URL(connectionString)
    if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || !url.pathname.startsWith('/yodev_test')) throw new Error('Disposable database required')
    const db = new Client({ connectionString }), workspaceId = '80000000-0000-4000-8000-000000000001'
    const oldOwner = 'local-browser-fixture-owner', nextOwner = 'local-browser-fixture-admin'
    const contexts: BrowserContext[] = []
    await db.connect()
    try {
      await db.query("update workspaces set access_state='internal',locale=$1 where id=$2", [locale, workspaceId])
      const original = (await db.query('select slug from workspaces where id=$1', [workspaceId])).rows[0]
      const foreign = (await db.query("select owner_user_id,auth_owner_user_id from workspaces where id='80000000-0000-4000-8000-000000000002'")).rows[0]
      const baseline = Number((await db.query("select count(*) from audit_events where workspace_id=$1 and action='workspace.ownership_transferred'", [workspaceId])).rows[0].count)
      async function context(role: string) {
        const value = await browser.newContext({ baseURL: process.env.PLAYWRIGHT_BASE_URL, storageState: process.env[`PLAYWRIGHT_${role.toUpperCase()}_STORAGE_STATE`], extraHTTPHeaders: { Origin: process.env.PLAYWRIGHT_BASE_URL!, 'x-forwarded-for': `198.51.100.${111 + index}` } })
        contexts.push(value)
        await value.addCookies([{ name: 'yodev_cookie_consent', value: 'rejected', url: process.env.PLAYWRIGHT_BASE_URL! }])
        return value
      }
      const owner = await context('owner'), admin = await context('admin')
      const page = await owner.newPage(), successor = await admin.newPage()
      await page.goto('/settings')
      const details = page.locator('details').filter({ has: page.locator('summary').filter({ hasText: /Transfer workspace ownership|Transférer la propriété/ }) })
      if (!(await details.getByRole('combobox').isVisible())) await details.locator('summary').click()
      await details.getByRole('combobox').selectOption(nextOwner)
      await details.getByRole('textbox', { name: /Workspace identifier confirmation|Confirmation de l’identifiant/ }).fill('wrong-confirmation')
      await details.getByRole('button', { name: /^(Transfer|Transférer)$/ }).click()
      await expect(page).toHaveURL(/error=/)
      expect((await db.query('select owner_user_id from workspaces where id=$1', [workspaceId])).rows[0].owner_user_id).toBe(oldOwner)
      if (!(await details.getByRole('combobox').isVisible())) await details.locator('summary').click()
      await details.getByRole('combobox').selectOption(nextOwner)
      await details.getByRole('textbox', { name: /Workspace identifier confirmation|Confirmation de l’identifiant/ }).fill(original.slug)
      const actionRequest = page.waitForRequest((request) => request.method() === 'POST' && Boolean(request.headers()['next-action']))
      await details.getByRole('button', { name: /^(Transfer|Transférer)$/ }).click()
      const sent = await actionRequest
      await expect(page).toHaveURL(/notice=/)
      await expect(page.locator('summary').filter({ hasText: /Transfer workspace ownership|Transférer la propriété/ })).toHaveCount(0)
      expect((await db.query('select owner_user_id,auth_owner_user_id from workspaces where id=$1', [workspaceId])).rows[0]).toEqual({ owner_user_id: nextOwner, auth_owner_user_id: nextOwner })
      const roles = (await db.query("select user_id,role from auth_members where organization_id='local-browser-fixture-main' and user_id=any($1::text[])", [[oldOwner, nextOwner]])).rows
      expect(roles).toEqual(expect.arrayContaining([{ user_id: oldOwner, role: 'admin' }, { user_id: nextOwner, role: 'owner' }]))
      // Replay the valid old form through the former owner's own session.
      const headers = Object.fromEntries(Object.entries(sent.headers()).filter(([key]) => ['accept', 'content-type', 'next-action', 'next-router-state-tree', 'next-url', 'origin'].includes(key)))
      expect(headers.cookie).toBeUndefined()
      // Retry only a reset local socket once; HTTP denials and the audit assertions remain authoritative.
      const replay = await owner.request.fetch(sent.url(), { method: 'POST', headers, data: sent.postDataBuffer()!, maxRedirects: 0, maxRetries: 1 })
      expect(replay.headers()['x-action-redirect']).toContain('error=')
      expect(Number((await db.query("select count(*) from audit_events where workspace_id=$1 and action='workspace.ownership_transferred'", [workspaceId])).rows[0].count)).toBe(baseline + 1)
      await successor.goto('/settings')
      await expect(successor.locator('summary').filter({ hasText: /Transfer workspace ownership|Transférer la propriété/ })).toBeVisible()
      expect((await db.query("select owner_user_id,auth_owner_user_id from workspaces where id='80000000-0000-4000-8000-000000000002'")).rows[0]).toEqual(foreign)
      await successor.screenshot({ path: test.info().outputPath(`ownership-${locale}.png`), caret: 'initial' })
    } finally {
      await Promise.allSettled(contexts.map((context) => context.close()))
      await db.query("update workspaces set owner_user_id=$1::text,auth_owner_user_id=$1::text,locale='fr' where id=$2", [oldOwner, workspaceId])
      await db.query("update auth_members set role=case when user_id=$1 then 'owner' else 'admin' end where organization_id='local-browser-fixture-main' and user_id=any($2::text[])", [oldOwner, [oldOwner, nextOwner]])
      await db.end()
    }
  })
}
