# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: portfolio-local.spec.ts >> agency portfolio >> reviews 50 accounts, personal views and team workload in fr
- Location: e2e/portfolio-local.spec.ts:13:53

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: locator('[data-portfolio-saved-views]').getByRole('link', { name: 'PORTFOLIO_RENAMED' })
Expected: visible
Timeout: 15000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 15000ms
  - waiting for locator('[data-portfolio-saved-views]').getByRole('link', { name: 'PORTFOLIO_RENAMED' })

```

```yaml
- link "Aller au contenu":
  - /url: "#main-content"
- complementary:
  - link "Ads by Yodev":
    - /url: /dashboard
  - navigation "Navigation principale":
    - link "Démarrage":
      - /url: /getting-started
    - link "Cockpit":
      - /url: /dashboard
    - link "Portefeuille":
      - /url: /portfolio
    - link "Comptes clients":
      - /url: /accounts
    - link "Analyse 360":
      - /url: /analysis
    - link "Insights étendus":
      - /url: /insights
    - link "Historique":
      - /url: /history
    - link "Alertes":
      - /url: /alerts
    - link "Tâches":
      - /url: /tasks
    - link "Vigies autonomes":
      - /url: /agents
    - link "Approbations":
      - /url: /approvals
    - link "Rapports clients":
      - /url: /reports
    - link "Support":
      - /url: /support
    - link "Journal d’audit":
      - /url: /audit
    - link "Abonnement":
      - /url: /billing
    - link "Réglages":
      - /url: /settings
    - link "Opérations":
      - /url: /operations
  - paragraph: Votre vigie
  - paragraph: Pilotez chaque compte avec confiance.
- banner:
  - text: Browser main
  - link "État du service non vérifié":
    - /url: /status
  - combobox "Workspace actif":
    - option "Browser foreign"
    - option "Browser main" [selected]
  - button "Se déconnecter"
