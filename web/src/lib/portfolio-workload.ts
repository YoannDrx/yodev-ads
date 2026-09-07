import 'server-only'

import { eq, sql } from 'drizzle-orm'
import { authMembers, authUsers, workspaces } from '@/db/schema'
import { withSystemTransaction, withTenantTransaction } from '@/db/transactions'
import { workspaceLifecycleAllowsPermission } from '@/lib/workspace-access'
import { authRoleToWorkspaceRole } from '@/lib/permissions'

export type PortfolioWorkload = { userId: string | null; name: string | null; open: number; blocked: number; overdue: number; urgent: number; active: number }

/** Workspace-wide workload, including manual tasks without a client and former assignees. */
export async function getPortfolioWorkload(workspaceId: string) {
  const counts = await withTenantTransaction({ workspaceId, userId: 'repository:portfolio-workload' }, async (db) => {
    const workspace = await db.query.workspaces.findFirst({ where: eq(workspaces.id, workspaceId), columns: { accessState: true } })
    if (!workspace || !workspaceLifecycleAllowsPermission(workspace.accessState, 'portfolio:read')) return null
    return (await db.execute<Omit<PortfolioWorkload, 'name'>>(sql`select assigned_to as "userId",count(*)::int as open,
      count(*) filter(where status='blocked')::int as blocked,count(*) filter(where due_at<now())::int as overdue,
      count(*) filter(where priority='urgent')::int as urgent,count(*) filter(where status='in_progress')::int as active
      from workspace_tasks where workspace_id=${workspaceId} and status not in ('done','cancelled') group by assigned_to`)).rows
  })
  if (!counts) return []
  const roster = await withSystemTransaction(async (db) => {
    const workspace = await db.query.workspaces.findFirst({ where: eq(workspaces.id, workspaceId), columns: { authOrganizationId: true, ownerUserId: true } })
    if (!workspace?.authOrganizationId) return []
    const members = await db.select({ userId: authMembers.userId, name: authUsers.name, role: authMembers.role }).from(authMembers)
      .innerJoin(authUsers, eq(authUsers.id, authMembers.userId)).where(eq(authMembers.organizationId, workspace.authOrganizationId))
    return members.filter((member) => authRoleToWorkspaceRole(member.role, member.userId === workspace.ownerUserId) !== 'client')
  })
  const names = new Map(roster.map((member) => [member.userId, member.name]))
  const grouped = new Map<string | null, PortfolioWorkload>(counts.map((row) => [row.userId, { ...row, name: row.userId ? names.get(row.userId) ?? null : null }]))
  for (const member of roster) if (!grouped.has(member.userId)) grouped.set(member.userId, { userId: member.userId, name: member.name, open: 0, blocked: 0, overdue: 0, urgent: 0, active: 0 })
  if (!grouped.has(null)) grouped.set(null, { userId: null, name: null, open: 0, blocked: 0, overdue: 0, urgent: 0, active: 0 })
  return [...grouped.values()].sort((a,b) => b.overdue-a.overdue || b.blocked-a.blocked || b.open-a.open || (a.name ?? a.userId ?? '').localeCompare(b.name ?? b.userId ?? ''))
}
