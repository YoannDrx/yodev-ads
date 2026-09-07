import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import { createDecipheriv, randomUUID } from 'node:crypto'
import { Client } from 'pg'

const password = 'Local-auth-lifecycle-before-2026!'
const newPassword = 'Local-auth-lifecycle-after-2026!'
type QueuedEmail = { to: string; kind: string; actionUrl: string; locale: string }

function decode(envelope: string): QueuedEmail {
  const value = JSON.parse(Buffer.from(envelope, 'base64url').toString('utf8'))
  if (value.v !== 1) throw new Error('Expected disposable fixture encryption')
  const decipher = createDecipheriv('aes-256-gcm', Buffer.alloc(32, 7), Buffer.from(value.iv, 'base64url'))
  decipher.setAuthTag(Buffer.from(value.tag, 'base64url'))
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(value.data, 'base64url')), decipher.final()]).toString('utf8'))
}

async function ownEmails(db: Client, recipient: string) {
  const rows = await db.query("select id,payload from jobs where type='auth.email_deliver' order by created_at desc,id desc")
  return rows.rows.flatMap((row) => {
    try { const email = decode(row.payload.envelope); return email.to === recipient ? [{ id: row.id as string, email }] : [] } catch { return [] }
  })
}

async function cleanup(db: Client, recipient: string) {
  const emails = await ownEmails(db, recipient)
  await db.query('delete from jobs where id=any($1::uuid[])', [emails.map((value) => value.id)])
  const users = (await db.query('select id from auth_users where email=$1', [recipient])).rows.map((row) => row.id)
  const organizations = (await db.query('select auth_organization_id as id from workspaces where auth_owner_user_id=any($1::text[])', [users])).rows.map((row) => row.id)
  await db.query('delete from trial_grants where creator_auth_user_id=any($1::text[])', [users])
  await db.query('delete from workspaces where auth_owner_user_id=any($1::text[])', [users])
  await db.query('delete from auth_organizations where id=any($1::text[])', [organizations])
  await db.query('delete from auth_verifications where value=any($1::text[]) or value=$2', [users, JSON.stringify({ email: recipient })])
  await db.query('delete from auth_users where id=any($1::text[])', [users])
}

async function emailUrl(db: Client, recipient: string, kind: string, locale: string) {
  await expect.poll(async () => (await ownEmails(db, recipient)).filter((row) => row.email.kind === kind).length).toBeGreaterThan(0)
  const email = (await ownEmails(db, recipient)).find((row) => row.email.kind === kind)!.email
  expect(email.locale).toBe(locale)
  expect(new URL(email.actionUrl).origin).toBe(process.env.PLAYWRIGHT_BASE_URL)
  return email.actionUrl
}

async function session(context: BrowserContext) {
  const result = await context.request.get('/api/auth/get-session')
  expect(result.status()).toBe(200)
  return result.json()
}

async function signIn(page: Page, recipient: string, secret: string) {
  await page.goto('/sign-in')
  await page.getByLabel('Email', { exact: true }).fill(recipient)
  await page.getByLabel(/^(Password|Mot de passe)$/).fill(secret)
  await page.getByRole('button', { name: /^(Sign in|Se connecter)$/ }).click()
}

