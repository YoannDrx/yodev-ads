import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { setTimeout } from 'node:timers/promises'
import { Client } from 'pg'
import { eq } from 'drizzle-orm'
import { jobs } from '../src/db/schema'
import { withSystemTransaction } from '../src/db/transactions'
import { googleInventoryConnectionIdentity, persistTenantGoogleAccountInventory, persistSystemGoogleAccountInventory } from '../src/lib/google-account-sync'

const url = new URL(process.env.DATABASE_SYSTEM_URL ?? '')
assert(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && url.pathname.startsWith('/yodev_test'), 'Disposable local database required')
globalThis.fetch = async () => { throw new Error('Provider calls forbidden') }
const db = new Client({ connectionString: url.href }), blocker = new Client({ connectionString: url.href })
const [workspaceId, organizationId, actorUserId, connectionId, jobId] = Array.from({ length: 5 }, () => randomUUID())
let observed = Date.now() - 60_000
const input = () => ({ workspaceId, actorUserId, connectionId, connectionIdentity: googleInventoryConnectionIdentity({ managerCustomerId: '7430000000', encryptedRefreshToken: 'fixture-only', scopes: [] }),
  observedAt: new Date(observed += 100), managedCustomers: [{ customerId: '7430000001', name: 'Updated advertiser', currencyCode: 'EUR', timezone: 'Europe/Paris', isManager: false }],
  action: 'google_ads.accounts_synced' as const, recordActivation: true })
