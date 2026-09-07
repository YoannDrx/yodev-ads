# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: auth-lifecycle-local.spec.ts >> auth lifecycle fr: verification, magic link, reset, sessions and passkey
- Location: e2e/auth-lifecycle-local.spec.ts:59:9

# Error details

```
Error: expect(locator).toContainText(expected) failed

Locator: getByRole('alert')
Expected substring: "invalide ou expiré"
Error: strict mode violation: getByRole('alert') resolved to 2 elements:
    1) <p role="alert" class="mt-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">…</p> aka getByText('Ce lien de réinitialisation')
    2) <div role="alert" aria-live="assertive" id="__next-route-announcer__"></div> aka locator('[id="__next-route-announcer__"]')

Call log:
  - Expect "toContainText" with timeout 15000ms
  - waiting for getByRole('alert')

```

# Test source

```ts
  26  |   await db.query('delete from jobs where id=any($1::uuid[])', [emails.map((value) => value.id)])
  27  |   const users = (await db.query('select id from auth_users where email=$1', [recipient])).rows.map((row) => row.id)
  28  |   const organizations = (await db.query('select auth_organization_id as id from workspaces where auth_owner_user_id=any($1::text[])', [users])).rows.map((row) => row.id)
  29  |   await db.query('delete from trial_grants where creator_auth_user_id=any($1::text[])', [users])
  30  |   await db.query('delete from workspaces where auth_owner_user_id=any($1::text[])', [users])
  31  |   await db.query('delete from auth_organizations where id=any($1::text[])', [organizations])
  32  |   await db.query('delete from auth_verifications where value=any($1::text[]) or value=$2', [users, JSON.stringify({ email: recipient })])
  33  |   await db.query('delete from auth_users where id=any($1::text[])', [users])
  34  | }
  35  |
  36  | async function emailUrl(db: Client, recipient: string, kind: string, locale: string) {
  37  |   await expect.poll(async () => (await ownEmails(db, recipient)).filter((row) => row.email.kind === kind).length).toBeGreaterThan(0)
  38  |   const email = (await ownEmails(db, recipient)).find((row) => row.email.kind === kind)!.email
  39  |   expect(email.locale).toBe(locale)
  40  |   expect(new URL(email.actionUrl).origin).toBe(process.env.PLAYWRIGHT_BASE_URL)
  41  |   return email.actionUrl
  42  | }
  43  |
  44  | async function session(context: BrowserContext) {
  45  |   const result = await context.request.get('/api/auth/get-session')
  46  |   expect(result.status()).toBe(200)
  47  |   return result.json()
  48  | }
  49  |
  50  | async function signIn(page: Page, recipient: string, secret: string) {
  51  |   await page.goto('/sign-in')
  52  |   await page.getByLabel('Email', { exact: true }).fill(recipient)
  53  |   await page.getByLabel(/^(Password|Mot de passe)$/).fill(secret)
  54  |   await page.getByRole('button', { name: /^(Sign in|Se connecter)$/ }).click()
  55  | }
  56  |
  57  | if (process.env.PLAYWRIGHT_LOCAL_FIXTURE === '1') {
  58  |   for (const [index, locale] of ['fr', 'en'].entries()) {
  59  |     test(`auth lifecycle ${locale}: verification, magic link, reset, sessions and passkey`, async ({ browser }) => {
  60  |       const connectionString = process.env.DATABASE_SYSTEM_URL!, url = new URL(connectionString)
  61  |       if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || !url.pathname.startsWith('/yodev_test')) throw new Error('Disposable database required')
  62  |       const db = new Client({ connectionString }), recipient = `auth-flow-${locale}@local-browser.example.test`
  63  |       const contexts: BrowserContext[] = []
  64  |       const invitationIds = Array.from({ length: 4 }, () => randomUUID())
  65  |       await db.connect()
  66  |       async function newContext() {
  67  |         const context = await browser.newContext({ baseURL: process.env.PLAYWRIGHT_BASE_URL, extraHTTPHeaders: { 'x-forwarded-for': `198.51.100.${61 + index}`, Origin: process.env.PLAYWRIGHT_BASE_URL! } })
  68  |         contexts.push(context)
  69  |         await context.addCookies([{ name: 'yodev_locale', value: locale, url: process.env.PLAYWRIGHT_BASE_URL! }, { name: 'yodev_cookie_consent', value: 'rejected', url: process.env.PLAYWRIGHT_BASE_URL! }])
  70  |         return context
  71  |       }
  72  |       try {
  73  |         await cleanup(db, recipient)
  74  |         const original = await newContext(), page = await original.newPage()
  75  |         await page.goto('/sign-up')
  76  |         await page.getByLabel(/^(Name|Nom)$/).fill(`Local Auth ${locale}`)
  77  |         await page.getByLabel('Email', { exact: true }).fill(recipient)
  78  |         await page.getByLabel(/^(Password|Mot de passe)$/).fill(password)
  79  |         await page.getByRole('button', { name: /^(Create account|Créer mon compte)$/ }).click()
  80  |         await expect(page.getByRole('status')).toContainText(locale === 'en' ? 'Check your email' : 'Consultez votre email')
  81  |         const user = (await db.query('select id,email_verified from auth_users where email=$1', [recipient])).rows[0]
  82  |         expect(user.email_verified).toBe(false)
  83  |         expect(await session(original)).toBeNull()
  84  |         await signIn(page, recipient, password)
  85  |         await expect(page.getByRole('alert')).toBeVisible()
  86  |         expect(await session(original)).toBeNull()
  87  |         await page.goto(await emailUrl(db, recipient, 'email_verification', locale))
  88  |         expect((await db.query('select email_verified from auth_users where id=$1', [user.id])).rows[0].email_verified).toBe(true)
  89  |         await signIn(page, recipient, password)
  90  |         await page.waitForURL('**/onboarding')
  91  |         await page.getByLabel(/^(Workspace name|Nom de l’espace)$/).fill(`Local lifecycle ${locale}`)
  92  |         await page.getByLabel(/^(Identifier|Identifiant)$/).fill(`auth-lifecycle-${locale}`)
  93  |         await page.getByRole('button', { name: /^(Create secure workspace|Créer l’espace sécurisé)$/ }).click()
  94  |         await page.waitForURL('**/settings')
  95  |         const current = await session(original)
  96  |         expect(current.user.id).toBe(user.id)
  97  |         expect(current.session.activeOrganizationId).toBeTruthy()
  98  |         expect((await db.query('select locale from workspaces where auth_owner_user_id=$1', [user.id])).rows[0].locale).toBe(locale)
  99  |
  100 |         const magic = await newContext(), magicPage = await magic.newPage()
  101 |         await magicPage.goto('/sign-in')
  102 |         await magicPage.getByLabel(/^(Secure sign-in link|Lien de connexion sécurisé)$/).fill(recipient)
  103 |         await magicPage.getByRole('button', { name: /^(Email me a sign-in link|Recevoir un lien par email)$/ }).click()
  104 |         await expect(magicPage.getByRole('status')).toBeVisible()
  105 |         const link = await emailUrl(db, recipient, 'magic_link', locale)
  106 |         await magicPage.goto(link)
  107 |         await magicPage.waitForURL('**/dashboard')
  108 |         expect((await session(magic)).user.id).toBe(user.id)
  109 |         const replay = await newContext(), replayPage = await replay.newPage()
  110 |         await replayPage.goto(link)
  111 |         await expect(replayPage.getByRole('alert')).toContainText(locale === 'en' ? 'invalid or expired' : 'invalide ou expiré')
  112 |         expect(await session(replay)).toBeNull()
  113 |
  114 |         await replayPage.goto('/forgot-password')
  115 |         await replayPage.getByLabel('Email', { exact: true }).fill(recipient)
  116 |         await replayPage.getByRole('button', { name: /^(Continue|Continuer)$/ }).click()
  117 |         await expect(replayPage.getByRole('status')).toBeVisible()
  118 |         const resetLink = await emailUrl(db, recipient, 'password_reset', locale)
  119 |         await replayPage.goto(resetLink)
  120 |         await replayPage.getByLabel(/^(New password|Nouveau mot de passe)$/).fill(newPassword)
  121 |         await replayPage.getByRole('button', { name: /^(Continue|Continuer)$/ }).click()
  122 |         await expect(replayPage.getByRole('status')).toContainText(locale === 'en' ? 'Password updated' : 'Mot de passe mis à jour')
  123 |         expect(await session(original)).toBeNull()
  124 |         expect(await session(magic)).toBeNull()
  125 |         await replayPage.goto(resetLink)
> 126 |         await expect(replayPage.getByRole('alert')).toContainText(locale === 'en' ? 'invalid or expired' : 'invalide ou expiré')
      |                                                     ^ Error: expect(locator).toContainText(expected) failed
  127 |         await signIn(page, recipient, password)
  128 |         await expect(page.getByRole('alert')).toBeVisible()
  129 |         expect(await session(original)).toBeNull()
  130 |         await signIn(page, recipient, newPassword)
  131 |         await page.waitForURL('**/dashboard')
  132 |         await signIn(magicPage, recipient, newPassword)
  133 |         await magicPage.waitForURL('**/dashboard')
  134 |         await page.goto('/account')
  135 |         await page.getByRole('button', { name: /^(Revoke other sessions|Révoquer les autres sessions)$/ }).click()
  136 |         await expect(page.getByRole('status').filter({ hasText: /Other sessions revoked|Autres sessions révoquées/ })).toBeVisible()
  137 |         expect(await session(magic)).toBeNull()
  138 |         expect((await session(original)).user.id).toBe(user.id)
  139 |
  140 |         const cdp = await original.newCDPSession(page)
  141 |         await cdp.send('WebAuthn.enable')
  142 |         const authenticator = await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } })
  143 |         await page.getByRole('button', { name: /^(Register a passkey|Enregistrer une passkey)$/ }).click()
  144 |         await expect(page.getByRole('status').filter({ hasText: /Passkey registered|Passkey enregistrée/ })).toBeVisible()
  145 |         expect((await db.query('select count(*)::int as count from auth_passkeys where user_id=$1', [user.id])).rows[0].count).toBe(1)
  146 |         const keyId = (await db.query('select id from auth_passkeys where user_id=$1', [user.id])).rows[0].id
  147 |         const foreign = await browser.newContext({ baseURL: process.env.PLAYWRIGHT_BASE_URL, storageState: process.env.PLAYWRIGHT_CLIENT_STORAGE_STATE, extraHTTPHeaders: { Origin: process.env.PLAYWRIGHT_BASE_URL!, 'x-forwarded-for': `198.51.100.${91 + index}` } })
  148 |         contexts.push(foreign)
  149 |         const foreignKeys = await foreign.request.get('/api/auth/passkey/list-user-passkeys')
  150 |         expect(foreignKeys.status()).toBe(200)
  151 |         expect((await foreignKeys.json()).some((key: { id: string }) => key.id === keyId)).toBe(false)
  152 |         const removal = await foreign.request.post('/api/auth/passkey/delete-passkey', { data: { id: keyId } })
  153 |         expect([401, 403, 404]).toContain(removal.status())
  154 |         expect((await db.query('select count(*)::int as count from auth_passkeys where id=$1', [keyId])).rows[0].count).toBe(1)
  155 |
  156 |         expect((await original.request.post('/api/auth/sign-out', { data: {} })).status()).toBe(200)
  157 |         await page.goto('/sign-in')
  158 |         await page.getByRole('button', { name: /^(Use a passkey|Utiliser une passkey)$/ }).click()
  159 |         await page.waitForURL('**/dashboard')
  160 |         expect((await session(original)).user.id).toBe(user.id)
  161 |         await page.goto('/account')
  162 |         await page.getByRole('button', { name: /^(Remove|Supprimer) (Ads by Yodev passkey|Passkey Ads by Yodev)$/ }).click()
  163 |         await page.getByRole('button', { name: /^(Confirm removal|Confirmer la suppression)$/ }).click()
  164 |         await expect(page.getByRole('status').filter({ hasText: /Passkey removed|Passkey supprimée/ })).toBeVisible()
  165 |         expect((await db.query('select count(*)::int as count from auth_passkeys where user_id=$1', [user.id])).rows[0].count).toBe(0)
  166 |         expect((await original.request.post('/api/auth/sign-out', { data: {} })).status()).toBe(200)
  167 |         await page.goto('/sign-in')
  168 |         await page.getByRole('button', { name: /^(Use a passkey|Utiliser une passkey)$/ }).click()
  169 |         await expect(page.getByRole('alert')).toBeVisible()
  170 |         expect(await session(original)).toBeNull()
  171 |         // Restore an authenticated context via an existing verified identity's magic link.
  172 |         await page.getByLabel(/^(Secure sign-in link|Lien de connexion sécurisé)$/).fill(recipient)
  173 |         await page.getByRole('button', { name: /^(Email me a sign-in link|Recevoir un lien par email)$/ }).click()
  174 |         await expect(page.getByRole('status')).toBeVisible()
  175 |         await page.goto(await emailUrl(db, recipient, 'magic_link', locale))
  176 |         await page.waitForURL('**/dashboard')
  177 |         await cdp.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId: authenticator.authenticatorId })
  178 |         await cdp.detach()
  179 |         await page.screenshot({ path: test.info().outputPath(`auth-lifecycle-${locale}.png`), caret: 'initial' })
  180 |
  181 |         // Invalid invitations never grant membership, even with a valid session.
  182 |         const organizationId = 'local-browser-fixture-foreign'
  183 |         for (const [n, status, email, expiry] of [
  184 |           [0, 'pending', 'unrelated@local-browser.example.test', '1 day'],
  185 |           [1, 'pending', recipient, '-1 day'],
  186 |           [2, 'canceled', recipient, '1 day'],
  187 |           [3, 'pending', recipient, '1 day'],
  188 |         ] as const) {
  189 |           await db.query("insert into auth_invitations(id,organization_id,email,role,status,expires_at,inviter_id) values($1,$2,$3,'analyst',$4,now()+$5::interval,'local-browser-fixture-foreign-owner')", [invitationIds[n], organizationId, email, status, expiry])
  190 |         }
  191 |         for (const id of invitationIds.slice(0, 3)) {
  192 |           await page.goto(`/invitation?id=${id}`)
  193 |           await page.getByRole('button', { name: /^(Accept invitation|Accepter l’invitation)$/ }).click()
  194 |           await expect(page.getByRole('alert')).toBeVisible()
  195 |           expect((await db.query('select count(*)::int as count from auth_members where organization_id=$1 and user_id=$2', [organizationId, user.id])).rows[0].count).toBe(0)
  196 |         }
  197 |         const invited = await newContext(), invitedPage = await invited.newPage()
  198 |         await invitedPage.goto(`/invitation?id=${invitationIds[3]}`)
  199 |         await invitedPage.getByRole('link', { name: /^(Sign in to continue|Se connecter pour continuer)$/ }).click()
  200 |         expect(new URL(invitedPage.url()).searchParams.get('returnTo')).toBe(`/invitation?id=${invitationIds[3]}`)
  201 |         await invitedPage.getByLabel(/^(Secure sign-in link|Lien de connexion sécurisé)$/).fill(recipient)
  202 |         await invitedPage.getByRole('button', { name: /^(Email me a sign-in link|Recevoir un lien par email)$/ }).click()
  203 |         await expect(invitedPage.getByRole('status')).toBeVisible()
  204 |         const invitationLink = await emailUrl(db, recipient, 'magic_link', locale)
  205 |         expect(new URL(invitationLink).searchParams.get('callbackURL')).toBe(`/invitation?id=${invitationIds[3]}`)
  206 |         await invitedPage.goto(invitationLink)
  207 |         await invitedPage.getByRole('button', { name: /^(Accept invitation|Accepter l’invitation)$/ }).click()
  208 |         await invitedPage.waitForURL('**/dashboard')
  209 |         expect((await session(invited)).session.activeOrganizationId).toBe(organizationId)
  210 |         expect((await db.query('select role from auth_members where organization_id=$1 and user_id=$2', [organizationId, user.id])).rows[0].role).toBe('analyst')
  211 |         expect((await db.query('select status from auth_invitations where id=$1', [invitationIds[3]])).rows[0].status).toBe('accepted')
  212 |         await expect(invitedPage.getByRole('combobox', { name: /Workspace actif|Active workspace/ })).toHaveValue(organizationId)
  213 |         await invitedPage.getByRole('button', { name: /^(Sign out|Se déconnecter)$/ }).click()
  214 |         await invitedPage.waitForURL('**/sign-in')
  215 |         expect(await session(invited)).toBeNull()
  216 |
  217 |       } finally {
  218 |         await Promise.all(contexts.map((context) => context.close()))
  219 |         await db.query('delete from auth_invitations where id=any($1::text[])', [invitationIds])
  220 |         await cleanup(db, recipient)
  221 |         await db.end()
  222 |       }
  223 |     })
  224 |   }
  225 | }
  226 |
```
