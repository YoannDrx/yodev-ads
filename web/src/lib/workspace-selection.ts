import 'server-only'

import { and, asc, eq, gt, ne, sql } from 'drizzle-orm'
import { authMembers, authSessions, workspaces } from '@/db/schema'
import { withSystemTransaction } from '@/db/transactions'

// Repair selection only at the onboarding boundary. A request that lost its
// tenant must redirect before any tenant operation can execute.
export async function resolveWorkspaceSelection(input: { sessionId: string; userId: string }) {
  return withSystemTransaction(async (db) => {
    const [session] = await db.select({ activeOrganizationId: authSessions.activeOrganizationId })
      .from(authSessions)
      .where(and(eq(authSessions.id, input.sessionId), eq(authSessions.userId, input.userId), gt(authSessions.expiresAt, new Date())))
      .for('update')
    if (!session) return null

    const [selection] = await db.select({ organizationId: authMembers.organizationId })
      .from(authMembers)
      .innerJoin(workspaces, eq(workspaces.authOrganizationId, authMembers.organizationId))
      .where(and(eq(authMembers.userId, input.userId), ne(workspaces.accessState, 'deleted')))
      .orderBy(
        sql`case when ${authMembers.organizationId} = ${session.activeOrganizationId} then 0 else 1 end`,
        sql`case when ${workspaces.accessState} in ('active', 'internal', 'trial') then 0 when ${workspaces.accessState} = 'grace' then 1 else 2 end`,
        asc(authMembers.createdAt), asc(authMembers.id),
      ).limit(1)
    const organizationId = selection?.organizationId ?? null
    if (organizationId !== session.activeOrganizationId) {
      await db.update(authSessions).set({ activeOrganizationId: organizationId, updatedAt: new Date() })
        .where(and(eq(authSessions.id, input.sessionId), eq(authSessions.userId, input.userId)))
    }
    return organizationId
  })
}
