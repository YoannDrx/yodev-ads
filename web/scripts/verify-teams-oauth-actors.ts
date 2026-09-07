import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { setTimeout } from 'node:timers/promises'
import { Client } from 'pg'
import { createTeamsOAuthSession, accessTeamsOAuthSession, completeTeamsOAuthSession } from '../src/lib/notification-oauth-management'
import { encryptSecret, decryptSecret } from '../src/lib/crypto'
import { entitlementContext } from '../src/lib/entitlements'

const url = new URL(process.env.DATABASE_SYSTEM_URL ?? '')
assert(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && url.pathname.startsWith('/yodev_test'), 'Disposable local database required')
process.env.MICROSOFT_CLIENT_ID = 'local-fixture'; process.env.MICROSOFT_CLIENT_SECRET = 'local-fixture-not-a-secret'
const db = new Client({ connectionString: url.href }), blocker = new Client({ connectionString: url.href })
const [workspaceId, organizationId, actor, sessionId] = Array.from({ length: 4 }, () => randomUUID())
const oldToken = 'fixture-teams-refresh-token-before', newToken = 'fixture-teams-refresh-token-after'
let providerCalls = 0, sameToken = false, duringRefresh = async () => {}
globalThis.fetch = async (target, init) => {
  assert.equal(String(target), 'https://login.microsoftonline.com/organizations/oauth2/v2.0/token')
  assert.equal(init?.method, 'POST'); assert.equal(new URLSearchParams(String(init?.body)).get('grant_type'), 'refresh_token')
  providerCalls += 1; await duringRefresh()
  return Response.json({ access_token: 'fixture-teams-access-token-only', refresh_token: sameToken ? oldToken : newToken, expires_in: 3600, scope: 'ChannelMessage.Send Team.ReadBasic.All Channel.ReadBasic.All' })
}
const context = { workspaceId, actorUserId: actor }
function create() { return createTeamsOAuthSession({ ...context, refreshToken: newToken, scopes: ['ChannelMessage.Send'], authorizationExpiresAt: new Date(Date.now() + 60_000) }) }
function access() { return accessTeamsOAuthSession({ ...context, sessionId }) }
function complete() { return completeTeamsOAuthSession({ ...context, sessionId, teamId: 'team-fixture', teamName: 'Fixture team', channelId: 'channel-fixture', channelName: 'Fixture channel', entitlements: entitlementContext('active', 'agency') }) }
const operations = { create, access, complete }
async function snapshot() { return (await db.query('select (select json_agg(s order by id) from notification_oauth_sessions s where workspace_id=$1) as sessions,(select json_agg(c order by id) from notification_channels c where workspace_id=$1) as channels,(select json_agg(a order by id) from audit_events a where workspace_id=$1) as audits', [workspaceId])).rows[0] }
async function restore() {
  duringRefresh = async () => {}; sameToken = false
  await db.query("update workspaces set access_state='active',plan='agency',trial_ends_at=null where id=$1", [workspaceId])
  await db.query("insert into auth_members(id,organization_id,user_id,role) values($1,$2,$1,'admin') on conflict(id) do update set role='admin'", [actor, organizationId])
  await db.query('delete from notification_oauth_sessions where workspace_id=$1', [workspaceId])
  await db.query("insert into notification_oauth_sessions(id,workspace_id,user_id,provider,encrypted_refresh_token,expires_at) values($1,$2,$3,'teams',$4,clock_timestamp()+interval '1 minute')", [sessionId, workspaceId, actor, encryptSecret(oldToken)])
}
async function denied(name: keyof typeof operations) {
  const before = await snapshot(), calls = providerCalls
  await assert.rejects(operations[name](), /non autorisée|Capability|Quota/, name)
  assert.deepEqual(await snapshot(), before); assert.equal(providerCalls, calls)
}
async function waitFor(pattern: string) {
  const end = Date.now() + 5_000
  while (Date.now() < end) {
    if ((await db.query("select 1 from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and query like $1", [pattern])).rowCount) return
    await setTimeout(20)
  }
  assert.fail(`Expected lock wait: ${pattern}`)
}
async function blocked(operation: () => Promise<unknown>, statement: string, pattern: string, expiration?: 'trial' | 'session') {
  const before = await snapshot()
  await blocker.query('begin'); await blocker.query(statement)
  const pending = Promise.allSettled([operation()])
  try {
    await waitFor(pattern)
    if (expiration) {
      const query = expiration === 'trial' ? 'select trial_ends_at<=clock_timestamp() as expired from workspaces where id=$1' : 'select expires_at<=clock_timestamp() as expired from notification_oauth_sessions where workspace_id=$1'
      while (!(await db.query(query, [workspaceId])).rows[0].expired) await setTimeout(20)
    }
  } finally { await blocker.query('commit') }
  assert.equal((await pending)[0].status, 'rejected'); assert.deepEqual(await snapshot(), before)
}
async function main() {
  await db.connect(); await blocker.connect()
  try {
    await db.query('insert into auth_users(id,name,email,email_verified) values($1,$1,$2,true)', [actor, `${actor}@example.test`])
    await db.query('insert into auth_organizations(id,name,slug) values($1::text,$1::text,$1::text)', [organizationId])
    await db.query("insert into workspaces(id,name,slug,auth_organization_id,owner_user_id,plan,access_state) values($1,$2::text,$2::text,$2::text,'other-owner','agency','active')", [workspaceId, organizationId])
    for (const name of Object.keys(operations) as (keyof typeof operations)[]) {
      for (const role of ['analyst', 'strategist', 'client']) { await restore(); await db.query('update auth_members set role=$1 where id=$2', [role, actor]); await denied(name) }
      await db.query('delete from auth_members where id=$1', [actor]); await denied(name)
      for (const state of ['grace', 'suspended', 'deletion_pending', 'deleted']) { await restore(); await db.query('update workspaces set access_state=$1 where id=$2', [state, workspaceId]); await denied(name) }
      await restore(); await blocked(operations[name], `update auth_members set role='client' where id='${actor}'`, '%select * from public.lock_workspace_actor%')
      await restore(); await db.query("update workspaces set access_state='trial',trial_ends_at=clock_timestamp()+interval '1 second' where id=$1", [workspaceId])
      await blocked(operations[name], name === 'access' ? 'lock table notification_oauth_sessions in share mode' : 'lock table audit_events in share mode', name === 'access' ? 'update%notification_oauth_sessions%' : 'insert into%audit_events%', 'trial')
    }
    for (const name of ['access', 'complete'] as const) {
      await restore(); await db.query("update notification_oauth_sessions set expires_at=clock_timestamp()+interval '1 second' where id=$1", [sessionId])
      await blocked(operations[name], `select * from notification_oauth_sessions where id='${sessionId}' for update`, '%notification_oauth_sessions%for update%', 'session')
      await restore(); await db.query("update notification_oauth_sessions set expires_at=clock_timestamp()+interval '1 second' where id=$1", [sessionId])
      await blocked(operations[name], name === 'access' ? 'lock table notification_oauth_sessions in share mode' : 'lock table audit_events in share mode', name === 'access' ? 'update%notification_oauth_sessions%' : 'insert into%audit_events%', 'session')
    }
    for (const mutation of ["user_id='foreign-fixture-user'", "created_at=clock_timestamp()-interval '2 minutes',expires_at=clock_timestamp()-interval '1 second'"]) {
      await restore(); await db.query(`update notification_oauth_sessions set ${mutation} where id=$1`, [sessionId])
      const before = await snapshot(), calls = providerCalls
      await assert.rejects(access(), /expir/); await assert.rejects(complete(), /expir/)
      assert.deepEqual(await snapshot(), before); assert.equal(providerCalls, calls)
    }
    for (const unchanged of [true, false]) {
      await restore(); sameToken = unchanged
      duringRefresh = async () => { await db.query("update auth_members set role='client' where id=$1", [actor]) }
      const before = await snapshot(); await assert.rejects(access(), /non autorisée/); assert.deepEqual(await snapshot(), before)
      await restore(); sameToken = unchanged
      duringRefresh = async () => { await db.query("update notification_oauth_sessions set created_at=clock_timestamp()-interval '2 minutes',expires_at=clock_timestamp()-interval '1 second' where id=$1", [sessionId]) }
      await assert.rejects(access(), /expir/)
      await restore(); sameToken = unchanged
      duringRefresh = async () => { await db.query("update workspaces set plan='solo' where id=$1", [workspaceId]) }
      const beforeDowngrade = await snapshot(); await assert.rejects(access(), /non autorisée/); assert.deepEqual(await snapshot(), beforeDowngrade)
      await restore(); sameToken = unchanged
      duringRefresh = async () => { await db.query('delete from notification_oauth_sessions where id=$1', [sessionId]) }
      await assert.rejects(access(), /expir/)
      await restore(); sameToken = unchanged
      duringRefresh = async () => { await db.query('update notification_oauth_sessions set encrypted_refresh_token=$1 where id=$2', [encryptSecret('concurrent-fixture-teams-refresh-token'), sessionId]) }
      await assert.rejects(access(), /simultanément/)
    }
    await restore(); await db.query("update workspaces set plan='studio' where id=$1", [workspaceId])
    await db.query("insert into notification_channels(workspace_id,created_by,kind,label,encrypted_destination,destination_hint) select $1,$2,'webhook','Fixture','encrypted-fixture','Fixture' from generate_series(1,10)", [workspaceId, actor])
    await denied('complete')
    await db.query('delete from notification_channels where workspace_id=$1', [workspaceId])
    await restore(); const beforeExpired = await snapshot()
    await assert.rejects(createTeamsOAuthSession({ ...context, refreshToken: newToken, scopes: [], authorizationExpiresAt: new Date(0) }), /expir/)
    assert.deepEqual(await snapshot(), beforeExpired)
    await restore(); const expiredAt = new Date(Date.now() + 1_000)
    await blocker.query('begin'); await blocker.query('lock table audit_events in share mode')
    const beforeDeadline = await snapshot(), deadlinePending = Promise.allSettled([createTeamsOAuthSession({ ...context, refreshToken: newToken, scopes: [], authorizationExpiresAt: expiredAt })])
    try { await waitFor('insert into%audit_events%'); while (Date.now() <= expiredAt.getTime()) await setTimeout(20) } finally { await blocker.query('commit') }
    assert.equal((await deadlinePending)[0].status, 'rejected'); assert.deepEqual(await snapshot(), beforeDeadline)
    await restore(); await access(); assert.equal(decryptSecret((await snapshot()).sessions[0].encrypted_refresh_token), newToken)
    await restore(); sameToken = true; await access(); assert.equal(decryptSecret((await snapshot()).sessions[0].encrypted_refresh_token), oldToken)
    await restore(); const results = await Promise.allSettled([complete(), complete()]); assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1)
    const done = await snapshot(); assert.equal(done.sessions, null); assert.equal(done.channels.length, 1); assert.equal(JSON.parse(decryptSecret(done.channels[0].encrypted_destination)).refreshToken, oldToken)
    await restore(); const created = await create(); const afterCreate = await snapshot(); assert.equal(afterCreate.sessions.length, 1); assert.equal(afterCreate.sessions[0].id, created.id); assert.equal(decryptSecret(afterCreate.sessions[0].encrypted_refresh_token), newToken)
    console.log(JSON.stringify({ ok: true, verified: ['three_current_actor_lifecycle_denials', 'three_membership_waits', 'three_trial_wait_rollbacks', 'four_session_expiry_waits', 'refresh_reauthorization_for_rotated_and_unchanged_token', 'deleted_and_concurrently_rotated_session_denied', 'current_quota_after_downgrade', 'foreign_user_and_expired_session_denied', 'expiry_and_plan_change_during_refresh', 'authorization_expiry_before_and_after_audit_wait', 'encrypted_tokens_and_single_concurrent_completion'], simulatedProviderCalls: providerCalls, realProviderCalls: 0 }))
  } finally {
    await blocker.query('rollback').catch(() => {}); await blocker.end()
    await db.query('delete from workspaces where id=$1', [workspaceId]); await db.query('delete from auth_organizations where id=$1', [organizationId]); await db.query('delete from auth_users where id=$1', [actor]); await db.end()
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