async function snapshot() {
  return (await db.query('select (select json_agg(c order by id) from clients c where workspace_id=$1) as clients,(select json_agg(a order by id) from audit_events a where workspace_id=$1) as audits,(select json_agg(m order by id) from activation_milestones m where workspace_id=$1) as milestones,(select last_successful_use_at from google_ads_connections where id=$2) as last_use', [workspaceId, connectionId])).rows[0]
}
async function restore() {
  await db.query("update workspaces set access_state='active',trial_ends_at=null where id=$1", [workspaceId])
  await db.query("insert into auth_members(id,organization_id,user_id,role) values($1,$2,$1,'admin') on conflict(id) do update set role='admin'", [actorUserId, organizationId])
  await db.query("update google_ads_connections set status='active',encrypted_refresh_token='fixture-only' where id=$1", [connectionId])
  await db.query("update jobs set status='running',type='google.accounts_sync',lease_owner='fixture',attempt_count=1,lease_expires_at=clock_timestamp()+interval '1 minute',payload=jsonb_build_object('workspaceId',$2::text) where id=$1", [jobId, workspaceId])
}
async function claimed() { return withSystemTransaction(async (tx) => (await tx.select().from(jobs).where(eq(jobs.id, jobId)))[0]) }
async function operation(system: boolean, stale = false) {
  const data = input()
  if (stale) data.observedAt = new Date(0)
  const job = await claimed()
  return () => system ? persistSystemGoogleAccountInventory(data, job) : persistTenantGoogleAccountInventory(data)
}
async function denied(run: () => Promise<unknown>, label: string) {
  const before = await snapshot(); await assert.rejects(run, label); assert.deepEqual(await snapshot(), before, label)
}
async function waitFor(pattern: string) {
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    if ((await db.query("select 1 from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and query like $1", [pattern])).rowCount) return
    await setTimeout(20)
  }
  assert.fail(`Expected a real PostgreSQL lock wait: ${pattern}`)
}
async function waitUntilExpired(column: 'trial_ends_at' | 'lease_expires_at') {
  const table = column === 'trial_ends_at' ? 'workspaces' : 'jobs', id = column === 'trial_ends_at' ? workspaceId : jobId
  while (!(await db.query(`select ${column}<=clock_timestamp() as expired from ${table} where id=$1`, [id])).rows[0].expired) await setTimeout(20)
}
async function blocked(run: () => Promise<unknown>, lock: string, pattern: string, afterWait?: () => Promise<void>) {
  const before = await snapshot()
  await blocker.query('begin'); await blocker.query(lock)
  const pending = Promise.allSettled([run()])
  try { await waitFor(pattern); await afterWait?.() } finally { await blocker.query('commit') }
  const result = (await pending)[0]
  assert.equal(result.status, 'rejected', `Expected rejection after ${pattern}`); assert.deepEqual(await snapshot(), before)
}
async function main() {
  await db.connect(); await blocker.connect()
  try {
    await db.query('insert into auth_users(id,name,email,email_verified) values($1,$1,$2,true)', [actorUserId, `${actorUserId}@example.test`])
    await db.query('insert into auth_organizations(id,name,slug) values($1::text,$1::text,$1::text)', [organizationId])
    await db.query("insert into workspaces(id,name,slug,auth_organization_id,owner_user_id,plan,access_state) values($1,$2::text,$2::text,$2::text,'different-owner','agency','active')", [workspaceId, organizationId])
    await db.query("insert into google_ads_connections(id,workspace_id,manager_customer_id,encrypted_refresh_token,connected_by) values($1,$2,'7430000000','fixture-only',$3)", [connectionId, workspaceId, actorUserId])
    await db.query("insert into clients(workspace_id,google_customer_id,name,managed_selected,google_accessible,active) values($1,'7430000001','Original advertiser',true,true,true)", [workspaceId])
    await db.query("insert into jobs(id,workspace_id,type,payload,deduplication_key) values($1::uuid,$2::uuid,'google.accounts_sync',jsonb_build_object('workspaceId',$2::text),$1::text)", [jobId, workspaceId])
    for (const role of ['analyst', 'strategist', 'client']) {
      await restore(); await db.query('update auth_members set role=$1 where id=$2', [role, actorUserId]); await denied(await operation(false), `${role}: inventory must refuse`)
    }
    await db.query('delete from auth_members where id=$1', [actorUserId]); await denied(await operation(false), 'removed actor')
    for (const system of [false, true]) {
      for (const state of ['grace', 'suspended', 'deletion_pending', 'deleted']) {
        await restore(); await db.query('update workspaces set access_state=$1 where id=$2', [state, workspaceId]); await denied(await operation(system), state)
      }
      await restore(); await db.query("update workspaces set access_state='trial',trial_ends_at=clock_timestamp()-interval '1 second' where id=$1", [workspaceId]); await denied(await operation(system), 'expired trial')
      for (const change of ["status='revoked'", "encrypted_refresh_token='replaced'"]) {
        await restore()
        await blocked(await operation(system), `update google_ads_connections set ${change} where id='${connectionId}'`, '%google_ads_connections%for update%')
      }
      await restore(); await db.query("update workspaces set access_state='trial',trial_ends_at=clock_timestamp()+interval '1 second' where id=$1", [workspaceId])
      await blocked(await operation(system), 'lock table audit_events in share mode', 'insert into%audit_events%', () => waitUntilExpired('trial_ends_at'))
    }
    await restore(); await blocked(await operation(false), `update auth_members set role='client' where id='${actorUserId}'`, '%select * from public.lock_workspace_actor%')
    for (const change of ["status='retrying'", "lease_owner='another-worker'", 'attempt_count=2', "payload='{}'::jsonb", "type='stripe.reconcile'", "lease_expires_at=clock_timestamp()-interval '1 second'"]) {
      await restore(); const run = await operation(true)
      await db.query(`update jobs set ${change} where id=$1`, [jobId]); await denied(run, `stale job: ${change}`)
    }
    await restore(); await blocked(await operation(true), `update jobs set lease_owner='another-worker' where id='${jobId}'`, '%jobs%for update%')
    await restore(); await db.query("update jobs set lease_expires_at=clock_timestamp()+interval '1 second' where id=$1", [jobId])
    await blocked(await operation(true), 'lock table audit_events in share mode', 'insert into%audit_events%', () => waitUntilExpired('lease_expires_at'))
    // Valid tenant and system work commit; background work does not impersonate its original author.
    await restore(); await (await operation(false))()
    await db.query('delete from auth_members where id=$1', [actorUserId]); await (await operation(true))()
    assert.equal((await db.query('select name from clients where workspace_id=$1', [workspaceId])).rows[0].name, 'Updated advertiser')
    // An old observation still reconciles active flags; that early path must also recheck time.
    for (const system of [false, true]) {
      await restore(); await db.query('update clients set active=false where workspace_id=$1', [workspaceId])
      await db.query("update workspaces set access_state='trial',trial_ends_at=clock_timestamp()+interval '1 second' where id=$1", [workspaceId])
      await blocked(await operation(system, true), 'lock table clients in share mode', 'update%clients%', () => waitUntilExpired('trial_ends_at'))
    }
    console.log(JSON.stringify({ ok: true, verified: ['tenant_current_actor', 'system_current_job_scope_attempt_lease', 'both_current_lifecycle_trial', 'connection_replacement_and_revocation_row_waits', 'membership_and_job_row_waits', 'trial_and_lease_expiry_after_audit_wait_rollback', 'stale_inventory_reconciliation_trial_rollback', 'authorized_tenant_and_system_without_human_membership'], providerCalls: 0 }))
  } finally {
    await blocker.query('rollback').catch(() => {}); await blocker.end()
    await db.query('delete from workspaces where id=$1', [workspaceId]); await db.query('delete from auth_organizations where id=$1', [organizationId])
    await db.query('delete from auth_users where id=$1', [actorUserId]); await db.end()
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
