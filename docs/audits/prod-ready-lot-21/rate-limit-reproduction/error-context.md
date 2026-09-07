# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: prod-ready-local.spec.ts >> local production readiness regression journeys >> workspace selection switches context and permissions on mobile
- Location: e2e/prod-ready-local.spec.ts:276:9

# Error details

```
Error: expect(locator).toHaveValue(expected) failed

Locator: getByRole('combobox', { name: /Workspace actif|Active workspace/ })
Expected: "local-browser-fixture-foreign"
Timeout: 15000ms
Error: element(s) not found

Call log:
  - Expect "toHaveValue" with timeout 15000ms
  - waiting for getByRole('combobox', { name: /Workspace actif|Active workspace/ })

```

```yaml
- link "Aller au contenu":
  - /url: "#main-content"
- banner:
  - link "Ads by Yodev":
    - /url: /support
  - link "Sécurité du compte":
    - /url: /account
  - button "Se déconnecter"
- main:
  - paragraph: Support client
  - heading "Obtenir l’aide de Yodev" [level=1]
  - paragraph: Un canal tenanté et audité pour les demandes techniques, de facturation, Google Ads et de confidentialité.
  - text: Accès non autorisé
  - paragraph: Demandes ouvertes
  - paragraph: "0"
  - paragraph: Demandes correspondantes
  - paragraph: "0"
  - paragraph: Les messages ne sont visibles que par votre workspace et le support Yodev.
  - text: Créer une demande de support
  - textbox "Objet court et précis"
  - combobox "Catégorie":
    - option "Technique" [selected]
    - option "Facturation"
    - option "Google Ads"
    - option "Fonctionnalité"
    - option "Données et confidentialité"
  - combobox "Priorité":
    - option "Normale" [selected]
    - option "Haute"
    - option "Urgente — production bloquée"
  - textbox "Contexte, étapes de reproduction, résultat attendu et constaté. Ne transmettez jamais de secrets."
  - button "Envoyer la demande"
  - text: Rechercher dans tous les résultats
  - searchbox "Rechercher dans tous les résultats"
  - text: Filtrer par statut
  - combobox "Filtrer par statut":
    - option "Tous les statuts" [selected]
    - option "Ouvertes"
    - option "En attente du support"
    - option "En attente de votre retour"
    - option "Résolues"
    - option "Fermées"
  - button "Appliquer les filtres"
  - link "Réinitialiser":
    - /url: /support
  - paragraph: 0 affichés · 0 résultats correspondants · plus récents en premier
  - navigation "Pages de résultats"
  - heading "Aucune demande de support" [level=2]
  - paragraph: Vos futures conversations resteront accessibles ici.
- navigation "Navigation rapide":
  - link "Support":
    - /url: /support
  - group: Menu
- alert
```

# Test source

