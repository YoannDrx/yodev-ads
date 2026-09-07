import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { Client } from 'pg'

if (process.env.PLAYWRIGHT_LOCAL_FIXTURE === '1') for (const [index, locale] of ['fr', 'en'].entries()) {
  test(`task actor ${locale} creates, transitions, comments and rejects stale controls`, async ({ browser }) => {
    const url = new URL(process.env.DATABASE_SYSTEM_URL!)
    if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || !url.pathname.startsWith('/yodev_test')) throw new Error('Disposable database required')
    const db = new Client({ connectionString: url.href }), workspaceId = '80000000-0000-4000-8000-000000000001', actor = 'local-browser-fixture-strategist', title = `TASK_ACTOR_${randomUUID()}`
    await db.connect()
    const original = (await db.query('select access_state,plan,locale from workspaces where id=$1', [workspaceId])).rows[0]
    const member = (await db.query("select id,role from auth_members where organization_id='local-browser-fixture-main' and user_id=$1", [actor])).rows[0]
    const context = await browser.newContext({ baseURL: process.env.PLAYWRIGHT_BASE_URL, storageState: process.env.PLAYWRIGHT_STRATEGIST_STORAGE_STATE, viewport: { width: locale === 'fr' ? 390 : 1440, height: 950 }, extraHTTPHeaders: { 'x-forwarded-for': `198.18.36.${index + 1}` } })
    await context.addCookies([{ name: 'yodev_cookie_consent', value: 'rejected', url: process.env.PLAYWRIGHT_BASE_URL! }])
    let taskId: string | undefined
    try {
      await db.query("update workspaces set access_state='internal',plan='internal',locale=$1 where id=$2", [locale, workspaceId])
      const page = await context.newPage(), errors: string[] = []
      page.on('pageerror', (error) => errors.push(error.message)); page.setDefaultTimeout(15_000)
      await page.goto('/tasks')
      const creation = page.locator('form:has(input[name="sourceType"][value="manual"])')
      await creation.getByPlaceholder(/Operational title|Titre opérationnel/).fill(title)
      await creation.getByPlaceholder(/Context, expected outcome|Contexte, résultat attendu/).fill('Task actor workflow fixture')
      await creation.getByRole('combobox', { name: 'SLA', exact: true }).selectOption('24')
      await creation.getByRole('checkbox').check()
      await creation.getByRole('button').click()
      await expect(page).toHaveURL(/notice=/)
      const created = (await db.query('select id,assigned_to,sla_minutes,due_at from workspace_tasks where workspace_id=$1 and title=$2', [workspaceId, title])).rows[0]
      taskId = created.id
      expect(created.assigned_to).toBe(actor); expect(created.sla_minutes).toBe(1440); expect(created.due_at).toBeTruthy()
      await page.goto(`/tasks?id=${taskId}`)
      const transition = page.locator(`form:has(input[name="taskId"][value="${taskId}"]):has(select[name="operation"])`)
      const taskCard = page.locator('[data-slot="card"]').filter({ has: page.getByRole('heading', { name: title, exact: true }) })
      const labels: Record<string, string> = locale === 'fr'
        ? { todo: 'À faire', in_progress: 'En cours', blocked: 'Bloquée', done: 'Terminée', cancelled: 'Annulée' }
        : { todo: 'To do', in_progress: 'In progress', blocked: 'Blocked', done: 'Done', cancelled: 'Cancelled' }
      const state = async () => (await db.query('select status from workspace_tasks where id=$1', [taskId])).rows[0].status
      for (const [operation, status] of [['start', 'in_progress'], ['block', 'blocked'], ['start', 'in_progress'], ['complete', 'done'], ['reopen', 'todo'], ['cancel', 'cancelled'], ['reopen', 'todo']]) {
        await transition.getByRole('combobox').selectOption(operation); await transition.getByRole('button').click()
        await expect.poll(state).toBe(status)
        // Wait for the new form render as well as the database commit before selecting the next operation.
        await expect(taskCard.locator('[data-slot="badge"]').filter({ hasText: new RegExp(`^${labels[status]}$`) })).toBeVisible()
      }
      // The visible form predates a concurrent completion; the server must retain the completed task.
      await transition.getByRole('combobox').selectOption('start')
      await db.query("update workspace_tasks set status='done',completed_at=now() where id=$1", [taskId])
      await transition.getByRole('button').click(); await expect(page).toHaveURL(/error=/)
      expect(await state()).toBe('done')
      await expect(page.getByText(locale === 'fr'
        ? 'L’état de cette tâche ne permet plus cette action. Rechargez la page pour consulter les actions disponibles.'
        : 'The current task status no longer allows this action. Reload the page to see the available actions.', { exact: true })).toBeVisible()
      // A strategist downgraded to analyst can still discuss, but cannot manage the task.
      await transition.getByRole('combobox').selectOption('reopen')
      await db.query("update auth_members set role='analyst' where id=$1", [member.id])
      await transition.getByRole('button').click(); await expect(page).toHaveURL(/error=/)
      expect(await state()).toBe('done'); await expect(transition).toHaveCount(0)
      const comment = page.locator(`form:has(input[name="taskId"][value="${taskId}"]):has(input[name="body"])`)
      await comment.getByRole('textbox').fill('Analyst comment retained')
      await comment.getByRole('button').click(); await expect(page).toHaveURL(/notice=/)
      await expect(page.getByText('Analyst comment retained', { exact: true })).toBeVisible()
      await comment.getByRole('textbox').fill('Forbidden grace comment')
      await db.query("update workspaces set access_state='grace' where id=$1", [workspaceId])
      await comment.getByRole('button').click(); await expect(page).toHaveURL(/error=/)
      await expect(comment).toHaveCount(0)
      expect((await db.query('select body from task_comments where task_id=$1', [taskId])).rows.map((row) => row.body)).toEqual(['Analyst comment retained'])
      expect(Number((await db.query("select count(*) from audit_events where workspace_id=$1 and entity_id=$2 and action like 'task.%'", [workspaceId, taskId])).rows[0].count)).toBe(8)
      await db.query("update auth_members set role='strategist' where id=$1", [member.id])
      await db.query("update workspaces set access_state='internal' where id=$1", [workspaceId])
      await page.goto(`/tasks?id=${taskId}`)
      await expect(transition).toBeVisible()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
      await page.evaluate(() => window.scrollTo(0, 0))
      await page.screenshot({ path: test.info().outputPath(`task-actor-${locale}.png`), fullPage: true, caret: 'initial' })
      expect(errors).toEqual([])
    } finally {
      await context.close().catch(() => {})
      await db.query('update auth_members set role=$1 where id=$2', [member.role, member.id])
      const ids = (await db.query('select id from workspace_tasks where workspace_id=$1 and title=$2', [workspaceId, title])).rows.map((row) => row.id)
      const comments = ids.length ? (await db.query('select id from task_comments where task_id=any($1::uuid[])', [ids])).rows.map((row) => row.id) : []
      await db.query('delete from audit_events where workspace_id=$1 and entity_id=any($2::text[])', [workspaceId, [...ids, ...comments]])
      await db.query('delete from workspace_tasks where id=any($1::uuid[])', [ids])
      await db.query('update workspaces set access_state=$1,plan=$2,locale=$3 where id=$4', [original.access_state, original.plan, original.locale, workspaceId])
      await db.end()
    }
  })
}
