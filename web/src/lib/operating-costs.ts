import 'server-only'

import { and, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { auditEvents, authMembers, operatingCostEntries, workspaces } from '@/db/schema'
import { withSystemTransaction, type DatabaseTransaction } from '@/db/transactions'
import { authRoleToWorkspaceRole, permissionsForRole } from '@/lib/permissions'
import { costEntrySchema, costMonthSchema, decimalToUnits, summarizeOperatingCosts, type CostEntry } from '@/lib/operating-cost-model'
import { GOOGLE_READ_JOB_TYPES } from '@/lib/jobs'

const actorSchema = z.object({ operatorWorkspaceId: z.uuid(), actorUserId: z.string().min(1).max(64) })
type Operator = z.infer<typeof actorSchema>
export class OperatingCostConflict extends Error {}
export class OperatingCostAccessDenied extends Error { constructor() { super('Accès opérateur requis.') } }

async function lockOperator(db: DatabaseTransaction, input: Operator) {
  await db.execute(sql`select pg_advisory_xact_lock(hashtext(${`${input.operatorWorkspaceId}:workspace-access`}))`)
  const [actor] = await db.select({ state: workspaces.accessState, owner: workspaces.ownerUserId, role: authMembers.role })
    .from(workspaces).innerJoin(authMembers, and(eq(authMembers.organizationId, workspaces.authOrganizationId), eq(authMembers.userId, input.actorUserId)))
    .where(eq(workspaces.id, input.operatorWorkspaceId)).for('share', { of: [workspaces, authMembers] })
  if (!actor || actor.state !== 'internal' || !permissionsForRole(authRoleToWorkspaceRole(actor.role, actor.owner === input.actorUserId)).has('workspace:admin')) throw new OperatingCostAccessDenied()
}

export async function saveOperatingCost(input: Operator & { entry: unknown }) {
  const actor = actorSchema.parse(input), parsed = costEntrySchema.parse(input.entry)
  if (parsed.month > new Date().toISOString().slice(0, 7)) throw new Error('La période doit être commencée.')
  const { amount, expectedVersion, ...data } = parsed
  const values = { ...data, amountMicros: amount ? decimalToUnits(amount).toString() : null, supportMinutes: data.supportMinutes || null }
  return withSystemTransaction(async (db) => {
    await lockOperator(db, actor)
    // One stable opaque source reference across retries, corrections and months.
    await db.execute(sql`select pg_advisory_xact_lock(hashtext(${`operating-cost:${values.sourceKey}`}))`)
    const [current] = await db.select().from(operatingCostEntries).where(eq(operatingCostEntries.sourceKey, values.sourceKey)).for('update')
    const sameValues = current && Object.entries(values).every(([key, value]) => {
      const previous = current[key as keyof typeof current]
      if (key === 'supportMinutes' && previous !== null && value !== null) return decimalToUnits(String(previous), 2) === decimalToUnits(String(value), 2)
      return previous === value
    })
    if (sameValues && (expectedVersion === current.version || expectedVersion === current.version - 1)) return { id: current.id, version: current.version, changed: false }
    if (expectedVersion !== (current?.version ?? 0)) throw new OperatingCostConflict('Cette référence a été modifiée. Rechargez sa version courante.')
    const [saved] = current
      ? await db.update(operatingCostEntries).set({ ...values, updatedBy: actor.actorUserId, version: current.version + 1, updatedAt: new Date() }).where(eq(operatingCostEntries.id, current.id)).returning()
      : await db.insert(operatingCostEntries).values({ ...values, updatedBy: actor.actorUserId }).returning()
    const evidence = (entry: typeof saved | undefined) => entry ? { ...entry, createdAt: entry.createdAt.toISOString(), updatedAt: entry.updatedAt.toISOString() } : null
    await db.insert(auditEvents).values({ workspaceId: actor.operatorWorkspaceId, actorUserId: actor.actorUserId, action: 'operations.cost_recorded', entityType: 'operating_cost_entry', entityId: saved.id, metadata: { before: evidence(current), after: evidence(saved) } })
    return { id: saved.id, version: saved.version, changed: true }
  })
}

export async function getOperatingCostSnapshot(input: Operator & { month: string; after?: string }) {
  const actor = actorSchema.parse(input), month = costMonthSchema.parse(input.month)
  const after = z.string().max(100).parse(input.after ?? '')
  return withSystemTransaction(async (db) => {
    await lockOperator(db, actor)
    const entries = await db.select().from(operatingCostEntries).where(eq(operatingCostEntries.month, month)).orderBy(sql`${operatingCostEntries.sourceKey} collate "C"`).limit(10001)
    if (entries.length > 10000) throw new Error('Plus de 10 000 références sur cette période : consolidation du registre requise. Aucun total partiel affiché.')
    const from = `${month}-01T00:00:00.000Z`
    const through = new Date(from); through.setUTCMonth(through.getUTCMonth() + 1)
    const usage = await db.execute<{ plan: string; attempts: number; googleReadAttempts: number; finishedAttempts: number; elapsedMs: string | null }>(sql`
      select coalesce(a.billing_plan_at_start,'unknown') as plan, count(*)::int as attempts,
        count(*) filter (where j.type in (${sql.join(GOOGLE_READ_JOB_TYPES.map((type) => sql`${type}`), sql`, `)}))::int as "googleReadAttempts",
        count(*) filter (where a.finished_at >= a.started_at and a.finished_at <= clock_timestamp())::int as "finishedAttempts",
        sum(case when a.finished_at >= a.started_at and a.finished_at <= clock_timestamp() then extract(epoch from (a.finished_at-a.started_at))*1000 else null end)::text as "elapsedMs"
      from job_attempts a join jobs j on j.id=a.job_id
      where a.started_at >= ${from}::timestamptz and a.started_at < ${through.toISOString()}::timestamptz and a.started_at <= clock_timestamp()
      group by a.billing_plan_at_start order by plan`)
    const remaining = entries.filter((entry) => entry.sourceKey > after), page = remaining.slice(0, 25)
    return { month, asOf: new Date().toISOString(), totalReferences: entries.length, activeReferences: entries.filter((entry) => !entry.voided).length, entries: page as (typeof entries[number] & CostEntry)[], next: remaining.length > 25 ? page.at(-1)!.sourceKey : null, cells: summarizeOperatingCosts(entries as CostEntry[]), usage: usage.rows }
  })
}
