import 'server-only'

import { randomUUID } from 'node:crypto'
import { and, count, desc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { auditEvents, portfolioViews, workspaces } from '@/db/schema'
import { withTenantTransaction } from '@/db/transactions'
import { portfolioCriteriaSchema } from '@/lib/portfolio-query'
import { lockWorkspaceEntitlements } from '@/lib/workspace-transaction-guard'
import { workspaceLifecycleAllowsPermission } from '@/lib/workspace-access'

export const MAX_PORTFOLIO_VIEWS = 20
const actorSchema = z.object({ workspaceId: z.string().uuid(), actorUserId: z.string().min(1).max(64) })
const writeSchema = actorSchema.extend({ id: z.string().uuid().optional(), version: z.string().uuid().optional(), name: z.string().trim().min(1).max(80), criteria: portfolioCriteriaSchema })
  .refine((value) => Boolean(value.id) === Boolean(value.version), 'Version and ID must be supplied together')

export function listPortfolioViews(workspaceId: string, actorUserId: string) {
  actorSchema.parse({ workspaceId, actorUserId })
  return withTenantTransaction({ workspaceId, userId: actorUserId }, async (db) => {
    const workspace = await db.query.workspaces.findFirst({ where: eq(workspaces.id, workspaceId), columns: { accessState: true } })
    if (!workspace || !workspaceLifecycleAllowsPermission(workspace.accessState, 'portfolio:read')) return []
    return db.select().from(portfolioViews).where(and(eq(portfolioViews.workspaceId, workspaceId), eq(portfolioViews.userId, actorUserId))).orderBy(desc(portfolioViews.createdAt), desc(portfolioViews.id))
  })
}

export async function savePortfolioView(raw: z.input<typeof writeSchema>) {
  const input = writeSchema.parse(raw)
  return withTenantTransaction({ workspaceId: input.workspaceId, userId: input.actorUserId }, async (db) => {
    const context = await lockWorkspaceEntitlements(db, input.workspaceId)
    if (!workspaceLifecycleAllowsPermission(context.state, 'portfolio:save_view')) throw new Error('Portfolio views unavailable')
    let row
    if (input.id) {
      ;[row] = await db.update(portfolioViews).set({ name: input.name, criteria: input.criteria, version: randomUUID(), updatedAt: new Date() })
        .where(and(eq(portfolioViews.workspaceId, input.workspaceId), eq(portfolioViews.userId, input.actorUserId), eq(portfolioViews.id, input.id), eq(portfolioViews.version, input.version!))).returning()
      if (!row) throw new Error('Portfolio view conflict')
    } else {
      const [{ total }] = await db.select({ total: count() }).from(portfolioViews).where(and(eq(portfolioViews.workspaceId, input.workspaceId), eq(portfolioViews.userId, input.actorUserId)))
      if (total >= MAX_PORTFOLIO_VIEWS) throw new Error('Portfolio view quota')
      ;[row] = await db.insert(portfolioViews).values({ workspaceId: input.workspaceId, userId: input.actorUserId, name: input.name, criteria: input.criteria }).returning()
    }
    await db.insert(auditEvents).values({ workspaceId: input.workspaceId, actorUserId: input.actorUserId, action: input.id ? 'portfolio.view_updated' : 'portfolio.view_created', entityType: 'portfolio_view', entityId: row.id, metadata: { version: row.version } })
    return row
  })
}

export async function deletePortfolioView(raw: z.input<typeof actorSchema> & { id: string; version: string }) {
  const input = actorSchema.extend({ id: z.string().uuid(), version: z.string().uuid() }).parse(raw)
  return withTenantTransaction({ workspaceId: input.workspaceId, userId: input.actorUserId }, async (db) => {
    const context = await lockWorkspaceEntitlements(db, input.workspaceId)
    if (!workspaceLifecycleAllowsPermission(context.state, 'portfolio:save_view')) throw new Error('Portfolio views unavailable')
    const [row] = await db.delete(portfolioViews).where(and(eq(portfolioViews.workspaceId, input.workspaceId), eq(portfolioViews.userId, input.actorUserId), eq(portfolioViews.id, input.id), eq(portfolioViews.version, input.version))).returning({ id: portfolioViews.id })
    if (!row) throw new Error('Portfolio view conflict')
    await db.insert(auditEvents).values({ workspaceId: input.workspaceId, actorUserId: input.actorUserId, action: 'portfolio.view_deleted', entityType: 'portfolio_view', entityId: row.id })
  })
}