- main:
  - paragraph: Vue agence
  - heading "Portefeuille clients" [level=1]
  - paragraph: Repérez les comptes à revoir, les décisions en attente et les lacunes de collecte à partir des données enregistrées et qualifiées.
  - link "Choisir les comptes gérés":
    - /url: /accounts
  - status: Vue enregistrée.
  - group: Mes vues enregistrées · 1/20
  - paragraph:
    - link "Lien partageable de cette vue (connexion requise)":
      - /url: /portfolio?q=PORTFOLIO_&attention=missing_data
  - text: Nom ou ID du compte
  - searchbox "Nom ou ID du compte": PORTFOLIO_
  - text: Filtrer les priorités
  - combobox "Filtrer les priorités":
    - option "Tous les comptes"
    - option "À traiter"
    - option "Alertes critiques"
    - option "Données non qualifiées" [selected]
    - option "Tâches en retard"
    - option "Décisions en attente"
  - text: Devise (code ISO)
  - textbox "Devise (code ISO)":
    - /placeholder: EUR
  - text: Responsable des tâches
  - combobox "Responsable des tâches":
    - option "Tous les responsables" [selected]
    - option "Fixture owner"
    - option "Tâches non attribuées"
    - option "Fixture admin"
    - option "Fixture analyst"
    - option "Fixture strategist"
  - button "Appliquer les filtres"
  - link "Réinitialiser":
    - /url: /portfolio
  - paragraph: Vue calculée le 07/09/2026 07:48:10 · Europe/Paris
  - region "Synthèse du portefeuille filtré":
    - paragraph: Comptes gérés
    - paragraph: "2"
    - paragraph: À traiter
    - paragraph: "2"
    - paragraph: Données non qualifiées
    - paragraph: "2"
    - paragraph: Alertes critiques
    - paragraph: "0"
    - paragraph: Tâches en retard
    - paragraph: "0"
    - paragraph: Décisions en attente
    - paragraph: "0"
  - region "Totaux comparables":
    - heading "Totaux par devise et fuseau" [level=2]
    - paragraph: Seuls les historiques complets et récents contribuent à chaque groupe. Les données manquantes sont exclues, jamais comptées comme zéro. Aucune conversion monétaire.
    - heading "EUR · Europe/Paris" [level=3]
    - paragraph: 2026-08-08 → 2026-09-06 · 0/1 comptes qualifiés
    - term: Investissement
    - definition: —
    - term: Conversions
    - definition: —
    - heading "USD · America/New_York" [level=3]
    - paragraph: 2026-08-08 → 2026-09-06 · 0/1 comptes qualifiés
    - term: Investissement
    - definition: —
    - term: Conversions
    - definition: —
  - region "Charge de l’équipe de l’espace":
    - heading "Charge de l’équipe" [level=2]
    - paragraph: Nombre de tâches ouvertes dans tout l’espace, y compris les tâches sans client. Cette section est indépendante des filtres de comptes ci-dessus. Les tâches terminées et annulées sont exclues.
    - heading "Fixture owner" [level=3]
    - paragraph: 1 ouvertes · 0 en cours
    - paragraph: 1 en retard · 1 bloquées · 1 urgentes
    - link "Revoir les tâches":
      - /url: /tasks?status=open&assignee=local-browser-fixture-owner
    - link "Comptes gérés associés":
      - /url: /portfolio?assignee=local-browser-fixture-owner
    - heading "Tâches non attribuées" [level=3]
    - paragraph: 1 ouvertes · 0 en cours
    - paragraph: 0 en retard · 0 bloquées · 0 urgentes
    - link "Revoir les tâches":
      - /url: /tasks?status=open&assignee=unassigned
    - link "Comptes gérés associés":
      - /url: /portfolio?assignee=unassigned
    - heading "Fixture admin" [level=3]
    - paragraph: 0 ouvertes · 0 en cours
    - paragraph: 0 en retard · 0 bloquées · 0 urgentes
    - link "Revoir les tâches":
      - /url: /tasks?status=open&assignee=local-browser-fixture-admin
    - link "Comptes gérés associés":
      - /url: /portfolio?assignee=local-browser-fixture-admin
    - heading "Fixture analyst" [level=3]
    - paragraph: 0 ouvertes · 0 en cours
    - paragraph: 0 en retard · 0 bloquées · 0 urgentes
    - link "Revoir les tâches":
      - /url: /tasks?status=open&assignee=local-browser-fixture-analyst
    - link "Comptes gérés associés":
      - /url: /portfolio?assignee=local-browser-fixture-analyst
    - heading "Fixture strategist" [level=3]
    - paragraph: 0 ouvertes · 0 en cours
    - paragraph: 0 en retard · 0 bloquées · 0 urgentes
    - link "Revoir les tâches":
      - /url: /tasks?status=open&assignee=local-browser-fixture-strategist
    - link "Comptes gérés associés":
      - /url: /portfolio?assignee=local-browser-fixture-strategist
  - heading "Revue des comptes" [level=2]
  - paragraph: 2/2 affichés · comptes les plus récents en premier
  - paragraph: Faites défiler le tableau horizontalement pour lire toutes les mesures. Les périodes se terminent hier dans le fuseau de chaque compte.
  - region "Tableau des mesures par compte":
    - table:
      - rowgroup:
        - row "Compte et couverture Investissement 30 j Conversions / CPA ROAS Pacing du mois Alertes Tâches Décisions":
          - columnheader "Compte et couverture"
          - columnheader "Investissement 30 j"
          - columnheader "Conversions / CPA"
          - columnheader "ROAS"
          - columnheader "Pacing du mois"
          - columnheader "Alertes"
          - columnheader "Tâches"
          - columnheader "Décisions"
      - rowgroup:
        - row "PORTFOLIO_02 EUR · Europe/Paris Données incomplètes · 0/30 jours 2026-08-08 → 2026-09-06 — — CPA — — Objectif à définir MTD — · 0/6 jours 0 ouvertes 0 critiques 0 ouvertes 0 bloquées · 0 en retard 0 en attente":
          - rowheader "PORTFOLIO_02 EUR · Europe/Paris Données incomplètes · 0/30 jours 2026-08-08 → 2026-09-06":
            - link "PORTFOLIO_02":
              - /url: /dashboard?client=8e04561c-f16e-4509-9b50-e8772673e3fa
            - paragraph: EUR · Europe/Paris
            - paragraph: Données incomplètes · 0/30 jours
            - paragraph: 2026-08-08 → 2026-09-06
          - cell "—"
          - cell "— CPA —":
            - text: —
            - paragraph: CPA —
          - cell "—"
          - cell "Objectif à définir MTD — · 0/6 jours":
            - link "Objectif à définir":
              - /url: /dashboard?client=8e04561c-f16e-4509-9b50-e8772673e3fa
            - paragraph: MTD — · 0/6 jours
          - cell "0 ouvertes 0 critiques":
            - link "0 ouvertes":
              - /url: /alerts?client=8e04561c-f16e-4509-9b50-e8772673e3fa
            - paragraph: 0 critiques
          - cell "0 ouvertes 0 bloquées · 0 en retard":
            - link "0 ouvertes":
              - /url: /tasks?client=8e04561c-f16e-4509-9b50-e8772673e3fa&status=open
            - paragraph: 0 bloquées · 0 en retard
          - cell "0 en attente":
            - link "0 en attente":
              - /url: /approvals?client=8e04561c-f16e-4509-9b50-e8772673e3fa
        - row "PORTFOLIO_01 USD · America/New_York Données anciennes · 30/30 jours 2026-08-08 → 2026-09-06 Observé le 04/09/2026 01:48:07 — — CPA — — Objectif à définir MTD — · 6/6 jours 0 ouvertes 0 critiques 0 ouvertes 0 bloquées · 0 en retard 0 en attente":
          - rowheader "PORTFOLIO_01 USD · America/New_York Données anciennes · 30/30 jours 2026-08-08 → 2026-09-06 Observé le 04/09/2026 01:48:07":
            - link "PORTFOLIO_01":
              - /url: /dashboard?client=65dc6538-a4e2-4316-a6a7-23b220b78f7b
            - paragraph: USD · America/New_York
            - paragraph: Données anciennes · 30/30 jours
            - paragraph: 2026-08-08 → 2026-09-06
            - paragraph: Observé le 04/09/2026 01:48:07
          - cell "—"
          - cell "— CPA —":
            - text: —
            - paragraph: CPA —
          - cell "—"
          - cell "Objectif à définir MTD — · 6/6 jours":
            - link "Objectif à définir":
              - /url: /dashboard?client=65dc6538-a4e2-4316-a6a7-23b220b78f7b
            - paragraph: MTD — · 6/6 jours
          - cell "0 ouvertes 0 critiques":
            - link "0 ouvertes":
              - /url: /alerts?client=65dc6538-a4e2-4316-a6a7-23b220b78f7b
            - paragraph: 0 critiques
          - cell "0 ouvertes 0 bloquées · 0 en retard":
            - link "0 ouvertes":
              - /url: /tasks?client=65dc6538-a4e2-4316-a6a7-23b220b78f7b&status=open
            - paragraph: 0 bloquées · 0 en retard
          - cell "0 en attente":
            - link "0 en attente":
              - /url: /approvals?client=65dc6538-a4e2-4316-a6a7-23b220b78f7b
  - navigation "Pages du portefeuille"
