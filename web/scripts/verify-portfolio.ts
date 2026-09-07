import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import { workspaces, clients, monitoringAgents } from '../src/db/schema'
import { withSystemTransaction } from '../src/db/transactions'
import { getPortfolioSnapshot, type PortfolioAccount } from '../src/lib/portfolio-data'
import { getPortfolioWorkload } from '../src/lib/portfolio-workload'
import { listTaskPage } from '../src/lib/workspace-collections'

const url = new URL(process.env.DATABASE_SYSTEM_URL ?? '')
assert(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && url.pathname.startsWith('/yodev_test'), 'Disposable local database required')
globalThis.fetch = async () => { throw new Error('Provider calls forbidden') }
const workspaceId = '82000000-0000-4000-8000-000000000001', foreignId = '82000000-0000-4000-8000-000000000002'
const cleanup = async () => { for (const id of [workspaceId, foreignId]) await withSystemTransaction((db) => db.delete(workspaces).where(eq(workspaces.id, id))) }
async function main() {
  await cleanup()
  try {
    await withSystemTransaction((db) => db.insert(workspaces).values([workspaceId, foreignId].map((id) => ({ id, ownerUserId: 'portfolio-fixture', name: 'Portfolio fixture', slug: `portfolio-${id}`, accessState: 'internal', plan: 'internal' }))))
    const accounts = Array.from({ length: 50 }, (_, index) => ({ id: randomUUID(), workspaceId, googleCustomerId: String(8200000000 + index), name: `Portfolio ${String(index).padStart(2,'0')}${index === 49 ? ' %_' : ''}`, currencyCode: ['EUR','USD','JPY'][index % 3], timezone: index % 2 ? 'America/New_York' : 'Europe/Paris' }))
    await withSystemTransaction(async (db) => {
      await db.insert(clients).values(accounts)
      await db.insert(clients).values({ workspaceId: foreignId, googleCustomerId: '8299999999', name: 'Foreign' })
      await db.execute(sql`insert into daily_account_metrics(workspace_id,client_id,metric_date,currency_code,timezone,cost_micros,clicks,conversions,conversion_value_micros,coverage_status,source_version,source_observed_at)
        select c.workspace_id,c.id,((now() at time zone c.timezone)::date-days)::text,c.currency_code,c.timezone,'1000000','10','1.2500','2000000','complete','portfolio-fixture',now()
        from clients c cross join generate_series(1,30) days where c.workspace_id=${workspaceId}`)
      await db.execute(sql`insert into client_goals(workspace_id,client_id,primary_kpi,monthly_budget_micros) select workspace_id,id,'cpa','30000000' from clients where workspace_id=${workspaceId}`)
      await db.execute(sql`update daily_account_metrics set cost_micros='0',conversions='0',conversion_value_micros='0' where client_id=${accounts[0].id}`)
      await db.execute(sql`update daily_account_metrics set cost_micros='900719925474099312345',conversion_value_micros='1801439850948198624690' where client_id=${accounts[1].id}`)
      await db.execute(sql`delete from daily_account_metrics where client_id=${accounts[2].id} and metric_date=(select min(metric_date) from daily_account_metrics where client_id=${accounts[2].id})`)
      await db.execute(sql`update daily_account_metrics set currency_code='XXX' where client_id=${accounts[3].id}`)
      await db.execute(sql`update daily_account_metrics set source_observed_at=now()-interval '3 days' where client_id=${accounts[4].id}`)
      await db.execute(sql`update daily_account_metrics set coverage_status='legacy' where client_id=${accounts[5].id}`)
      await db.execute(sql`update daily_account_metrics set source_observed_at=now()+interval '1 day' where client_id=${accounts[6].id}`)
    })
    const [agent] = await withSystemTransaction((db) => db.insert(monitoringAgents).values({ workspaceId, createdBy: 'fixture', name: 'Portfolio monitor', kind: 'budget_guard', description: 'Fixture', threshold: '1' }).returning())
    await withSystemTransaction(async (db) => {
      await db.execute(sql`insert into alert_incidents(workspace_id,client_id,agent_id,fingerprint,title,description,severity,status) select ${workspaceId},${accounts[7].id},${agent.id},'portfolio-'||status,'Fixture','Fixture','critical',status from unnest(array['open','reopened','acknowledged','resolved']) status`)
      await db.execute(sql`insert into workspace_tasks(workspace_id,client_id,created_by,title,description,status,assigned_to,due_at) values(${workspaceId},${accounts[7].id},'fixture','Blocked','Fixture','blocked','member-1',now()-interval '1 day'),(${workspaceId},${accounts[7].id},'fixture','Done','Fixture','done','member-1',now()-interval '1 day'),(${workspaceId},${accounts[8].id},'fixture','Unassigned','Fixture','todo',null,now()+interval '1 day')`)
      await db.execute(sql`insert into approval_requests(workspace_id,client_id,requested_by,kind,title,payload,expires_at,status) select ${workspaceId},${accounts[8].id},'fixture','campaign_status','Pending decision','{}',now()+interval '1 day',status from unnest(array['pending','approved','executed','rejected']) status`)
    })
    const rows: PortfolioAccount[] = []
    const ids = new Set<string>()
    let cursor: string | undefined
    do {
      const snapshot = await getPortfolioSnapshot(workspaceId, { cursor })
      assert(snapshot); assert.equal(snapshot.summary.accounts, 50); assert.equal(snapshot.summary.unqualified, 5)
      assert.equal(snapshot.groups.reduce((sum, group) => sum + group.accounts, 0), 50)
      assert.equal(snapshot.groups.reduce((sum, group) => sum + group.qualified_accounts, 0), 45)
      for (const row of snapshot.page.items) { assert(!ids.has(row.id)); ids.add(row.id); rows.push(row) }
      if (!cursor) {
        assert(snapshot.page.nextCursor)
        assert((await getPortfolioSnapshot(foreignId, { cursor: snapshot.page.nextCursor }))?.page.invalidCursor)
        assert((await getPortfolioSnapshot(workspaceId, { cursor: snapshot.page.nextCursor, currency: 'USD' }))?.page.invalidCursor)
      }
      cursor = snapshot.page.nextCursor ?? undefined
    } while (cursor)
    assert.equal(ids.size, 50)
    const work = rows.find((row) => row.id === accounts[7].id)!
    assert.equal(work.open_alerts, 2); assert.equal(work.critical_alerts, 2); assert.equal(work.blocked_tasks, 1); assert.equal(work.overdue_tasks, 1); assert.equal(work.open_tasks, 1)
    assert.equal(rows.find((row) => row.id === accounts[8].id)?.pending_approvals, 2)
    assert.equal((await getPortfolioSnapshot(workspaceId, { assignee: 'member-1' }))?.summary.accounts, 1)
    assert.equal((await getPortfolioSnapshot(workspaceId, { assignee: 'unassigned' }))?.summary.accounts, 1)
    assert.equal((await getPortfolioSnapshot(workspaceId, { attention: 'critical' }))?.summary.critical_alerts, 2)
    assert.equal((await getPortfolioSnapshot(workspaceId, { attention: 'overdue' }))?.summary.overdue_tasks, 1)
    assert.equal((await getPortfolioSnapshot(workspaceId, { attention: 'pending_approval' }))?.summary.pending_approvals, 2)
    await withSystemTransaction((db) => db.execute(sql`insert into workspace_tasks(workspace_id,created_by,title,description,status,priority) values(${workspaceId},'fixture','Manual','No client','in_progress','urgent')`))
    const workload = await getPortfolioWorkload(workspaceId)
    assert.deepEqual(workload.find((row) => row.userId === 'member-1'), { userId: 'member-1', name: null, open: 1, blocked: 1, overdue: 1, urgent: 0, active: 0 })
    assert.deepEqual(workload.find((row) => row.userId === null), { userId: null, name: null, open: 2, blocked: 0, overdue: 0, urgent: 1, active: 1 })
    const unassigned = await listTaskPage(workspaceId, { status: 'open', assignee: 'unassigned' })
    assert.equal(unassigned.total, 2)

    const zero = rows.find((row) => row.id === accounts[0].id)!, huge = rows.find((row) => row.id === accounts[1].id)!
    assert.equal(zero.cost_micros, '0'); assert.equal(zero.cpa_micros, null); assert.equal(zero.roas, null)
    assert.equal(huge.cost_micros, (BigInt('900719925474099312345') * BigInt(30)).toString()); assert.equal(huge.roas, '2.0000')
    for (const account of accounts.slice(2,7)) {
      const row = rows.find((row) => row.id === account.id)!
      assert.notEqual(row.data_state, 'complete'); assert.equal(row.cost_micros, null); assert(row.needs_action)
    }
    assert.equal((await getPortfolioSnapshot(workspaceId, { q: '%_' }))?.summary.accounts, 1)
    const usd = await getPortfolioSnapshot(workspaceId, { currency: 'USD' })
    assert(usd?.groups.every((group) => group.currency_code === 'USD'))
    assert.equal((await getPortfolioSnapshot(workspaceId, { attention: 'missing_data' }))?.summary.accounts, 5)
    await withSystemTransaction((db) => db.execute(sql`update daily_account_metrics set source_version=' ' where client_id=${accounts[9].id}`))
    const unversioned = await getPortfolioSnapshot(workspaceId, { q: accounts[9].name })
    assert.equal(unversioned?.page.items[0].data_state, 'incomplete')
    assert.equal(unversioned?.page.items[0].cost_micros, null)
    await withSystemTransaction((db) => db.update(workspaces).set({ accessState: 'grace' }).where(eq(workspaces.id, workspaceId)))
    assert.equal((await getPortfolioSnapshot(workspaceId))?.summary.accounts, 50)
    await withSystemTransaction((db) => db.update(workspaces).set({ accessState: 'suspended' }).where(eq(workspaces.id, workspaceId)))
    assert.equal(await getPortfolioSnapshot(workspaceId), null)
    console.log(JSON.stringify({ ok: true, accounts: 50, qualified: 45, verified: ['complete_alert_and_task_workflow_counts', 'assignee_and_action_filters', 'currency_and_timezone_groups', 'exact_large_money', 'zero_distinct_from_missing', 'partial_legacy_currency_stale_future_rejected', 'tenant_and_filter_cursor', 'all_pages', 'literal_search', 'grace_read_suspension_denied'], providerCalls: 0 }))
  } finally { await cleanup() }
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
