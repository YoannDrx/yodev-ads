# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: task-actors-local.spec.ts >> task actor en creates, transitions, comments and rejects stale controls
- Location: e2e/task-actors-local.spec.ts:6:7

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: "done"
Received: "blocked"

Call Log:
- Timeout 15000ms exceeded while waiting on the predicate
```

# Test source

```ts
  1  | import { expect, test } from '@playwright/test'
  2  | import { randomUUID } from 'node:crypto'
  3  | import { Client } from 'pg'
  4  |
  5  | if (process.env.PLAYWRIGHT_LOCAL_FIXTURE === '1') for (const [index, locale] of ['fr', 'en'].entries()) {
  6  |   test(`task actor ${locale} creates, transitions, comments and rejects stale controls`, async ({ browser }) => {
  7  |     const url = new URL(process.env.DATABASE_SYSTEM_URL!)
  8  |     if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || !url.pathname.startsWith('/yodev_test')) throw new Error('Disposable database required')
  9  |     const db = new Client({ connectionString: url.href }), workspaceId = '80000000-0000-4000-8000-000000000001', actor = 'local-browser-fixture-strategist', title = `TASK_ACTOR_${randomUUID()}`
  10 |     await db.connect()
  11 |     const original = (await db.query('select access_state,plan,locale from workspaces where id=$1', [workspaceId])).rows[0]
  12 |     const member = (await db.query("select id,role from auth_members where organization_id='local-browser-fixture-main' and user_id=$1", [actor])).rows[0]
  13 |     const context = await browser.newContext({ baseURL: process.env.PLAYWRIGHT_BASE_URL, storageState: process.env.PLAYWRIGHT_STRATEGIST_STORAGE_STATE, viewport: { width: locale === 'fr' ? 390 : 1440, height: 950 }, extraHTTPHeaders: { 'x-forwarded-for': `198.18.36.${index + 1}` } })
  14 |     await context.addCookies([{ name: 'yodev_cookie_consent', value: 'rejected', url: process.env.PLAYWRIGHT_BASE_URL! }])
  15 |     let taskId: string | undefined
  16 |     try {
  17 |       await db.query("update workspaces set access_state='internal',plan='internal',locale=$1 where id=$2", [locale, workspaceId])
  18 |       const page = await context.newPage(), errors: string[] = []
  19 |       page.on('pageerror', (error) => errors.push(error.message)); page.setDefaultTimeout(15_000)
  20 |       await page.goto('/tasks')
  21 |       const creation = page.locator('form:has(input[name="sourceType"][value="manual"])')
  22 |       await creation.getByPlaceholder(/Operational title|Titre opérationnel/).fill(title)
  23 |       await creation.getByPlaceholder(/Context, expected outcome|Contexte, résultat attendu/).fill('Task actor workflow fixture')
  24 |       await creation.getByRole('combobox', { name: 'SLA', exact: true }).selectOption('24')
  25 |       await creation.getByRole('checkbox').check()
  26 |       await creation.getByRole('button').click()
  27 |       await expect(page).toHaveURL(/notice=/)
  28 |       const created = (await db.query('select id,assigned_to,sla_minutes,due_at from workspace_tasks where workspace_id=$1 and title=$2', [workspaceId, title])).rows[0]
  29 |       taskId = created.id
  30 |       expect(created.assigned_to).toBe(actor); expect(created.sla_minutes).toBe(1440); expect(created.due_at).toBeTruthy()
  31 |       await page.goto(`/tasks?id=${taskId}`)
  32 |       const transition = page.locator(`form:has(input[name="taskId"][value="${taskId}"]):has(select[name="operation"])`)
  33 |       const state = async () => (await db.query('select status from workspace_tasks where id=$1', [taskId])).rows[0].status
  34 |       for (const [operation, status] of [['start', 'in_progress'], ['block', 'blocked'], ['start', 'in_progress'], ['complete', 'done'], ['reopen', 'todo'], ['cancel', 'cancelled'], ['reopen', 'todo']]) {
  35 |         await transition.getByRole('combobox').selectOption(operation); await transition.getByRole('button').click()
> 36 |         await expect.poll(state).toBe(status)
     |                                  ^ Error: expect(received).toBe(expected) // Object.is equality
  37 |       }
  38 |       // The visible form predates a concurrent completion; the server must retain the completed task.
  39 |       await transition.getByRole('combobox').selectOption('start')
  40 |       await db.query("update workspace_tasks set status='done',completed_at=now() where id=$1", [taskId])
  41 |       await transition.getByRole('button').click(); await expect(page).toHaveURL(/error=/)
  42 |       expect(await state()).toBe('done')
  43 |       await expect(page.getByText(locale === 'fr'
  44 |         ? 'L’état de cette tâche ne permet plus cette action. Rechargez la page pour consulter les actions disponibles.'
  45 |         : 'The current task status no longer allows this action. Reload the page to see the available actions.', { exact: true })).toBeVisible()
  46 |       // A strategist downgraded to analyst can still discuss, but cannot manage the task.
  47 |       await transition.getByRole('combobox').selectOption('reopen')
  48 |       await db.query("update auth_members set role='analyst' where id=$1", [member.id])
  49 |       await transition.getByRole('button').click(); await expect(page).toHaveURL(/error=/)
  50 |       expect(await state()).toBe('done'); await expect(transition).toHaveCount(0)
  51 |       const comment = page.locator(`form:has(input[name="taskId"][value="${taskId}"]):has(input[name="body"])`)
  52 |       await comment.getByRole('textbox').fill('Analyst comment retained')
  53 |       await comment.getByRole('button').click(); await expect(page).toHaveURL(/notice=/)
  54 |       await expect(page.getByText('Analyst comment retained', { exact: true })).toBeVisible()
  55 |       await comment.getByRole('textbox').fill('Forbidden grace comment')
  56 |       await db.query("update workspaces set access_state='grace' where id=$1", [workspaceId])
  57 |       await comment.getByRole('button').click(); await expect(page).toHaveURL(/error=/)
  58 |       await expect(comment).toHaveCount(0)
  59 |       expect((await db.query('select body from task_comments where task_id=$1', [taskId])).rows.map((row) => row.body)).toEqual(['Analyst comment retained'])
  60 |       expect(Number((await db.query("select count(*) from audit_events where workspace_id=$1 and entity_id=$2 and action like 'task.%'", [workspaceId, taskId])).rows[0].count)).toBe(8)
  61 |       await db.query("update auth_members set role='strategist' where id=$1", [member.id])
  62 |       await db.query("update workspaces set access_state='internal' where id=$1", [workspaceId])
  63 |       await page.goto(`/tasks?id=${taskId}`)
  64 |       await expect(transition).toBeVisible()
  65 |       expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  66 |       await page.evaluate(() => window.scrollTo(0, 0))
  67 |       await page.screenshot({ path: test.info().outputPath(`task-actor-${locale}.png`), fullPage: true, caret: 'initial' })
  68 |       expect(errors).toEqual([])
  69 |     } finally {
  70 |       await context.close().catch(() => {})
  71 |       await db.query('update auth_members set role=$1 where id=$2', [member.role, member.id])
  72 |       const ids = (await db.query('select id from workspace_tasks where workspace_id=$1 and title=$2', [workspaceId, title])).rows.map((row) => row.id)
  73 |       const comments = ids.length ? (await db.query('select id from task_comments where task_id=any($1::uuid[])', [ids])).rows.map((row) => row.id) : []
  74 |       await db.query('delete from audit_events where workspace_id=$1 and entity_id=any($2::text[])', [workspaceId, [...ids, ...comments]])
  75 |       await db.query('delete from workspace_tasks where id=any($1::uuid[])', [ids])
  76 |       await db.query('update workspaces set access_state=$1,plan=$2,locale=$3 where id=$4', [original.access_state, original.plan, original.locale, workspaceId])
  77 |       await db.end()
  78 |     }
  79 |   })
  80 | }
  81 |
```
