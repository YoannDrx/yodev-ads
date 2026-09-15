# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: public.spec.ts >> public status page never claims operational health when status storage is unavailable
- Location: e2e/public.spec.ts:46:5

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByText('État du service')
Expected: visible
Error: strict mode violation: getByText('État du service') resolved to 8 elements:
    1) <p class="text-xs font-semibold uppercase tracking-[.16em] text-white/70">État du service</p> aka getByText('État du service', { exact: true })
    2) <h1 class="mt-2 text-3xl font-semibold">État du service non vérifié</h1> aka getByRole('heading', { name: 'État du service non vérifié' })
    3) <p class="mt-1 text-xs text-muted-foreground">État du service non vérifié</p> aka getByText('État du service non vérifié').nth(1)
    4) <p class="mt-1 text-xs text-muted-foreground">État du service non vérifié</p> aka getByText('État du service non vérifié').nth(2)
    5) <p class="mt-1 text-xs text-muted-foreground">État du service non vérifié</p> aka getByText('État du service non vérifié').nth(3)
    6) <p class="mt-1 text-xs text-muted-foreground">État du service non vérifié</p> aka getByText('État du service non vérifié').nth(4)
    7) <p class="mt-1 text-xs text-muted-foreground">État du service non vérifié</p> aka getByText('État du service non vérifié').nth(5)
    8) <p class="mt-1 text-xs text-muted-foreground">État du service non vérifié</p> aka getByRole('paragraph').filter({ hasText: 'État du service non vérifié' }).nth(5)

Call log:
  - Expect "toBeVisible" with timeout 15000ms
  - waiting for getByText('État du service')

```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - main [ref=e2]:
    - generic [ref=e3]:
      - generic [ref=e4]:
        - link [ref=e5] [cursor=pointer]:
          - /url: /
        - link "Connexion" [ref=e14] [cursor=pointer]:
          - /url: /sign-in
      - generic [ref=e20]:
        - paragraph [ref=e21]: État du service
        - heading "État du service non vérifié" [level=1] [ref=e22]
        - paragraph [ref=e23]: Cette page recense les incidents publics déclarés. Sans contrôle récent vérifié, l’absence d’incident ne permet pas de conclure au bon fonctionnement du service.
        - paragraph [ref=e24]: Registre consulté le 07/09/2026 04:57:19 UTC. 0 incident(s) actif(s).
      - generic [ref=e25]:
        - generic [ref=e33]:
          - paragraph [ref=e34]: Application web
          - paragraph [ref=e35]: État du service non vérifié
        - generic [ref=e45]:
          - paragraph [ref=e46]: Base de données
          - paragraph [ref=e47]: État du service non vérifié
        - generic [ref=e60]:
          - paragraph [ref=e61]: Google Ads API
          - paragraph [ref=e62]: État du service non vérifié
        - generic [ref=e71]:
          - paragraph [ref=e72]: Paiements Stripe
          - paragraph [ref=e73]: État du service non vérifié
        - generic [ref=e82]:
          - paragraph [ref=e83]: Emails et notifications
          - paragraph [ref=e84]: État du service non vérifié
        - generic [ref=e92]:
          - paragraph [ref=e93]: Jobs et planifications
          - paragraph [ref=e94]: État du service non vérifié
      - generic [ref=e96]:
        - heading "Historique des incidents" [level=2] [ref=e97]
        - paragraph [ref=e98]: Tous les incidents publics non résolus et ceux commencés dans les 90 derniers jours. La synthèse prend toujours en compte tous les incidents non résolus, indépendamment de la page et du filtre.
        - navigation "Filtrer les incidents" [ref=e99]:
          - link "Tous" [ref=e100] [cursor=pointer]:
            - /url: /status
          - link "Actifs" [ref=e101] [cursor=pointer]:
            - /url: /status?status=active
          - link "Résolus" [ref=e102] [cursor=pointer]:
            - /url: /status?status=resolved
        - generic [ref=e103]:
          - paragraph [ref=e104]: 0 affichés · 0 résultats · plus récents en premier
          - navigation "Pages de l’historique"
        - paragraph [ref=e105]: Aucun incident public déclaré ne correspond à ce filtre et à cette période.
  - complementary "Vos choix de confidentialité" [ref=e106]:
    - heading "Vos choix de confidentialité" [level=2] [ref=e107]
    - paragraph [ref=e108]:
      - text: Les cookies essentiels permettent la connexion et la sécurité. Les mesures d’audience Vercel ne sont chargées qu’avec votre accord.
      - link "Politique cookies" [ref=e109] [cursor=pointer]:
        - /url: /cookies
    - generic [ref=e110]:
      - button "Continuer sans mesure d’audience" [ref=e112]
      - button "Autoriser la mesure d’audience" [ref=e114]
  - button "Open Next.js Dev Tools" [ref=e122]
```

