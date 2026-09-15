import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { setTimeout } from 'node:timers/promises'
import { Client } from 'pg'
import { saveWorkspaceGoogleConnection } from '../src/lib/data'

const url = new URL(process.env.DATABASE_SYSTEM_URL ?? '')
assert(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && url.pathname.startsWith('/yodev_test'), 'Disposable local database required')
globalThis.fetch = async () => { throw new Error('Provider calls forbidden') }
const db = new Client({ connectionString: url.href }), blocker = new Client({ connectionString: url.href })
const [workspaceId, organizationId, actor, connectionId] = Array.from({ length: 4 }, () => randomUUID())
async function snapshot() {
  return (await db.query('select (select json_agg(c order by id) from google_ads_connections c where workspace_id=$1) as connection,(select json_agg(c order by id) from clients c where workspace_id=$1) as clients,(select json_agg(a order by id) from audit_events a where workspace_id=$1) as audits,(select json_agg(m order by id) from activation_milestones m where workspace_id=$1) as milestones', [workspaceId])).rows[0]
}
async function restore() {
  await db.query("update workspaces set access_state='active',plan='agency',trial_ends_at=null where id=$1", [workspaceId])
  await db.query("insert into auth_members(id,organization_id,user_id,role) values($1,$2,$1,'admin') on conflict(id) do update set role='admin'", [actor, organizationId])
}
async function input() {
  const row = (await db.query('select * from google_ads_connections where workspace_id=$1', [workspaceId])).rows[0]
  const expectedConnectionVersion = row ? createHash('sha256').update(JSON.stringify([row.id, row.status, row.manager_customer_id, row.encrypted_refresh_token, [...row.scopes].sort()])).digest('hex') : 'none'
  return { workspaceId, userId: actor, managerCustomerId: '7450000000', googleEmail: 'fixture@example.test', encryptedRefreshToken: 'new-fixture-token', scopes: ['https://www.googleapis.com/auth/adwords'], expectedConnectionVersion, authorizationExpiresAt: new Date(Date.now() + 60_000) }
}
async function denied(label: string) { const before = await snapshot(); await assert.rejects(saveWorkspaceGoogleConnection(await input()), label); assert.deepEqual(await snapshot(), before) }
async function waitFor(pattern: string) {
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    if ((await db.query("select 1 from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and query like $1", [pattern])).rowCount) return
    await setTimeout(20)
  }
  assert.fail(`Expected PostgreSQL wait: ${pattern}`)
}
async function blocked(statement: string, pattern: string, expiration?: 'trial' | 'oauth') {
  const data = await input(), before = await snapshot()
  if (expiration === 'oauth') data.authorizationExpiresAt = new Date(Date.now() + 1_000)
  await blocker.query('begin'); await blocker.query(statement)
  const pending = Promise.allSettled([saveWorkspaceGoogleConnection(data)])
  try {
    await waitFor(pattern)
    if (expiration === 'trial') while (!(await db.query('select trial_ends_at<=clock_timestamp() as expired from workspaces where id=$1', [workspaceId])).rows[0].expired) await setTimeout(20)
    if (expiration === 'oauth') while (Date.now() <= data.authorizationExpiresAt.getTime()) await setTimeout(20)
  } finally { await blocker.query('commit') }
  assert.equal((await pending)[0].status, 'rejected')
  // An external connection change is retained; no business side effects from the rejected callback.
  const after = await snapshot()
  assert.deepEqual({ ...after, connection: undefined }, { ...before, connection: undefined })
  if (!statement.startsWith('update google_ads_connections')) assert.deepEqual(after.connection, before.connection)
}
async function main() {
  await db.connect(); await blocker.connect()
  try {
    await db.query('insert into auth_users(id,name,email,email_verified) values($1,$1,$2,true)', [actor, `${actor}@example.test`])
    await db.query('insert into auth_organizations(id,name,slug) values($1::text,$1::text,$1::text)', [organizationId])
    await db.query("insert into workspaces(id,name,slug,auth_organization_id,owner_user_id,plan,access_state) values($1,$2::text,$2::text,$2::text,'other-owner','agency','active')", [workspaceId, organizationId])
    await db.query("insert into google_ads_connections(id,workspace_id,manager_customer_id,encrypted_refresh_token,connected_by) values($1,$2,'7450000000','old-fixture-token',$3)", [connectionId, workspaceId, actor])
    await db.query("insert into clients(workspace_id,google_customer_id,name,managed_selected,management_priority,google_accessible,active) values($1,'7450000001','Fixture',true,8,true,true)", [workspaceId])
    for (const role of ['analyst', 'strategist', 'client']) { await restore(); await db.query('update auth_members set role=$1 where id=$2', [role, actor]); await denied(role) }
    await db.query('delete from auth_members where id=$1', [actor]); await denied('removed')
    for (const state of ['grace', 'suspended', 'deletion_pending', 'deleted']) { await restore(); await db.query('update workspaces set access_state=$1 where id=$2', [state, workspaceId]); await denied(state) }
    await restore(); await blocked(`update auth_members set role='client' where id='${actor}'`, '%select * from public.lock_workspace_actor%')
    for (const statement of ["encrypted_refresh_token='concurrent-fixture-token'", "status='revoked'"]) {
      await restore(); await blocked(`update google_ads_connections set ${statement} where id='${connectionId}'`, '%google_ads_connections%for update%')
    }
    for (const expiration of ['trial', 'oauth'] as const) {
      await restore()
      if (expiration === 'trial') await db.query("update workspaces set access_state='trial',trial_ends_at=clock_timestamp()+interval '1 second' where id=$1", [workspaceId])
      await blocked('lock table audit_events in share mode', 'insert into%audit_events%', expiration)
    }
    await restore(); const before = await snapshot()
    await assert.rejects(saveWorkspaceGoogleConnection({ ...await input(), authorizationExpiresAt: new Date(0) }), /expir/); assert.deepEqual(await snapshot(), before)
    await assert.rejects(saveWorkspaceGoogleConnection({ ...await input(), expectedConnectionVersion: 'old' }), /chang/); assert.deepEqual(await snapshot(), before)
    await db.query('update google_ads_connections set last_successful_use_at=now() where id=$1', [connectionId])
    const data = await input(); await saveWorkspaceGoogleConnection(data)
    const after = await snapshot(); assert.equal(after.connection[0].encrypted_refresh_token, 'new-fixture-token'); assert.equal(after.connection[0].status, 'active'); assert.equal(after.connection[0].last_successful_use_at, null)
    assert.equal(after.clients[0].active, false); assert.equal(after.clients[0].google_accessible, false); assert.equal(after.clients[0].managed_selected, true); assert.equal(after.clients[0].management_priority, 8)
    assert.equal(after.audits.length, 1); assert.equal(after.milestones.length, 1)
    await assert.rejects(saveWorkspaceGoogleConnection(data), /chang/)
    await db.query('delete from google_ads_connections where workspace_id=$1', [workspaceId])
    const fresh = await input(); assert.equal(fresh.expectedConnectionVersion, 'none'); await saveWorkspaceGoogleConnection(fresh)
    await db.query('delete from google_ads_connections where workspace_id=$1', [workspaceId])
    const absent = await input(), beforeInsert = await snapshot()
    await blocker.query('begin'); await blocker.query('lock table google_ads_connections in share mode')
    const pending = Promise.allSettled([saveWorkspaceGoogleConnection(absent)])
    try {
      await waitFor('insert into%google_ads_connections%')
      await blocker.query("insert into google_ads_connections(workspace_id,manager_customer_id,encrypted_refresh_token,connected_by) values($1,'7450000000','concurrent-first-connection',$2)", [workspaceId, actor])
    } finally { await blocker.query('commit') }
    assert.equal((await pending)[0].status, 'rejected')
    const afterInsert = await snapshot(); assert.equal(afterInsert.connection[0].encrypted_refresh_token, 'concurrent-first-connection')
    assert.deepEqual({ ...afterInsert, connection: undefined }, { ...beforeInsert, connection: undefined })
    console.log(JSON.stringify({ ok: true, verified: ['current_actor_and_lifecycle', 'membership_wait_reauthorization', 'replacement_and_revocation_wait_version_conflicts', 'trial_and_oauth_expiry_after_audit_wait_rollback', 'expired_and_stale_callbacks_denied', 'authorized_replacement_preserves_selection_invalidates_inventory', 'first_connection_and_concurrent_replay', 'concurrent_first_insert_not_overwritten', 'old_usage_timestamp_cleared'], providerCalls: 0 }))
  } finally {
    await blocker.query('rollback').catch(() => {}); await blocker.end()
    await db.query('delete from workspaces where id=$1', [workspaceId]); await db.query('delete from auth_organizations where id=$1', [organizationId]); await db.query('delete from auth_users where id=$1', [actor]); await db.end()
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
