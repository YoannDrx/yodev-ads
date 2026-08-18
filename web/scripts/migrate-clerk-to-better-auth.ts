import { randomUUID } from 'node:crypto'
import { neonConfig, Pool } from '@neondatabase/serverless'
import { and, eq, isNull } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/neon-serverless'
import ws from 'ws'
import * as schema from '../src/db/schema'
import {
  auditEvents,
  authMembers,
  authOrganizations,
  authUsers,
  memberNotificationPreferences,
  trialGrants,
  workspaceTasks,
  workspaces,
} from '../src/db/schema'

type ClerkUser = {
  id: string
  first_name: string | null
  last_name: string | null
  image_url: string | null
  primary_email_address_id: string | null
  email_addresses: Array<{ id: string; email_address: string; verification?: { status?: string } | null }>
}

type ClerkMembership = {
  role: string
  public_user_data: { user_id: string | null }
}

type ClerkOrganization = { id: string; name: string; slug: string | null; image_url?: string | null }

const secret = process.env.CLERK_SECRET_KEY
if (!secret) throw new Error('CLERK_SECRET_KEY is required only for this one-time migration')
const databaseUrl = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL
if (!databaseUrl) throw new Error('DATABASE_URL_UNPOOLED or DATABASE_URL is required')
const databaseHost = new URL(databaseUrl).hostname
const apply = process.env.BETTER_AUTH_MIGRATION_APPLY === '1'
if (apply && process.env.BETTER_AUTH_MIGRATION_CONFIRM_HOST !== databaseHost) {
  throw new Error(`Refusing write: BETTER_AUTH_MIGRATION_CONFIRM_HOST must equal ${databaseHost}`)
}

async function clerk<T>(path: string): Promise<T> {
  const response = await fetch(`https://api.clerk.com/v1${path}`, {
    headers: { Authorization: `Bearer ${secret}`, Accept: 'application/json' },
  })
  if (!response.ok) throw new Error(`Clerk export failed (${response.status}) for ${path}`)
  return response.json() as Promise<T>
}

async function clerkOrNull<T>(path: string): Promise<T | null> {
  const response = await fetch(`https://api.clerk.com/v1${path}`, {
    headers: { Authorization: `Bearer ${secret}`, Accept: 'application/json' },
  })
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`Clerk export failed (${response.status}) for ${path}`)
  return response.json() as Promise<T>
}

function verifiedEmail(user: ClerkUser) {
  const primary = user.email_addresses.find((email) => email.id === user.primary_email_address_id)
  const verified = primary?.verification?.status === 'verified'
    ? primary
    : user.email_addresses.find((email) => email.verification?.status === 'verified')
  if (!verified) throw new Error(`Clerk user ${user.id} has no verified email and cannot be migrated`)
  return verified.email_address.trim().toLowerCase()
}

function migratedRole(value: string, owner: boolean) {
  if (owner) return 'owner'
  const role = value.replace(/^org:/, '')
  if (role === 'operator') return 'strategist'
  if (role === 'viewer') return 'client'
  return ['admin', 'strategist', 'analyst', 'client'].includes(role) ? role : 'client'
}

