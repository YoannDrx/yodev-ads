import 'server-only'

import { randomUUID } from 'node:crypto'
import { and, eq, sql } from 'drizzle-orm'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import {
  authMembers,
  authOrganizations,
  authSessions,
  authUsers,
  trialGrants,
  workspaces,
} from '@/db/schema'
import { withSystemTransaction } from '@/db/transactions'
import { getAuth } from '@/lib/auth'
import { authUser } from '@/lib/auth-identities'
import { entitlementContext, isPlan, isWorkspaceAccessState } from '@/lib/entitlements'
import { getLocale } from '@/lib/locale'
import { authRoleToWorkspaceRole, requirePermission, type Permission } from '@/lib/permissions'
import { workspaceLifecycleAllowsPermission } from '@/lib/workspace-access'

export async function currentAuthSession() {
  let value: Awaited<ReturnType<ReturnType<typeof getAuth>['api']['getSession']>>
  try {
    value = await getAuth().api.getSession({ headers: await headers() })
  } catch {
    console.error(JSON.stringify({ level: 'error', message: 'auth.session.unavailable' }))
    return null
  }
  if (!value) return null
  return {
    id: value.session.id,
    userId: value.user.id,
    activeOrganizationId: value.session.activeOrganizationId ?? null,
    user: value.user,
  }
}

export async function requireAuthSession() {
  const session = await currentAuthSession()
  if (!session) redirect('/sign-in')
  return session
}

export async function requireWorkspace() {
  const authSession = await requireAuthSession()
  if (!authSession.activeOrganizationId) redirect('/onboarding')
  const userId = authSession.userId
  const organizationId = authSession.activeOrganizationId

  const result = await withSystemTransaction(async (db) => {
    const workspace = await db.query.workspaces.findFirst({
      where: eq(workspaces.authOrganizationId, organizationId),
    })
    const membership = await db.query.authMembers.findFirst({
      where: and(eq(authMembers.organizationId, organizationId), eq(authMembers.userId, userId)),
    })
    return { workspace, membership }
  })
  if (!result.membership || !result.workspace) redirect('/onboarding')
  let workspace = result.workspace

  if (workspace.accessState === 'trial' && workspace.trialEndsAt && workspace.trialEndsAt <= new Date()) {
    const [suspended] = await withSystemTransaction((db) => db
      .update(workspaces)
      .set({ accessState: 'suspended', updatedAt: new Date() })
      .where(and(eq(workspaces.id, workspace.id), eq(workspaces.accessState, 'trial')))
      .returning())
    if (suspended) workspace = suspended
  }

  const role = authRoleToWorkspaceRole(result.membership.role, workspace.ownerUserId === userId)
  const state = isWorkspaceAccessState(workspace.accessState) ? workspace.accessState : 'suspended'
  const plan = isPlan(workspace.plan) ? workspace.plan : 'trial'

  return {
    session: { userId, authSessionId: authSession.id, user: authSession.user },
    workspace,
    role,
    entitlements: entitlementContext(state, plan),
    isAdmin: role === 'owner' || role === 'admin',
  }
}

export async function createInitialWorkspace(input: { name: string; slug: string }) {
  const session = await requireAuthSession()
  const locale = await getLocale()
  const name = input.name.trim()
  const slug = normalizeWorkspaceSlug(input.slug || name)
  if (name.length < 2 || name.length > 120) throw new Error('Le nom doit contenir entre 2 et 120 caractères.')
  if (!slug) throw new Error('Identifiant d’espace invalide.')

  return withSystemTransaction(async (db) => {
    await db.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`onboarding:${session.userId}`}, 0))`)
    const user = await db.query.authUsers.findFirst({ where: eq(authUsers.id, session.userId) })
    if (!user) throw new Error('Compte Better Auth introuvable.')
    if (!user.emailVerified) throw new Error('Veuillez vérifier votre adresse email avant de créer un espace.')
    const existingMembership = await db.query.authMembers.findFirst({ where: eq(authMembers.userId, session.userId) })
    if (existingMembership) {
      await db.update(authSessions).set({ activeOrganizationId: existingMembership.organizationId, updatedAt: new Date() })
        .where(eq(authSessions.id, session.id))
      return { created: false, organizationId: existingMembership.organizationId }
    }
    const existingTrial = await db.query.trialGrants.findFirst({ where: eq(trialGrants.creatorAuthUserId, session.userId) })
    const organizationId = randomUUID()
    const workspaceId = randomUUID()
    const membershipId = randomUUID()
    const now = new Date()
    const organizationSlug = `${slug}-${organizationId.slice(0, 8)}`
    await db.insert(authOrganizations).values({ id: organizationId, name, slug: organizationSlug, createdAt: now })
    await db.insert(authMembers).values({
      id: membershipId,
      organizationId,
      userId: session.userId,
      role: 'owner',
      createdAt: now,
    })
    const trialAllowed = !existingTrial
    await db.insert(workspaces).values({
      id: workspaceId,
      authOrganizationId: organizationId,
      authOwnerUserId: session.userId,
      ownerUserId: session.userId,
      name,
      slug: organizationSlug,
      locale,
      plan: 'trial',
      accessState: trialAllowed ? 'trial' : 'suspended',
      trialStartedAt: trialAllowed ? now : null,
      trialEndsAt: trialAllowed ? new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000) : null,
    })
    if (trialAllowed) {
      await db.insert(trialGrants).values({ creatorAuthUserId: session.userId, workspaceId })
    }
    await db.update(authSessions).set({ activeOrganizationId: organizationId, updatedAt: now })
      .where(eq(authSessions.id, session.id))
    return { created: true, organizationId }
  })
}

export async function verifiedAuthUser(userId: string) {
  return authUser(userId)
}

export async function hasVerifiedAuthIdentity(userId: string) {
  const user = await verifiedAuthUser(userId)
  return Boolean(user?.emailVerified && user.email)
}

export async function requireAdminWorkspace() {
  const context = await requireWorkspace()
  if (!workspaceLifecycleAllowsPermission(context.workspace.accessState, 'workspace:admin')) {
    throw new Error('Workspace access state does not allow administration')
  }
  requirePermission(context.role, 'workspace:admin')
  return context
}

export async function requireWorkspacePermission(permission: Permission) {
  const context = await requireWorkspace()
  if (!workspaceLifecycleAllowsPermission(context.workspace.accessState, permission)) {
    const error = new Error(`Workspace access state does not allow: ${permission}`)
    error.name = 'WorkspaceAccessRestrictedError'
    throw error
  }
  requirePermission(context.role, permission)
  return context
}

function normalizeWorkspaceSlug(value: string) {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
}