- alert: Ads by Yodev — Le système d’exploitation Google Ads des agences
```

# Test source

```ts
  1   | import { expect, test } from '@playwright/test'
  2   | import { randomUUID } from 'node:crypto'
  3   | import { Client } from 'pg'
  4   | 
  5   | if (process.env.PLAYWRIGHT_LOCAL_FIXTURE === '1') {
  6   |   const connectionString = process.env.DATABASE_SYSTEM_URL!, url = new URL(connectionString)
  7   |   if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || !url.pathname.startsWith('/yodev_test')) throw new Error('Disposable database required')
  8   |   const db = new Client({ connectionString }), workspaceId = '80000000-0000-4000-8000-000000000001', marker = 'portfolio-browser-fixture'
  9   |   test.describe.serial('agency portfolio', () => {
  10  |     test.setTimeout(150_000)
  11  |     test.beforeAll(() => db.connect())
  12  |     test.afterAll(() => db.end())
  13  |     for (const locale of ['fr', 'en'] as const) test(`reviews 50 accounts, personal views and team workload in ${locale}`, async ({ browser }) => {
  14  |       const ids = Array.from({ length: 50 }, () => randomUUID()), taskId = randomUUID()
  15  |       const workspace = (await db.query('update workspaces set access_state=$1,plan=$2,locale=$3 where id=$4 returning owner_user_id', ['internal', 'internal', locale, workspaceId])).rows[0]
  16  |       await db.query(`insert into clients(id,workspace_id,google_customer_id,name,currency_code,timezone,created_at)
  17  |         select id,$1,(8400000000+n)::text,'PORTFOLIO_'||lpad(n::text,2,'0'),case when n%2=0 then 'EUR' else 'USD' end,case when n%2=0 then 'Europe/Paris' else 'America/New_York' end,now()-interval '1 day'+n*interval '1 microsecond'
  18  |         from unnest($2::uuid[]) with ordinality as t(id,n)`, [workspaceId, ids])
  19  |       await db.query(`insert into daily_account_metrics(workspace_id,client_id,metric_date,currency_code,timezone,cost_micros,clicks,conversions,conversion_value_micros,coverage_status,source_version,source_observed_at)
  20  |         select workspace_id,id,((now() at time zone timezone)::date-days)::text,currency_code,timezone,'1000000','10','1.25','2000000','complete',$2,now() from clients cross join generate_series(1,30) days where id=any($1::uuid[])`, [ids, marker])
  21  |       await db.query("update daily_account_metrics set source_observed_at=now()-interval '3 days' where client_id=$1", [ids[0]])
  22  |       await db.query("delete from daily_account_metrics where client_id=$1", [ids[1]])
  23  |       await db.query(`insert into workspace_tasks(id,workspace_id,client_id,created_by,assigned_to,title,description,status,priority,due_at) values($1,$2,$3,$4,$5,'PORTFOLIO_TASK','Fixture','blocked','urgent',now()-interval '1 day')`, [taskId, workspaceId, ids[49], marker, workspace.owner_user_id])
  24  |       await db.query(`insert into workspace_tasks(workspace_id,created_by,title,description,status) values($1,$2,'PORTFOLIO_MANUAL','Fixture','todo')`, [workspaceId, marker])
  25  |       const context = await browser.newContext({ baseURL: process.env.PLAYWRIGHT_BASE_URL, storageState: process.env.PLAYWRIGHT_OWNER_STORAGE_STATE, viewport: { width: 1440, height: 1000 } })
  26  |       await context.addCookies([{ name: 'yodev_cookie_consent', value: 'rejected', url: process.env.PLAYWRIGHT_BASE_URL! }])
  27  |       const page = await context.newPage(), errors: string[] = []
  28  |       page.on('pageerror', (error) => errors.push(error.message))
  29  |       try {
  30  |         await page.goto('/portfolio?q=PORTFOLIO_')
  31  |         await expect(page.getByRole('heading', { name: /Portefeuille clients|Client portfolio/ })).toBeVisible()
  32  |         await expect(page.locator('[data-portfolio-account]')).toHaveCount(25)
  33  |         await expect(page.locator('[data-portfolio-group]')).toHaveCount(2)
  34  |         await expect(page.locator('[data-portfolio-group]').filter({ hasText: 'EUR' })).toContainText('24/25')
  35  |         await expect(page.locator('[data-portfolio-group]').filter({ hasText: 'USD' })).toContainText('24/25')
  36  |         await expect(page.getByRole('link', { name: 'PORTFOLIO_50', exact: true })).toBeVisible()
  37  |         await page.getByRole('link', { name: /^(Older results|Résultats plus anciens)$/ }).click()
  38  |         await expect(page).toHaveURL(/cursor=/)
  39  |         await expect(page.getByRole('link', { name: 'PORTFOLIO_01', exact: true })).toBeVisible()
  40  |         await expect(page.locator('[data-portfolio-account]').filter({ hasText: 'PORTFOLIO_01' })).toContainText(/Données anciennes|Stale data/)
  41  |         await expect(page.locator('[data-portfolio-account]').filter({ hasText: 'PORTFOLIO_02' }).locator('td').first()).toHaveText('—')
  42  |         await page.getByRole('combobox', { name: /Priority filter|Filtrer les priorités/ }).selectOption('missing_data')
  43  |         await page.getByRole('button', { name: /Apply filters|Appliquer les filtres/ }).click()
  44  |         await expect(page).not.toHaveURL(/cursor=/)
  45  |         await expect(page.locator('[data-portfolio-account]')).toHaveCount(2)
  46  |         const views = page.locator('[data-portfolio-saved-views]')
  47  |         await views.locator(':scope > summary').click()
  48  |         await views.getByRole('textbox', { name: /New view name|Nom de la nouvelle vue/ }).fill('PORTFOLIO_SAVED')
  49  |         await views.getByRole('button', { name: /Save current filters|Enregistrer ces filtres/ }).click()
  50  |         await expect(page.getByRole('status')).toContainText(/View saved|Vue enregistrée/)
  51  |         await views.locator(':scope > summary').click()
  52  |         const view = views.getByRole('listitem').filter({ hasText: 'PORTFOLIO_SAVED' })
  53  |         await expect(view.getByRole('link')).toHaveAttribute('href', /attention=missing_data/)
  54  |         await view.locator('summary').click()
  55  |         await view.getByRole('textbox', { name: /View name|Nom de la vue/, exact: true }).fill('PORTFOLIO_RENAMED')
  56  |         await view.getByRole('button', { name: /Replace with current filters|Remplacer par les filtres affichés/ }).click()
  57  |         await expect(page.getByRole('status')).toContainText(/View saved|Vue enregistrée/)
  58  |         await views.locator(':scope > summary').click()
> 59  |         await expect(views.getByRole('link', { name: 'PORTFOLIO_RENAMED' })).toBeVisible()
      |                                                                              ^ Error: expect(locator).toBeVisible() failed
  60  |         const stale = await context.newPage()
  61  |         await stale.goto('/portfolio?q=PORTFOLIO_')
  62  |         await stale.locator('[data-portfolio-saved-views] > summary').click()
  63  |         await stale.locator('[data-portfolio-saved-views] li summary').click()
  64  |         await db.query('update portfolio_views set version=$1 where workspace_id=$2 and name=$3', [randomUUID(), workspaceId, 'PORTFOLIO_RENAMED'])
  65  |         await stale.getByRole('button', { name: /Delete saved view|Supprimer la vue enregistrée/ }).click()
  66  |         await expect(stale.getByRole('alert')).toContainText(/view changed|vue a changé/)
  67  |         await stale.close()
  68  |         await page.goto('/portfolio?q=PORTFOLIO_')
  69  |         await views.locator(':scope > summary').click()
  70  |         await views.locator('li summary').click()
  71  |         await views.getByRole('button', { name: /Delete saved view|Supprimer la vue enregistrée/ }).click()
  72  |         await expect(page.getByRole('status')).toContainText(/View deleted|Vue supprimée/)
  73  |         const unassigned = page.locator('[data-portfolio-workload]').filter({ hasText: /Tâches non attribuées|Unassigned tasks/ })
  74  |         await unassigned.getByRole('link', { name: /Review tasks|Revoir les tâches/ }).click()
  75  |         await expect(page).toHaveURL(/assignee=unassigned/)
  76  |         await expect(page.getByText('PORTFOLIO_MANUAL', { exact: true })).toBeVisible()
  77  |         await expect(page.getByText('PORTFOLIO_TASK', { exact: true })).toHaveCount(0)
  78  |         await page.goto(`/portfolio?assignee=${workspace.owner_user_id}`)
  79  |         await expect(page.locator('[data-portfolio-account]')).toHaveCount(1)
  80  |         await expect(page.locator('[data-portfolio-account]')).toContainText(/1 blocked|1 bloquées/)
  81  |         await db.query("update workspace_tasks set status='done' where id=$1", [taskId])
  82  |         await page.reload()
  83  |         await expect(page.locator('[data-portfolio-account]')).toHaveCount(0)
  84  |         await page.goto('/portfolio?q=PORTFOLIO_')
  85  |         await page.screenshot({ path: test.info().outputPath(`portfolio-desktop-${locale}.png`), fullPage: true })
  86  |         await page.setViewportSize({ width: 390, height: 844 })
  87  |         expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
  88  |         await page.screenshot({ path: test.info().outputPath(`portfolio-mobile-${locale}.png`), fullPage: true })
  89  |         await db.query("update workspaces set access_state='grace' where id=$1", [workspaceId])
  90  |         await page.reload()
  91  |         await expect(page.locator('[data-portfolio-account]')).toHaveCount(25)
  92  |         await views.locator(':scope > summary').click()
  93  |         await expect(views.getByRole('button')).toHaveCount(0)
  94  |         await db.query("update workspaces set access_state='internal' where id=$1", [workspaceId])
  95  |         const reader = await browser.newContext({ baseURL: process.env.PLAYWRIGHT_BASE_URL, storageState: process.env.PLAYWRIGHT_CLIENT_STORAGE_STATE })
  96  |         try {
  97  |           const clientPage = await reader.newPage(); await clientPage.goto('/portfolio?q=PORTFOLIO_')
  98  |           await expect(clientPage).not.toHaveURL(/\/portfolio/)
  99  |           await expect(clientPage.locator('[data-portfolio-account]')).toHaveCount(0)
  100 |         } finally { await reader.close() }
  101 |         const anonymous = await browser.newContext({ baseURL: process.env.PLAYWRIGHT_BASE_URL })
  102 |         try { const signedOut = await anonymous.newPage(); await signedOut.goto('/portfolio?q=PORTFOLIO_'); await expect(signedOut).toHaveURL(/sign-in/) } finally { await anonymous.close() }
  103 |         expect(errors).toEqual([])
  104 |       } finally {
  105 |         await context.close()
  106 |         await db.query('delete from portfolio_views where workspace_id=$1 and name like $2', [workspaceId, 'PORTFOLIO_%'])
  107 |         await db.query('delete from workspace_tasks where workspace_id=$1 and created_by=$2', [workspaceId, marker])
  108 |         await db.query('delete from clients where id=any($1::uuid[])', [ids])
  109 |         await db.query("update workspaces set locale='fr',access_state='internal' where id=$1", [workspaceId])
  110 |       }
  111 |     })
  112 |   })
  113 | }
  114 | 
```