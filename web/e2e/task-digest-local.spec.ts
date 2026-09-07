import { expect, test } from '@playwright/test'
import { Client } from 'pg'

if (process.env.PLAYWRIGHT_LOCAL_FIXTURE === '1') for (const [index, locale] of ['fr', 'en'].entries()) {
  test(`task digest ${locale} opens the complete assigned collection and rejects impossible deadlines`, async ({ browser }) => {
    const url = new URL(process.env.DATABASE_SYSTEM_URL!)
    if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || !url.pathname.startsWith('/yodev_test')) throw new Error('Disposable database required')
    const db = new Client({ connectionString: url.href }), workspaceId = '80000000-0000-4000-8000-000000000001', actor = 'local-browser-fixture-analyst'
    await db.connect()
    const original = (await db.query('select access_state,plan,locale from workspaces where id=$1', [workspaceId])).rows[0]
    const context = await browser.newContext({ baseURL: process.env.PLAYWRIGHT_BASE_URL, storageState: process.env.PLAYWRIGHT_ANALYST_STORAGE_STATE, viewport: { width: locale === 'fr' ? 390 : 1440, height: 950 }, extraHTTPHeaders: { 'x-forwarded-for': `198.18.41.${index + 1}` } })
    const owner = await browser.newContext({ baseURL: process.env.PLAYWRIGHT_BASE_URL, storageState: process.env.PLAYWRIGHT_OWNER_STORAGE_STATE })
    const fixture = `digest-browser-${locale}`
    try {
      for (const current of [context, owner]) await current.addCookies([{ name: 'yodev_cookie_consent', value: 'rejected', url: process.env.PLAYWRIGHT_BASE_URL! }])
      await db.query("update workspaces set access_state='active',plan='agency',locale=$1 where id=$2", [locale, workspaceId])
      await db.query("insert into workspace_tasks(workspace_id,created_by,title,description,assigned_to,created_at) select $1,$3,'Digest task '||n,'Fixture',$2,now()-interval '1 day'+n*interval '1 microsecond' from generate_series(1,55)n", [workspaceId, actor, fixture])
      await db.query("insert into workspace_tasks(workspace_id,created_by,title,description,assigned_to,status) values($1,$2,'Excluded colleague task','Fixture','different-member','todo'),($1,$2,'Excluded finished task','Fixture',$3,'done')", [workspaceId, fixture, actor])
      const page = await context.newPage(), errors: string[] = []
      page.on('pageerror', (error) => errors.push(error.message))
      await page.goto(`/tasks?${new URLSearchParams({ workspace: workspaceId, assignee: actor, status: 'open' })}`)
      const seen = new Set<string>()
      for (const count of [25, 25, 5]) {
        const titles = page.getByRole('heading', { name: /^Digest task / })
        await expect(titles).toHaveCount(count)
        await expect(page.locator('[data-collection-controls]')).toContainText(locale === 'fr' ? '55 résultats correspondants' : '55 matching results')
        for (const title of await titles.allTextContents()) { expect(seen.has(title)).toBe(false); seen.add(title) }
        await expect(page.getByRole('heading', { name: /^Excluded/ })).toHaveCount(0)
        if (count === 25) {
          const next = page.getByRole('link', { name: locale === 'fr' ? 'Résultats plus anciens' : 'Older results' })
          expect(await next.getAttribute('href')).toContain(`workspace=${workspaceId}`)
          await next.click()
          await expect(page).toHaveURL(/cursor=/)
          // Distinct page contents must render before reading the next group.
          await expect.poll(async () => (await titles.allTextContents()).some((title) => !seen.has(title))).toBe(true)
        }
      }
      expect(seen.size).toBe(55)
      await page.evaluate(() => document.fonts.ready)
      await page.locator('[data-collection-controls]').evaluate((element) => element.scrollIntoView({ block: 'center', behavior: 'instant' }))
      await page.screenshot({ path: test.info().outputPath(`task-digest-collection-${locale}.png`) })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
      await page.goto('/tasks?workspace=80000000-0000-4000-8000-000000000002')
      await expect(page.getByRole('heading', { name: locale === 'fr' ? 'Tâches d’un autre espace' : 'Tasks from another workspace' })).toBeVisible()
      await expect(page.locator('[data-collection-controls]')).toHaveCount(0)
      await page.getByRole('link', { name: locale === 'fr' ? 'Ouvrir les tâches de mon espace actuel' : 'Open tasks in my current workspace' }).click()
      await expect(page.locator('[data-collection-controls]')).toBeVisible()
      const editor = await owner.newPage(); await editor.goto('/tasks')
      const creation = editor.locator('form:has(input[name="sourceType"][value="manual"])')
      await creation.locator('[name="title"]').fill('Impossible deadline must not persist')
      await creation.locator('[name="dueDate"]').evaluate((element) => { const input = element as HTMLInputElement; input.type = 'text'; input.value = '2026-02-31' })
      await creation.getByRole('button').click()
      await expect(editor.getByText(locale === 'fr' ? 'Date d’échéance invalide.' : 'Invalid due date.', { exact: true })).toBeVisible()
      expect((await db.query("select count(*) from workspace_tasks where workspace_id=$1 and title='Impossible deadline must not persist'", [workspaceId])).rows[0].count).toBe('0')
      expect(errors).toEqual([])
    } finally {
      await context.close().catch(() => {}); await owner.close().catch(() => {})
      await db.query('delete from workspace_tasks where workspace_id=$1 and created_by=$2', [workspaceId, fixture])
      await db.query('update workspaces set access_state=$1,plan=$2,locale=$3 where id=$4', [original.access_state, original.plan, original.locale, workspaceId]); await db.end()
    }
  })
}
