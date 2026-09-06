import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { hashPassword } from 'better-auth/crypto'
import { eq, like } from 'drizzle-orm'
import { authAccounts, authRateLimits, authMembers, authOrganizations, authUsers, exportJobs, workspaces } from '../src/db/schema'
import { getAuthDatabase } from '../src/db/auth-database'

const url = new URL(process.env.DATABASE_SYSTEM_URL ?? '')
assert(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && url.pathname.startsWith('/yodev_test'), 'Disposable local database required')
export const fixturePassword = 'Local-browser-fixture-only-2026!'
export const fixtureRoles = ['owner', 'admin', 'strategist', 'analyst', 'client'] as const
export const fixtureWorkspaceId = '80000000-0000-4000-8000-000000000001'
export const foreignWorkspaceId = '80000000-0000-4000-8000-000000000002'
export const foreignExportId = '80000000-0000-4000-8000-000000000003'

async function main() {
  const cleanup = process.argv.includes('--cleanup')
  const password = cleanup ? null : await hashPassword(fixturePassword)
  // Fixture provisioning uses the local database owner, never the runtime system role.
  await getAuthDatabase().transaction(async (db) => {
    // Reset request counters only in this disposable DB; production limits stay unchanged.
    if (!cleanup) await db.delete(authRateLimits)
    await db.delete(workspaces).where(like(workspaces.slug, 'local-browser-fixture-%'))
    await db.delete(authOrganizations).where(like(authOrganizations.slug, 'local-browser-fixture-%'))
    await db.delete(authUsers).where(like(authUsers.id, 'local-browser-fixture-%'))
    if (cleanup) return
    for (const role of [...fixtureRoles, 'foreign-owner']) {
      const userId = `local-browser-fixture-${role}`
      await db.insert(authUsers).values({ id: userId, name: `Fixture ${role}`, email: `${role}@local-browser.example.test`, emailVerified: true })
      await db.insert(authAccounts).values({ id: randomUUID(), accountId: userId, userId, providerId: 'credential', password })
    }
    for (const [workspaceId, suffix, ownerRole] of [[fixtureWorkspaceId, 'main', 'owner'], [foreignWorkspaceId, 'foreign', 'foreign-owner']] as const) {
      const organizationId = `local-browser-fixture-${suffix}`
      await db.insert(authOrganizations).values({ id: organizationId, name: `Browser ${suffix}`, slug: organizationId })
      await db.insert(workspaces).values({ id: workspaceId, authOrganizationId: organizationId, authOwnerUserId: `local-browser-fixture-${ownerRole}`, ownerUserId: `local-browser-fixture-${ownerRole}`, name: `Browser ${suffix}`, slug: organizationId, accessState: 'internal', plan: 'internal' })
      const roles = suffix === 'main' ? fixtureRoles : ['foreign-owner']
      for (const role of roles) await db.insert(authMembers).values({ id: randomUUID(), organizationId, userId: `local-browser-fixture-${role}`, role: role === 'foreign-owner' ? 'owner' : role })
    }
    await db.insert(exportJobs).values({ id: foreignExportId, workspaceId: foreignWorkspaceId, requestedBy: 'local-browser-fixture-foreign-owner' })
    // A second membership also makes the small-screen workspace selector testable.
    await db.insert(authMembers).values({ id: randomUUID(), organizationId: 'local-browser-fixture-foreign', userId: 'local-browser-fixture-owner', role: 'client' })
    // Ensure the first organization is deterministically selected at sign-in.
    await db.update(authMembers).set({ createdAt: new Date('2020-01-01') }).where(eq(authMembers.organizationId, 'local-browser-fixture-main'))
  })
  console.log(JSON.stringify(cleanup ? { ok: true, cleaned: 'local-browser-fixtures' } : { ok: true, fixtureRoles, foreignExportId }))
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