if (process.env.PLAYWRIGHT_LOCAL_FIXTURE === '1') {
  test('personal account security is available to all five workspace roles', async ({ browser }) => {
    const anonymous = await browser.newContext({ baseURL: process.env.PLAYWRIGHT_BASE_URL })
    try {
      const page = await anonymous.newPage()
      await page.goto('/account')
      await page.waitForURL('**/sign-in?returnTo=*')
      expect(new URL(page.url()).searchParams.get('returnTo')).toBe('/account')
    } finally { await anonymous.close() }
    for (const [index, role] of ['owner', 'admin', 'strategist', 'analyst', 'client'].entries()) {
      const context = await browser.newContext({ baseURL: process.env.PLAYWRIGHT_BASE_URL, storageState: process.env[`PLAYWRIGHT_${role.toUpperCase()}_STORAGE_STATE`], extraHTTPHeaders: { 'x-forwarded-for': `198.51.100.${81 + index}` } })
      try {
        await context.addCookies([{ name: 'yodev_cookie_consent', value: 'rejected', url: process.env.PLAYWRIGHT_BASE_URL! }])
        const page = await context.newPage()
        await page.goto('/account')
        await expect(page.getByRole('heading', { name: 'Sécurité du compte' })).toBeVisible()
        await expect(page.getByRole('button', { name: 'Enregistrer une passkey' })).toBeVisible()
        await expect(page.getByText('Aucune passkey enregistrée.', { exact: true })).toBeVisible()
        await expect(page.getByText(`${role}@local-browser.example.test`, { exact: true })).toBeVisible()
        if (role === 'client') {
          await page.setViewportSize({ width: 390, height: 844 })
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
          await page.screenshot({ path: test.info().outputPath('personal-security-client-mobile.png'), caret: 'initial' })
        }
      } finally { await context.close() }
    }
  })
  for (const [index, locale] of ['fr', 'en'].entries()) {
    test(`auth lifecycle ${locale}: verification, magic link, reset, sessions and passkey`, async ({ browser }) => {
      const connectionString = process.env.DATABASE_SYSTEM_URL!, url = new URL(connectionString)
      if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || !url.pathname.startsWith('/yodev_test')) throw new Error('Disposable database required')
      const db = new Client({ connectionString }), recipient = `auth-flow-${locale}@local-browser.example.test`
      const contexts: BrowserContext[] = []
      const invitationIds = Array.from({ length: 4 }, () => randomUUID())
      await db.connect()
      async function newContext() {
        const context = await browser.newContext({ baseURL: process.env.PLAYWRIGHT_BASE_URL, extraHTTPHeaders: { 'x-forwarded-for': `198.51.100.${61 + index}`, Origin: process.env.PLAYWRIGHT_BASE_URL! } })
        contexts.push(context)
        await context.addCookies([{ name: 'yodev_locale', value: locale, url: process.env.PLAYWRIGHT_BASE_URL! }, { name: 'yodev_cookie_consent', value: 'rejected', url: process.env.PLAYWRIGHT_BASE_URL! }])
        return context
      }
      try {
        await cleanup(db, recipient)
        const original = await newContext(), page = await original.newPage()
        await page.goto('/sign-up')
        await page.getByLabel(/^(Name|Nom)$/).fill(`Local Auth ${locale}`)
        await page.getByLabel('Email', { exact: true }).fill(recipient)
        await page.getByLabel(/^(Password|Mot de passe)$/).fill(password)
        await page.getByRole('button', { name: /^(Create account|Créer mon compte)$/ }).click()
        await expect(page.getByRole('status')).toContainText(locale === 'en' ? 'Check your email' : 'Consultez votre email')
        const user = (await db.query('select id,email_verified from auth_users where email=$1', [recipient])).rows[0]
        expect(user.email_verified).toBe(false)
        expect(await session(original)).toBeNull()
        await signIn(page, recipient, password)
        await expect(page.getByRole('main').getByRole('alert')).toBeVisible()
        expect(await session(original)).toBeNull()
        await page.goto(await emailUrl(db, recipient, 'email_verification', locale))
        expect((await db.query('select email_verified from auth_users where id=$1', [user.id])).rows[0].email_verified).toBe(true)
        await signIn(page, recipient, password)
        await page.waitForURL('**/onboarding')
        await page.getByLabel(/^(Workspace name|Nom de l’espace)$/).fill(`Local lifecycle ${locale}`)
        await page.getByLabel(/^(Identifier|Identifiant)$/).fill(`auth-lifecycle-${locale}`)
        await page.getByRole('button', { name: /^(Create secure workspace|Créer l’espace sécurisé)$/ }).click()
        await page.waitForURL('**/settings')
        const current = await session(original)
        expect(current.user.id).toBe(user.id)
        expect(current.session.activeOrganizationId).toBeTruthy()
        expect((await db.query('select locale from workspaces where auth_owner_user_id=$1', [user.id])).rows[0].locale).toBe(locale)

        const magic = await newContext(), magicPage = await magic.newPage()
        await magicPage.goto('/sign-in')
        await magicPage.getByLabel(/^(Secure sign-in link|Lien de connexion sécurisé)$/).fill(recipient)
        await magicPage.getByRole('button', { name: /^(Email me a sign-in link|Recevoir un lien par email)$/ }).click()
        await expect(magicPage.getByRole('status')).toBeVisible()
        const link = await emailUrl(db, recipient, 'magic_link', locale)
        await magicPage.goto(link)
        await magicPage.waitForURL('**/dashboard')
        expect((await session(magic)).user.id).toBe(user.id)
        const replay = await newContext(), replayPage = await replay.newPage()
        await replayPage.goto(link)
        await expect(replayPage.getByRole('main').getByRole('alert')).toContainText(locale === 'en' ? 'invalid or expired' : 'invalide ou expiré')
        expect(await session(replay)).toBeNull()

        await replayPage.goto('/forgot-password')
        await replayPage.getByLabel('Email', { exact: true }).fill(recipient)
        await replayPage.getByRole('button', { name: /^(Continue|Continuer)$/ }).click()
        await expect(replayPage.getByRole('status')).toBeVisible()
        const resetLink = await emailUrl(db, recipient, 'password_reset', locale)
        await replayPage.goto(resetLink)
        await replayPage.getByLabel(/^(New password|Nouveau mot de passe)$/).fill(newPassword)
        await replayPage.getByRole('button', { name: /^(Continue|Continuer)$/ }).click()
        await expect(replayPage.getByRole('status')).toContainText(locale === 'en' ? 'Password updated' : 'Mot de passe mis à jour')
        expect(await session(original)).toBeNull()
        expect(await session(magic)).toBeNull()
        await replayPage.goto(resetLink)
        await expect(replayPage.getByRole('main').getByRole('alert')).toContainText(locale === 'en' ? 'invalid or expired' : 'invalide ou expiré')
        await signIn(page, recipient, password)
        await expect(page.getByRole('main').getByRole('alert')).toBeVisible()
        expect(await session(original)).toBeNull()
        await signIn(page, recipient, newPassword)
        await page.waitForURL('**/dashboard')
        await signIn(magicPage, recipient, newPassword)
        await magicPage.waitForURL('**/dashboard')
        await page.goto('/account')
        await page.getByRole('button', { name: /^(Revoke other sessions|Révoquer les autres sessions)$/ }).click()
        await expect(page.getByRole('status').filter({ hasText: /Other sessions revoked|Autres sessions révoquées/ })).toBeVisible()
        expect(await session(magic)).toBeNull()
        expect((await session(original)).user.id).toBe(user.id)

        const cdp = await original.newCDPSession(page)
        await cdp.send('WebAuthn.enable')
        const authenticator = await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } })
        await page.getByRole('button', { name: /^(Register a passkey|Enregistrer une passkey)$/ }).click()
        await expect(page.getByRole('status').filter({ hasText: /Passkey registered|Passkey enregistrée/ })).toBeVisible()
        expect((await db.query('select count(*)::int as count from auth_passkeys where user_id=$1', [user.id])).rows[0].count).toBe(1)
        const keyId = (await db.query('select id from auth_passkeys where user_id=$1', [user.id])).rows[0].id
        const foreign = await browser.newContext({ baseURL: process.env.PLAYWRIGHT_BASE_URL, storageState: process.env.PLAYWRIGHT_CLIENT_STORAGE_STATE, extraHTTPHeaders: { Origin: process.env.PLAYWRIGHT_BASE_URL!, 'x-forwarded-for': `198.51.100.${91 + index}` } })
        contexts.push(foreign)
        const foreignKeys = await foreign.request.get('/api/auth/passkey/list-user-passkeys')
        expect(foreignKeys.status()).toBe(200)
        expect((await foreignKeys.json()).some((key: { id: string }) => key.id === keyId)).toBe(false)
        const removal = await foreign.request.post('/api/auth/passkey/delete-passkey', { data: { id: keyId } })
        expect([401, 403, 404]).toContain(removal.status())
        expect((await db.query('select count(*)::int as count from auth_passkeys where id=$1', [keyId])).rows[0].count).toBe(1)

        expect((await original.request.post('/api/auth/sign-out', { data: {} })).status()).toBe(200)
        await page.goto('/sign-in')
        await page.getByRole('button', { name: /^(Use a passkey|Utiliser une passkey)$/ }).click()
        await page.waitForURL('**/dashboard')
        expect((await session(original)).user.id).toBe(user.id)
        await page.goto('/account')
        await page.getByRole('button', { name: /^(Remove|Supprimer) (Ads by Yodev passkey|Passkey Ads by Yodev)$/ }).click()
        await page.getByRole('button', { name: /^(Confirm removal|Confirmer la suppression)$/ }).click()
        await expect(page.getByRole('status').filter({ hasText: /Passkey removed|Passkey supprimée/ })).toBeVisible()
        expect((await db.query('select count(*)::int as count from auth_passkeys where user_id=$1', [user.id])).rows[0].count).toBe(0)
        expect((await original.request.post('/api/auth/sign-out', { data: {} })).status()).toBe(200)
        await page.goto('/sign-in')
        await page.getByRole('button', { name: /^(Use a passkey|Utiliser une passkey)$/ }).click()
        await expect(page.getByRole('main').getByRole('alert')).toBeVisible()
        expect(await session(original)).toBeNull()
        // Restore an authenticated context via an existing verified identity's magic link.
        await page.getByLabel(/^(Secure sign-in link|Lien de connexion sécurisé)$/).fill(recipient)
        await page.getByRole('button', { name: /^(Email me a sign-in link|Recevoir un lien par email)$/ }).click()
        await expect(page.getByRole('status')).toBeVisible()
        await page.goto(await emailUrl(db, recipient, 'magic_link', locale))
        await page.waitForURL('**/dashboard')
        await cdp.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId: authenticator.authenticatorId })
        await cdp.detach()
        await page.screenshot({ path: test.info().outputPath(`auth-lifecycle-${locale}.png`), caret: 'initial' })

        // Invalid invitations never grant membership, even with a valid session.
        const organizationId = 'local-browser-fixture-foreign'
        for (const [n, status, email, expiry] of [
          [0, 'pending', 'unrelated@local-browser.example.test', '1 day'],
          [1, 'pending', recipient, '-1 day'],
          [2, 'canceled', recipient, '1 day'],
          [3, 'pending', recipient, '1 day'],
        ] as const) {
          await db.query("insert into auth_invitations(id,organization_id,email,role,status,expires_at,inviter_id) values($1,$2,$3,'analyst',$4,now()+$5::interval,'local-browser-fixture-foreign-owner')", [invitationIds[n], organizationId, email, status, expiry])
        }
        for (const id of invitationIds.slice(0, 3)) {
          await page.goto(`/invitation?id=${id}`)
          await page.getByRole('button', { name: /^(Accept invitation|Accepter l’invitation)$/ }).click()
          await expect(page.getByRole('main').getByRole('alert')).toBeVisible()
          expect((await db.query('select count(*)::int as count from auth_members where organization_id=$1 and user_id=$2', [organizationId, user.id])).rows[0].count).toBe(0)
        }
        const invited = await newContext(), invitedPage = await invited.newPage()
        await invitedPage.goto(`/invitation?id=${invitationIds[3]}`)
        await invitedPage.getByRole('link', { name: /^(Sign in to continue|Se connecter pour continuer)$/ }).click()
        await invitedPage.waitForURL('**/sign-in?returnTo=*')
        expect(new URL(invitedPage.url()).searchParams.get('returnTo')).toBe(`/invitation?id=${invitationIds[3]}`)
        await invitedPage.getByLabel(/^(Secure sign-in link|Lien de connexion sécurisé)$/).fill(recipient)
        await invitedPage.getByRole('button', { name: /^(Email me a sign-in link|Recevoir un lien par email)$/ }).click()
        await expect(invitedPage.getByRole('status')).toBeVisible()
        const invitationLink = await emailUrl(db, recipient, 'magic_link', locale)
        expect(new URL(invitationLink).searchParams.get('callbackURL')).toBe(`/invitation?id=${invitationIds[3]}`)
        await invitedPage.goto(invitationLink)
        let lostResponses = 0
        await invitedPage.route('**/api/auth/organization/accept-invitation', async (route) => {
          const response = await route.fetch()
          expect(response.status()).toBe(200)
          lostResponses++
          await route.abort('failed')
        })
        await invitedPage.getByRole('button', { name: /^(Accept invitation|Accepter l’invitation)$/ }).click()
        await invitedPage.waitForURL('**/dashboard')
        await invitedPage.unroute('**/api/auth/organization/accept-invitation')
        expect(lostResponses).toBe(1)
        expect((await session(invited)).session.activeOrganizationId).toBe(organizationId)
        expect((await db.query('select role from auth_members where organization_id=$1 and user_id=$2', [organizationId, user.id])).rows[0].role).toBe('analyst')
        expect((await db.query('select status from auth_invitations where id=$1', [invitationIds[3]])).rows[0].status).toBe('accepted')
        await expect(invitedPage.getByRole('combobox', { name: /Workspace actif|Active workspace/ })).toHaveValue(organizationId)
        // A reload/reopened link must recover the acquired membership too.
        await invitedPage.goto(`/invitation?id=${invitationIds[3]}`)
        await invitedPage.getByRole('button', { name: /^(Accept invitation|Accepter l’invitation)$/ }).click()
        await invitedPage.waitForURL('**/dashboard')
        expect((await db.query('select count(*)::int as count from auth_members where organization_id=$1 and user_id=$2', [organizationId, user.id])).rows[0].count).toBe(1)
        // Recovery is not a way to regain a membership that has since been removed.
        await db.query('delete from auth_members where organization_id=$1 and user_id=$2', [organizationId, user.id])
        await invitedPage.goto(`/invitation?id=${invitationIds[3]}`)
        await invitedPage.getByRole('button', { name: /^(Accept invitation|Accepter l’invitation)$/ }).click()
        await expect(invitedPage.getByRole('main').getByRole('alert')).toBeVisible()
        expect((await db.query('select count(*)::int as count from auth_members where organization_id=$1 and user_id=$2', [organizationId, user.id])).rows[0].count).toBe(0)
        await invitedPage.goto('/account')

        await invitedPage.getByRole('button', { name: /^(Sign out|Se déconnecter)$/ }).click()
        await invitedPage.waitForURL('**/sign-in')
        expect(await session(invited)).toBeNull()

      } finally {
        await Promise.allSettled(contexts.map((context) => context.close()))
        await db.query('delete from auth_invitations where id=any($1::text[])', [invitationIds])
        await cleanup(db, recipient)
        await db.end()
      }
    })
  }
}
