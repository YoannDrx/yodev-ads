import 'server-only'

import { drizzleAdapter } from '@better-auth/drizzle-adapter'
import { passkey } from '@better-auth/passkey'
import { and, eq, gt, sql } from 'drizzle-orm'
import { betterAuth } from 'better-auth'
import { APIError } from 'better-auth/api'
import { nextCookies } from 'better-auth/next-js'
import { magicLink, organization } from 'better-auth/plugins'
import { getAuthDatabase } from '@/db/auth-database'
import * as schema from '@/db/schema'
import { authInvitations, authMembers } from '@/db/schema'
import { authOrganizationAccess, authOrganizationRoles } from '@/lib/auth-access-control'
import { sendAuthEmail } from '@/lib/auth-emails'

type AdsAuth = ReturnType<typeof createAuth>
let singleton: AdsAuth | undefined

function appUrl() {
  return (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000').replace(/\/$/, '')
}

function trustedOrigins() {
  const configured = (process.env.BETTER_AUTH_TRUSTED_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
  return Array.from(new Set([appUrl(), ...configured]))
}

function allowedEmails() {
  return new Set((process.env.BETTER_AUTH_ALLOWED_EMAILS ?? '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean))
}

async function mayCreateUser(email: string) {
  if (process.env.PUBLIC_BETA_ENABLED === '1') return true
  const normalizedEmail = email.trim().toLowerCase()
  if (normalizedEmail === process.env.AUTH_BOOTSTRAP_EMAIL?.trim().toLowerCase()) return true
  if (allowedEmails().has(normalizedEmail)) return true
  const invitation = await getAuthDatabase()
    .select({ id: authInvitations.id })
    .from(authInvitations)
    .where(and(
      sql`lower(${authInvitations.email}) = ${normalizedEmail}`,
      eq(authInvitations.status, 'pending'),
      gt(authInvitations.expiresAt, new Date()),
    ))
    .limit(1)
  return invitation.length === 1
}

async function initialOrganizationId(userId: string) {
  const [membership] = await getAuthDatabase()
    .select({ organizationId: authMembers.organizationId })
    .from(authMembers)
    .where(eq(authMembers.userId, userId))
    .orderBy(
      sql`public.auth_workspace_access_priority(${userId}, ${authMembers.organizationId})`,
      authMembers.createdAt,
    )
    .limit(1)
  return membership?.organizationId ?? null
}

async function workspaceMemberLimit(user: { id: string }, organization: { id: string }) {
  const [membership] = await getAuthDatabase()
    .select({
      limit: sql<number>`public.auth_workspace_membership_limit(${user.id}, ${organization.id})`,
    })
    .from(authMembers)
    .where(and(
      eq(authMembers.userId, user.id),
      eq(authMembers.organizationId, organization.id),
    ))
    .limit(1)
  return Number(membership?.limit ?? 1)
}

function createAuth() {
  const secret = process.env.BETTER_AUTH_SECRET
  if (!secret || secret.length < 32) throw new Error('BETTER_AUTH_SECRET must contain at least 32 characters')
  const baseURL = appUrl()
  const hostname = new URL(baseURL).hostname
  const emailPasswordEnabled = process.env.BETTER_AUTH_EMAIL_PASSWORD_ENABLED !== '0'
  const googleConfigured = Boolean(process.env.BETTER_AUTH_GOOGLE_CLIENT_ID && process.env.BETTER_AUTH_GOOGLE_CLIENT_SECRET)

  return betterAuth({
    appName: 'Ads by Yodev',
    baseURL,
    secret,
    database: drizzleAdapter(getAuthDatabase(), {
      provider: 'pg',
      schema,
      usePlural: false,
    }),
    user: { modelName: 'authUsers' },
    session: {
      modelName: 'authSessions',
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
      freshAge: 60 * 60 * 24,
    },
    account: {
      modelName: 'authAccounts',
      encryptOAuthTokens: true,
      accountLinking: {
        enabled: true,
        disableImplicitLinking: false,
        allowDifferentEmails: false,
        allowUnlinkingAll: false,
      },
    },
    verification: { modelName: 'authVerifications', storeIdentifier: 'hashed' },
    socialProviders: googleConfigured ? {
      google: {
        clientId: process.env.BETTER_AUTH_GOOGLE_CLIENT_ID!,
        clientSecret: process.env.BETTER_AUTH_GOOGLE_CLIENT_SECRET!,
        prompt: 'select_account',
      },
    } : {},
    emailAndPassword: {
      enabled: emailPasswordEnabled,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      requireEmailVerification: true,
      resetPasswordTokenExpiresIn: 60 * 15,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => {
        await sendAuthEmail({ to: user.email, actionUrl: url, kind: 'password_reset' })
      },
    },
    emailVerification: {
      expiresIn: 60 * 15,
      sendOnSignUp: emailPasswordEnabled,
      sendOnSignIn: emailPasswordEnabled,
      autoSignInAfterVerification: false,
      sendVerificationEmail: async ({ user, url }) => {
        await sendAuthEmail({ to: user.email, actionUrl: url, kind: 'email_verification' })
      },
    },
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            if (!(await mayCreateUser(user.email))) {
              throw new APIError('FORBIDDEN', {
                message: 'La bêta Ads by Yodev est actuellement accessible sur invitation.',
              })
            }
          },
        },
      },
      session: {
        create: {
          before: async (session) => ({
            data: { ...session, activeOrganizationId: await initialOrganizationId(session.userId) },
          }),
        },
      },
    },
    rateLimit: {
      enabled: true,
      storage: 'database',
      modelName: 'authRateLimits',
      window: 60,
      max: 100,
      customRules: {
        '/sign-in/email': { window: 60 * 15, max: 5 },
        '/sign-up/email': { window: 60 * 15, max: 5 },
        '/forget-password': { window: 60 * 15, max: 5 },
        '/request-password-reset': { window: 60 * 15, max: 5 },
        '/sign-in/social': { window: 60 * 60, max: 10 },
      },
    },
    trustedOrigins: trustedOrigins(),
    advanced: {
      cookiePrefix: 'yodev_ads',
      crossSubDomainCookies: { enabled: false },
      useSecureCookies: baseURL.startsWith('https://'),
      defaultCookieAttributes: {
        httpOnly: true,
        sameSite: 'lax',
        secure: baseURL.startsWith('https://'),
        path: '/',
      },
    },
    plugins: [
      magicLink({
        expiresIn: 60 * 15,
        disableSignUp: true,
        storeToken: 'hashed',
        sendMagicLink: async ({ email, url }) => {
          await sendAuthEmail({ to: email, actionUrl: url, kind: 'magic_link' })
        },
      }),
      organization({
        ac: authOrganizationAccess,
        roles: authOrganizationRoles,
        allowUserToCreateOrganization: false,
        disableOrganizationDeletion: true,
        creatorRole: 'owner',
        membershipLimit: workspaceMemberLimit,
        requireEmailVerificationOnInvitation: true,
        schema: {
          organization: { modelName: 'authOrganizations' },
          member: { modelName: 'authMembers' },
          invitation: { modelName: 'authInvitations' },
          session: { fields: { activeOrganizationId: 'activeOrganizationId' } },
        },
        sendInvitationEmail: async ({ email, id, organization: invitedOrganization }) => {
          await sendAuthEmail({
            to: email,
            actionUrl: `${baseURL}/invitation?id=${encodeURIComponent(id)}`,
            kind: 'organization_invitation',
            organizationName: invitedOrganization.name,
            idempotencyKey: `auth:invitation:${id}`,
          })
        },
      }),
      passkey({
        rpName: 'Ads by Yodev',
        rpID: hostname,
        origin: baseURL,
        schema: { passkey: { modelName: 'authPasskeys' } },
        registration: { requireSession: true },
      }),
      nextCookies(),
    ],
  })
}

export function getAuth() {
  return singleton ??= createAuth()
}

export type AdsAuthSession = Awaited<ReturnType<AdsAuth['api']['getSession']>>