```ts
  186 |       const readJobs = () => db.query(`select type,status from jobs where workspace_id=$1 and payload->>'clientId'=$2`, [workspaceId, clientId])
  187 |       try {
  188 |         await page.goto(`/dashboard?client=${clientId}`)
  189 |         const consent = page.getByRole('button', { name: /Continuer sans mesure|Continue without/ })
  190 |         if (await consent.isVisible()) { await consent.click(); await expect(consent).toBeHidden() }
  191 |         const refresh = page.getByRole('button', { name: /Actualiser les données|Refresh data/ })
  192 |         await refresh.click()
  193 |         await expect(page).toHaveURL(/sync=queued/)
  194 |         await expect(page.getByRole('region', { name: /Synchronisation des données|Data synchronization/ })).toContainText(locale === 'en' ? 'Collection queued.' : 'Collecte planifiée.')
  195 |         await expect(refresh).toBeDisabled()
  196 |         expect((await readJobs()).rows).toHaveLength(18)
  197 |         await refresh.evaluate((element) => (element as HTMLButtonElement).form!.requestSubmit())
  198 |         await expect(page).toHaveURL(/sync=pending/)
  199 |         expect((await readJobs()).rows).toHaveLength(18)
  200 |         const analyst = await pageFor(browser, 'analyst', 1440)
  201 |         try {
  202 |           await analyst.page.goto(`/dashboard?client=${clientId}`)
  203 |           await expect(analyst.page.getByRole('button', { name: /Actualiser les données|Refresh data/ })).toHaveCount(0)
  204 |           await expect(analyst.page.getByRole('region', { name: /Synchronisation des données|Data synchronization/ }).getByRole('link', { name: /Connexion|Connection/ })).toHaveCount(0)
  205 |         } finally { await analyst.context.close() }
  206 |         await db.query(`delete from jobs where workspace_id=$1 and payload->>'clientId'=$2`, [workspaceId, clientId])
  207 |         // Open an enabled form, then revoke the connection before its submission.
  208 |         await page.goto(`/dashboard?client=${clientId}`)
  209 |         await expect(refresh).toBeEnabled()
  210 |         await db.query('update google_ads_connections set status=$1 where id=$2', ['revoked', connectionId])
  211 |         await refresh.click()
  212 |         await expect(page).toHaveURL(/sync=unavailable/)
  213 |         await expect(page.getByRole('region', { name: /Synchronisation des données|Data synchronization/ })).toContainText(locale === 'en' ? 'Collection unavailable.' : 'Collecte indisponible.')
  214 |         await expect(refresh).toHaveCount(0)
  215 |         expect((await readJobs()).rows).toHaveLength(0)
  216 |         expect(errors).toEqual([])
  217 |       } finally {
  218 |         await context.close()
  219 |         await db.query('delete from google_ads_connections where id=$1', [connectionId])
  220 |         await db.query('delete from clients where id=$1', [clientId])
  221 |       }
  222 |     })
  223 |
  224 |     test('grace permits stored views while hiding mutations', async ({ browser }) => {
  225 |       await db.query('update workspaces set access_state=$1 where id=$2', ['grace', workspaceId])
  226 |       for (const role of ['owner', 'analyst']) {
  227 |         const { page, context } = await pageFor(browser, role)
  228 |         try {
  229 |           for (const path of ['/accounts', '/history', '/alerts', '/tasks', '/approvals', '/reports']) {
  230 |             expect((await page.goto(path))?.status()).toBe(200)
  231 |             await expect(page).toHaveURL(new RegExp(`${path}$`))
  232 |             await expect(page.locator('main')).toBeVisible()
  233 |             await expect(page.getByRole('button', { name: /Générer le lien|Analyser maintenant|Créer une tâche|Approuver/ })).toHaveCount(0)
  234 |           }
  235 |           if (role === 'owner') expect((await page.goto('/audit'))?.status()).toBe(200)
  236 |         } finally { await context.close() }
  237 |       }
  238 |     })
  239 |     test('suspended members have an accessible recovery destination without redirect loops', async ({ browser }) => {
  240 |       await db.query('update workspaces set access_state=$1 where id=$2', ['suspended', workspaceId])
  241 |       for (const role of ['owner', 'admin', 'client']) {
  242 |         const { page, context } = await pageFor(browser, role)
  243 |         try {
  244 |           expect((await page.goto('/dashboard'))?.status()).toBe(200)
  245 |           await expect(page).toHaveURL(role === 'owner' ? /\/billing\?/ : /\/support\?/)
  246 |           await expect(page.locator('main')).toBeVisible()
  247 |         } finally { await context.close() }
  248 |       }
  249 |     })
  250 |     for (const locale of ['fr', 'en']) for (const width of [390, 768]) {
  251 |       test(`full navigation and workspace selection work at ${width}px in ${locale}`, async ({ browser }) => {
  252 |         await db.query('update workspaces set access_state=$1, locale=$2 where id=$3', ['internal', locale, workspaceId])
  253 |         const { page, context } = await pageFor(browser, 'owner', width)
  254 |         try {
  255 |           await page.goto('/dashboard')
  256 |           const consent = page.getByRole('button', { name: /Continuer sans mesure|Continue without/ })
  257 |           if (await consent.isVisible()) { await consent.click(); await expect(consent).toBeHidden() }
  258 |           await expect(page.getByRole('combobox', { name: /Workspace actif|Active workspace/ })).toBeVisible()
  259 |           const menu = page.locator('summary').filter({ hasText: /^Menu$/ })
  260 |           await menu.click()
  261 |           const navigation = page.getByRole('navigation', { name: /Navigation complète|Full navigation/ })
  262 |           await expect(navigation).toBeVisible()
  263 |           for (const href of ['/accounts', '/insights', '/history', '/tasks', '/agents', '/reports', '/support', '/audit', '/settings']) await expect(navigation.locator(`a[href="${href}"]`)).toBeVisible()
  264 |           await page.screenshot({ caret: 'initial', path: test.info().outputPath(`menu-${locale}-${width}.png`) })
  265 |           await menu.press('Escape')
  266 |           await expect(navigation).not.toBeVisible()
  267 |           await expect(menu).toBeFocused()
  268 |           await menu.press('Enter')
  269 |           await navigation.locator('a[href="/settings"]').click()
  270 |           await expect(page).toHaveURL(/\/settings$/, { timeout: 15_000 })
  271 |           await expect(navigation).not.toBeVisible()
  272 |           expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  273 |         } finally { await context.close() }
  274 |       })
  275 |     }
  276 |     test('workspace selection switches context and permissions on mobile', async ({ browser }) => {
  277 |       await db.query('update workspaces set access_state=$1, locale=$2 where id=$3', ['internal', 'fr', workspaceId])
  278 |       const { page, context } = await pageFor(browser, 'owner', 390)
  279 |       try {
  280 |         await page.goto('/dashboard')
  281 |         const consent = page.getByRole('button', { name: /Continuer sans mesure|Continue without/ })
  282 |         if (await consent.isVisible()) { await consent.click(); await expect(consent).toBeHidden() }
  283 |         const selector = page.getByRole('combobox', { name: /Workspace actif|Active workspace/ })
  284 |         await selector.selectOption('local-browser-fixture-foreign')
  285 |         await expect(page).toHaveURL(/\/support/)
> 286 |         await expect(selector).toHaveValue('local-browser-fixture-foreign')
      |                                ^ Error: expect(locator).toHaveValue(expected) failed
  287 |         await page.locator('summary').filter({ hasText: /^Menu$/ }).click()
  288 |         await expect(page.getByRole('navigation', { name: /Navigation complète|Full navigation/ }).locator('a[href="/settings"]')).toHaveCount(0)
  289 |         await selector.selectOption('local-browser-fixture-main')
  290 |         await expect(page).toHaveURL(/\/dashboard$/)
  291 |         await expect(selector).toHaveValue('local-browser-fixture-main')
  292 |       } finally { await context.close() }
  293 |     })
  294 |     test('analysts do not see monitoring controls denied by their role', async ({ browser }) => {
  295 |       await db.query('update workspaces set access_state=$1, locale=$2 where id=$3', ['internal', 'fr', workspaceId])
  296 |       const { page, context } = await pageFor(browser, 'analyst')
  297 |       try {
  298 |         await page.goto('/agents')
  299 |         await expect(page.getByRole('button', { name: /Analyser maintenant|Créer|Activer|Suspendre/ })).toHaveCount(0)
  300 |       } finally { await context.close() }
  301 |     })
  302 |   })
  303 | }
  304 |
```