neonConfig.webSocketConstructor = ws
async function main() {
  const pool = new Pool({ connectionString: databaseUrl, max: 1 })
  const db = drizzle(pool, { schema })
  try {
  const legacyWorkspaces = await db.select({
    id: workspaces.id,
    name: workspaces.name,
    slug: workspaces.slug,
    ownerUserId: workspaces.ownerUserId,
    clerkOrganizationId: workspaces.clerkOrganizationId,
  }).from(workspaces).where(and(isNull(workspaces.authOrganizationId), isNull(workspaces.deletedAt)))

  const plans = [] as Array<{
    workspaceId: string
    organization: ClerkOrganization
    members: Array<{ source: ClerkMembership; user: ClerkUser; email: string }>
    ownerCurrentUserId: string
  }>
  let currentOrganizations: ClerkOrganization[] | null = null
  for (const workspace of legacyWorkspaces) {
    if (!workspace.clerkOrganizationId) throw new Error(`Workspace ${workspace.id} has no legacy organization identifier`)
    let organization = await clerkOrNull<ClerkOrganization>(`/organizations/${workspace.clerkOrganizationId}`)
    if (!organization) {
      currentOrganizations ??= (await clerk<{ data: ClerkOrganization[] }>('/organizations?limit=100&offset=0')).data
      const matches = currentOrganizations.filter((candidate) => candidate.slug === workspace.slug)
      if (matches.length !== 1) throw new Error(`Legacy organization ${workspace.clerkOrganizationId} has no unambiguous current slug match for ${workspace.slug}`)
      organization = matches[0]
    }
    const memberships = await clerk<{ data: ClerkMembership[] }>(`/organizations/${organization.id}/memberships?limit=500&offset=0`)
    if (memberships.data.length === 500) throw new Error(`Workspace ${workspace.id} reaches the migration pagination safety limit`)
    const members = await Promise.all(memberships.data.map(async (source) => {
      const userId = source.public_user_data.user_id
      if (!userId) throw new Error(`Organization ${organization.id} contains a membership without user id`)
      const user = await clerk<ClerkUser>(`/users/${userId}`)
      return { source, user, email: verifiedEmail(user) }
    }))
    const directOwner = members.find(({ user }) => user.id === workspace.ownerUserId)
    const owner = directOwner ?? (members.length === 1 ? members[0] : undefined)
    if (!owner) throw new Error(`Legacy owner ${workspace.ownerUserId} has no unambiguous current member match in ${organization.id}`)
    plans.push({ workspaceId: workspace.id, organization, members, ownerCurrentUserId: owner.user.id })
  }

  process.stdout.write(`${apply ? 'Applying' : 'Dry-run'} Better Auth migration for ${plans.length} workspace(s) on ${databaseHost}.\n`)
  if (!apply) {
    for (const plan of plans) process.stdout.write(`- ${plan.workspaceId}: ${plan.members.length} verified member(s)\n`)
  } else {
    await db.transaction(async (tx) => {
      for (const plan of plans) {
        const legacyWorkspace = legacyWorkspaces.find((workspace) => workspace.id === plan.workspaceId)!
        const organizationId = randomUUID()
        await tx.insert(authOrganizations).values({
          id: organizationId,
          name: plan.organization.name,
          slug: `${legacyWorkspace.slug}-${organizationId.slice(0, 8)}`,
          logo: plan.organization.image_url ?? null,
          legacyClerkOrganizationId: legacyWorkspace.clerkOrganizationId,
        })
        const identities = new Map<string, string>()
        for (const member of plan.members) {
          const existing = await tx.query.authUsers.findFirst({ where: eq(authUsers.email, member.email) })
          const authUserId = existing?.id ?? randomUUID()
          if (!existing) {
            await tx.insert(authUsers).values({
              id: authUserId,
              name: [member.user.first_name, member.user.last_name].filter(Boolean).join(' ') || member.email,
              email: member.email,
              emailVerified: true,
              image: member.user.image_url,
              legacyClerkUserId: member.user.id,
            })
          } else if (!existing.legacyClerkUserId) {
            await tx.update(authUsers).set({ legacyClerkUserId: member.user.id, updatedAt: new Date() }).where(eq(authUsers.id, existing.id))
          } else if (existing.legacyClerkUserId !== member.user.id) {
            throw new Error(`Verified email collision for ${member.email}`)
          }
          identities.set(member.user.id, authUserId)
          await tx.insert(authMembers).values({
            id: randomUUID(),
            organizationId,
            userId: authUserId,
            role: migratedRole(member.source.role, member.user.id === plan.ownerCurrentUserId),
          })
        }
        const ownerAuthUserId = identities.get(plan.ownerCurrentUserId)
        if (!ownerAuthUserId) throw new Error(`Owner mapping missing for ${plan.workspaceId}`)
        identities.set(legacyWorkspace.ownerUserId, ownerAuthUserId)
        await tx.update(workspaces).set({
          authOrganizationId: organizationId,
          authOwnerUserId: ownerAuthUserId,
          ownerUserId: ownerAuthUserId,
          updatedAt: new Date(),
        }).where(eq(workspaces.id, plan.workspaceId))
        await tx.update(trialGrants).set({ creatorAuthUserId: ownerAuthUserId })
          .where(eq(trialGrants.creatorClerkUserId, legacyWorkspace.ownerUserId))
        for (const [legacyUserId, authUserId] of identities) {
          await tx.update(memberNotificationPreferences).set({ authUserId })
            .where(and(eq(memberNotificationPreferences.workspaceId, plan.workspaceId), eq(memberNotificationPreferences.authUserId, legacyUserId)))
          await tx.update(workspaceTasks).set({ assignedTo: authUserId })
            .where(and(eq(workspaceTasks.workspaceId, plan.workspaceId), eq(workspaceTasks.assignedTo, legacyUserId)))
        }
        await tx.insert(auditEvents).values({
          workspaceId: plan.workspaceId,
          actorUserId: 'system:better-auth-migration',
          action: 'workspace.identity_migrated',
          entityType: 'auth_organization',
          entityId: organizationId,
          metadata: { provider: 'better-auth', migratedMemberCount: plan.members.length },
        })
      }
    })
    process.stdout.write(`Migrated ${plans.length} workspace(s) to Better Auth.\n`)
  }
  } finally {
    await pool.end()
  }
}

main().catch((error) => {
  process.stderr.write(`Better Auth identity migration failed: ${error instanceof Error ? error.message : 'unknown error'}\n`)
  process.exitCode = 1
})
