import 'dotenv/config'

import { auditEvents, clients, workspaces } from '../src/db/schema'
import { withSystemTransaction } from '../src/db/transactions'

const fixtures = [
  {
    id: '10000000-0000-4000-8000-000000000001',
    ownerUserId: 'user_rls_tenant_a',
    name: 'RLS tenant A',
    slug: 'rls-tenant-a',
    customerId: '1000000001',
  },
  {
    id: '20000000-0000-4000-8000-000000000002',
    ownerUserId: 'user_rls_tenant_b',
    name: 'RLS tenant B',
    slug: 'rls-tenant-b',
    customerId: '2000000002',
  },
] as const

async function main() {
  await withSystemTransaction(async (db) => {
    for (const fixture of fixtures) {
      await db.insert(workspaces).values({
        id: fixture.id,
        ownerUserId: fixture.ownerUserId,
        name: fixture.name,
        slug: fixture.slug,
        plan: 'internal',
        accessState: 'internal',
      }).onConflictDoUpdate({
        target: workspaces.id,
        set: {
          clerkOrganizationId: null,
          name: fixture.name,
          slug: fixture.slug,
          plan: 'internal',
          accessState: 'internal',
          updatedAt: new Date(),
        },
      })

      const [client] = await db.insert(clients).values({
        workspaceId: fixture.id,
        googleCustomerId: fixture.customerId,
        name: `${fixture.name} client`,
      }).onConflictDoNothing().returning({ id: clients.id })

      await db.insert(auditEvents).values({
        workspaceId: fixture.id,
        actorUserId: fixture.ownerUserId,
        action: 'rls.verification.seeded',
        entityType: 'workspace',
        entityId: fixture.id,
        metadata: { clientId: client?.id ?? null },
      })
    }
  })

  console.log(JSON.stringify({ seededWorkspaces: fixtures.map((fixture) => fixture.id) }))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
