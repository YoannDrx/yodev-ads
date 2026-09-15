import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { setTimeout } from 'node:timers/promises'
import { Client } from 'pg'
import { sql } from 'drizzle-orm'
import { withSystemTransaction, withTenantTransaction } from '../src/db/transactions'
import { getOperatingCostSnapshot, saveOperatingCost } from '../src/lib/operating-costs'

const url = new URL(process.env.DATABASE_SYSTEM_URL ?? '')
assert(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && url.pathname.startsWith('/yodev_test'), 'Disposable local database required')
globalThis.fetch = async () => { throw new Error('Provider calls forbidden') }
const db = new Client({ connectionString: url.href }), blocker = new Client({ connectionString: url.href })
const [workspaceId, commercialId, org, commercialOrg, owner, actor, jobId, globalJobId] = Array.from({ length: 8 }, () => randomUUID())
const month = new Date().toISOString().slice(0, 7), sourceKey = `test-cost-${randomUUID()}`
const operator = { operatorWorkspaceId: workspaceId, actorUserId: actor }
const entry = { sourceKey, month, category: 'functions', currency: 'EUR', basis: 'documented', amount: '12.000001', supportMinutes: '', allocationMethod: 'usage', trialWeight: 0, soloWeight: 50, studioWeight: 50, agencyWeight: 0, internalWeight: 0, unallocatedWeight: 0, expectedVersion: 0, voided: 'false' }
function code(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined
  if ('code' in error && typeof error.code === 'string') return error.code
  return 'cause' in error ? code(error.cause) : undefined
}
async function main() {
  await db.connect(); await blocker.connect()
  try {
    for (const user of [owner, actor]) await db.query('insert into auth_users(id,name,email,email_verified) values($1,$1,$2,true)', [user, `cost-${user}@example.test`])
    for (const organization of [org, commercialOrg]) await db.query('insert into auth_organizations(id,name,slug) values($1::text,$1::text,$1::text)', [organization])
    for (const [id, organization, state, plan] of [[workspaceId, org, 'internal', 'internal'], [commercialId, commercialOrg, 'active', 'agency']]) await db.query('insert into workspaces(id,name,slug,auth_organization_id,owner_user_id,auth_owner_user_id,plan,access_state) values($1,$2::text,$2::text,$2::text,$3::text,$3::text,$4,$5)', [id, organization, owner, plan, state])
    await db.query("insert into auth_members(id,organization_id,user_id,role) values($1,$2,$3,'admin'),($4,$5,$3,'admin')", [randomUUID(), org, actor, randomUUID(), commercialOrg])
    const baseline = await getOperatingCostSnapshot({ ...operator, month })
    const race = await Promise.all([saveOperatingCost({ ...operator, entry }), saveOperatingCost({ ...operator, entry })])
    assert.equal(race.filter((result) => result.changed).length, 1); assert.equal(race[0].id, race[1].id)
    const conflict = await Promise.allSettled([saveOperatingCost({ ...operator, entry: { ...entry, amount: '14', expectedVersion: 1 } }), saveOperatingCost({ ...operator, entry: { ...entry, amount: '16', expectedVersion: 1 } })])
    assert.equal(conflict.filter((result) => result.status === 'fulfilled').length, 1)
    assert.equal((await db.query('select version from operating_cost_entries where source_key=$1', [sourceKey])).rows[0].version, 2)
    await assert.rejects(() => saveOperatingCost({ ...operator, entry: { ...entry, amount: '19', expectedVersion: 1 } }), /modifiée/)
    await assert.rejects(() => getOperatingCostSnapshot({ ...operator, operatorWorkspaceId: commercialId, month }), /opérateur/)
    await assert.rejects(() => saveOperatingCost({ ...operator, actorUserId: owner, entry }), /opérateur/)
    await assert.rejects(() => withTenantTransaction({ workspaceId, userId: actor }, (tx) => tx.execute(sql`select * from operating_cost_entries`)), (error) => code(error) === '42501')
    await assert.rejects(() => withSystemTransaction((tx) => tx.execute(sql`delete from operating_cost_entries where source_key=${sourceKey}`)), (error) => code(error) === '42501')
    for (const invalid of ["amount_micros='NaN'", 'solo_weight=10001', "support_minutes=10", "allocation_method='direct'", "currency='eur'"]) await assert.rejects(() => db.query(`update operating_cost_entries set ${invalid} where source_key=$1`, [sourceKey]), (error) => code(error) === '23514')
    // Real membership row locks protect against roles revoked outside the advisory protocol.
    await blocker.query('begin')
    await blocker.query("update auth_members set role='analyst' where organization_id=$1 and user_id=$2", [org, actor])
    const pending = Promise.allSettled([saveOperatingCost({ ...operator, entry: { ...entry, amount: '20', expectedVersion: 2 } })])
    try {
      let waiting = false
      const deadline = Date.now() + 5000
      while (Date.now() < deadline) {
        waiting = (await db.query("select 1 from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and query like '%auth_members%for share%'" )).rowCount! > 0
        if (waiting) break
        await setTimeout(20)
      }
      assert(waiting, 'Cost correction must wait for the changed membership row')
    } finally { await blocker.query('commit') }
    assert.equal((await pending)[0].status, 'rejected')
    await assert.rejects(() => getOperatingCostSnapshot({ ...operator, month }), /opérateur/)
    await db.query("update auth_members set role='admin' where organization_id=$1 and user_id=$2", [org, actor])
    // Populate beyond the UI page and assert the complete monthly aggregate still includes every source.
    await db.query("insert into operating_cost_entries(source_key,month,category,currency,basis,amount_micros,allocation_method,updated_by) select $1||'-'||(case when i%2=0 then 'A.' else 'a_' end)||i,$2,'email','USD','estimated',1000000,'unallocated',$3 from generate_series(1,30) i", [sourceKey, month, actor])
    const snapshot = await getOperatingCostSnapshot({ ...operator, month })
    assert.equal(snapshot.totalReferences, baseline.totalReferences + 31)
    assert.equal(snapshot.entries.length, 25); assert(snapshot.next)
    const usdBaseline = baseline.cells.find((cell) => cell.category === 'email' && cell.currency === 'USD' && cell.plan === 'unallocated')?.estimated ?? BigInt(0)
    assert.equal(snapshot.cells.find((cell) => cell.category === 'email' && cell.currency === 'USD' && cell.plan === 'unallocated')!.estimated, usdBaseline + BigInt(30_000_000))
    const next = await getOperatingCostSnapshot({ ...operator, month, after: snapshot.next })
    assert(next.entries.every((item) => item.sourceKey > snapshot.next!)); assert.deepEqual(next.cells, snapshot.cells)
    const allReferences = [...snapshot.entries.map((item) => item.sourceKey)]
    let cursor: string | null = snapshot.next
    while (cursor) {
      const page = await getOperatingCostSnapshot({ ...operator, month, after: cursor })
      allReferences.push(...page.entries.map((item) => item.sourceKey)); cursor = page.next
    }
    assert.equal(allReferences.length, snapshot.totalReferences); assert.equal(new Set(allReferences).size, snapshot.totalReferences)
    assert.deepEqual(allReferences, [...allReferences].sort(), 'Database ordering and cursor comparisons must use the same ASCII order')
    await saveOperatingCost({ ...operator, entry: { ...entry, expectedVersion: 2, voided: 'true' } })
    assert.equal((await getOperatingCostSnapshot({ ...operator, month })).activeReferences, baseline.activeReferences + 30)
    assert.equal((await db.query("select count(*)::int as count from audit_events where workspace_id=$1 and action='operations.cost_recorded'", [workspaceId])).rows[0].count, 3)
    // Historical attribution survives plan changes; explicit spoofing is replaced at insertion.
    await db.query("insert into jobs(id,workspace_id,type) values($1,$2,'analytics.collect'),($3,null,'auth.email_deliver')", [jobId, commercialId, globalJobId])
    await withSystemTransaction((tx) => tx.execute(sql`insert into job_attempts(workspace_id,job_id,attempt,state,worker_id,billing_plan_at_start,started_at,finished_at) values(${commercialId}::uuid,${jobId}::uuid,1,'succeeded','cost-fixture','solo',clock_timestamp()-interval '2 seconds',clock_timestamp()-interval '1 second'),(null,${globalJobId}::uuid,1,'running','cost-fixture','agency',clock_timestamp(),null)`))
    await db.query("update workspaces set plan='solo' where id=$1", [commercialId])
    await withSystemTransaction((tx) => tx.execute(sql`insert into job_attempts(workspace_id,job_id,attempt,state,worker_id) values(${commercialId}::uuid,${jobId}::uuid,2,'running','cost-fixture')`))
    const attempts = (await db.query('select attempt,billing_plan_at_start from job_attempts where job_id=$1 order by attempt', [jobId])).rows
    assert.deepEqual(attempts, [{ attempt: 1, billing_plan_at_start: 'agency' }, { attempt: 2, billing_plan_at_start: 'solo' }])
    assert.equal((await db.query('select billing_plan_at_start from job_attempts where job_id=$1', [globalJobId])).rows[0].billing_plan_at_start, 'unallocated')
    await assert.rejects(() => db.query("update job_attempts set billing_plan_at_start='studio' where job_id=$1", [jobId]), (error) => code(error) === '22023')
    const usage = (await getOperatingCostSnapshot({ ...operator, month })).usage
    assert(usage.find((row) => row.plan === 'agency')!.googleReadAttempts >= 1)
    assert(usage.find((row) => row.plan === 'agency')!.finishedAttempts >= 1)
    console.log('Operating costs: exact amounts, idempotent/concurrent corrections, complete paginated aggregates, operator row-lock revocation, SQL denials and immutable attempt attribution verified; no provider call.')
  } finally {
    await blocker.query('rollback').catch(() => {}); await blocker.end()
    await db.query('delete from operating_cost_entries where source_key=$1 or source_key like $2', [sourceKey, `${sourceKey}-%`])
    await db.query('delete from jobs where id=$1', [globalJobId])
    await db.query('delete from workspaces where id=any($1::uuid[])', [[workspaceId, commercialId]])
    await db.query('delete from auth_organizations where id=any($1::text[])', [[org, commercialOrg]])
    await db.query('delete from auth_users where id=any($1::text[])', [[owner, actor]])
    await db.end()
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