# Test source

```ts
  1  | import { expect, test } from '@playwright/test'
  2  | 
  3  | test('public landing exposes the product proposition and account creation', async ({ page }) => {
  4  |   const response = await page.goto('/')
  5  |   expect(response?.headers()['content-security-policy']).toMatch(/nonce-[A-Za-z0-9+/=]+/)
  6  |   expect(response?.headers()['content-security-policy']).toContain("frame-ancestors 'none'")
  7  |   expect(response?.headers()['referrer-policy']).toBe('strict-origin-when-cross-origin')
  8  |   expect(response?.headers()['x-content-type-options']).toBe('nosniff')
  9  |   expect(response?.headers()['x-powered-by']).toBeUndefined()
  10 |   await expect(page.getByRole('heading', { name: /système d’exploitation des agences Google Ads/i })).toBeVisible()
  11 |   await expect(page.getByRole('link', { name: /Créer mon espace/i })).toBeVisible()
  12 |   await expect(page.getByText(/API Google Ads officielle/i)).toBeVisible()
  13 | })
  14 | 
  15 | test('authenticated areas redirect anonymous visitors to sign-in', async ({ page }) => {
  16 |   // Better Auth session resolution happens server-side at the protected layout.
  17 |   await page.goto('/dashboard', { waitUntil: 'commit' })
  18 |   await expect.poll(() => page.url()).toMatch(/\/sign-in(?:\?|$)/)
  19 | })
  20 | 
  21 | test('privacy and terms pages are public', async ({ page }) => {
  22 |   await page.goto('/privacy')
  23 |   await expect(page.getByRole('heading', { name: 'Politique de confidentialité' })).toBeVisible()
  24 |   await page.goto('/terms')
  25 |   await expect(page.getByRole('heading', { name: 'Conditions générales de vente et d’utilisation' })).toBeVisible()
  26 | })
  27 | 
  28 | test('the subprocessor register and change-notice policy are public', async ({ page }) => {
  29 |   await page.goto('/subprocessors')
  30 |   await expect(page.getByRole('heading', { name: 'Liste des sous-traitants' })).toBeVisible()
  31 |   await expect(page.getByRole('heading', { name: 'Changements et opposition' })).toBeVisible()
  32 |   await expect(page.getByText(/au moins 15 jours avant leur prise d’effet/i)).toBeVisible()
  33 | })
  34 | 
  35 | test('the public product and legal surface honor the English locale', async ({ context, page }) => {
  36 |   const baseURL = test.info().project.use.baseURL
  37 |   if (typeof baseURL !== 'string') throw new Error('Playwright baseURL is required')
  38 |   await context.addCookies([{ name: 'yodev_locale', value: 'en', url: new URL('/', baseURL).toString() }])
  39 |   await page.goto('/')
  40 |   await expect(page.getByRole('heading', { name: /operating system for Google Ads agencies/i })).toBeVisible()
  41 |   await expect(page.getByRole('link', { name: /Create my workspace/i })).toBeVisible()
  42 |   await page.goto('/privacy')
  43 |   await expect(page.getByRole('heading', { name: 'Privacy policy' })).toBeVisible()
  44 | })
  45 | 
  46 | test('public status page never claims operational health when status storage is unavailable', async ({ page }) => {
  47 |   await page.goto('/status')
> 48 |   await expect(page.getByText('État du service')).toBeVisible()
     |                                                   ^ Error: expect(locator).toBeVisible() failed
  49 |   const unavailable = page.getByRole('heading', { name: 'Statut temporairement indisponible' })
  50 |   await expect(page.locator('h1')).toBeVisible()
  51 |   if (await unavailable.isVisible()) {
  52 |     await expect(page.getByText(/ne signifie pas que l’application est opérationnelle/i)).toBeVisible()
  53 |   }
  54 | })
  55 | 
```