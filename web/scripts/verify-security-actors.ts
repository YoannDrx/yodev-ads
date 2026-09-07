import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { setTimeout } from 'node:timers/promises'
import { Client } from 'pg'
import { createWorkspaceApiKey, revokeWorkspaceApiKey, createWorkspaceNotificationChannel, disableWorkspaceNotificationChannel, retryWorkspaceDeadLetterJob, saveWorkspaceSafetyPolicy } from '../src/lib/workspace-security-resources'
import { entitlementContext } from '../src/lib/entitlements'
import { encryptSecret, decryptSecret } from '../src/lib/crypto'
import { hashToken } from '../src/lib/tokens'

const url = new URL(process.env.DATABASE_SYSTEM_URL ?? '')
assert(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && url.pathname.startsWith('/yodev_test'), 'Disposable local database required')
globalThis.fetch = async () => { throw new Error('Provider calls forbidden') }
const db = new Client({ connectionString: url.href }), blocker = new Client({ connectionString: url.href })
const [workspaceId, organization, otherOwner, actorUserId, clientId, keyId, channelId, jobId] = Array.from({ length: 8 }, () => randomUUID())
// Only enables local key issuance, with no API request or worker/provider execution.
process.env.PUBLIC_API_ENABLED = '1'; process.env.PRIVATE_API_WORKSPACE_IDS = workspaceId
const actor = { workspaceId, actorUserId }, entitlements = entitlementContext('active', 'agency'), token = `ya_live_${randomUUID()}`
const key = { ...actor, name: 'Security fixture key', token, scopes: ['portfolio:read', 'reports:write'], entitlements }
const channel = { ...actor, kind: 'webhook' as const, label: 'Security fixture channel', destination: 'https://example.test/private', minimumSeverity: 'warning' as const, entitlements }
const policy = { ...actor, scope: 'campaign' as const, clientId, campaignId: '12345', currencyCode: 'EUR', maximumDailyBudget: 125.5, maximumMonthlySpend: '' as const, maximumVariationPercent: 10, notificationEmail: '' }
const operations = {
  key_create: () => createWorkspaceApiKey(key), key_revoke: () => revokeWorkspaceApiKey({ ...actor, keyId }),
  channel_create: () => createWorkspaceNotificationChannel(channel), channel_disable: () => disableWorkspaceNotificationChannel({ ...actor, channelId }),
  retry: () => retryWorkspaceDeadLetterJob({ ...actor, jobId }), safety: () => saveWorkspaceSafetyPolicy(policy),
}
async function snapshot() {
  return (await db.query("select (select json_agg(k order by id) from api_keys k where workspace_id=$1) as keys,(select json_agg(r order by id) from secret_revelations r where workspace_id=$1) as revelations,(select json_agg(c order by id) from notification_channels c where workspace_id=$1) as channels,(select json_agg(j order by id) from jobs j where workspace_id=$1) as jobs,(select json_agg(s order by id) from safety_policies s where workspace_id=$1) as policies,(select json_build_object('daily',maximum_daily_budget_micros,'monthly',maximum_monthly_spend_micros,'email',notification_email) from workspaces where id=$1) as settings,(select count(*) from audit_events where workspace_id=$1) as audits", [workspaceId])).rows[0]
}
async function authorize() {
  await db.query("update workspaces set owner_user_id=$2::text,auth_owner_user_id=$2::text,access_state='active',plan='agency' where id=$1", [workspaceId, actorUserId])
  await db.query("update auth_members set role='owner' where organization_id=$1", [organization])
}
async function denyAll(label: string) {
  const before = await snapshot(), results = await Promise.allSettled(Object.values(operations).map((run) => run()))
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 0, `${label}: all six operations must refuse`)
  assert.deepEqual(await snapshot(), before)
}
async function waitFor(query: string, values: unknown[] = []) {
  const end = Date.now() + 5_000
  while (Date.now() < end) { if ((await db.query(query, values)).rowCount! > 0) return; await setTimeout(20) }
  assert.fail('Expected real PostgreSQL lock wait')
}
async function main() {
  await db.connect(); await blocker.connect()
  try {
    for (const user of [otherOwner, actorUserId]) await db.query('insert into auth_users(id,name,email,email_verified) values($1,$1,$2,true)', [user, `security-${user}@example.test`])
    await db.query('insert into auth_organizations(id,name,slug) values($1::text,$1::text,$1::text)', [organization])
    await db.query("insert into workspaces(id,name,slug,auth_organization_id,owner_user_id,auth_owner_user_id,plan,access_state) values($1,$2::text,$2::text,$2::text,$3::text,$3::text,'agency','active')", [workspaceId, organization, otherOwner])
    await db.query("insert into auth_members(id,organization_id,user_id,role) values($1,$2,$3,'client')", [randomUUID(), organization, actorUserId])
    await db.query("insert into clients(id,workspace_id,google_customer_id,name,currency_code) values($1,$2,'9100000038','Security fixture','EUR')", [clientId, workspaceId])
    await db.query("insert into api_keys(id,workspace_id,created_by,name,token_hash,token_prefix) values($1,$2,$3,'Existing key',$4,'fixture')", [keyId, workspaceId, actorUserId, hashToken(randomUUID())])
    await db.query("insert into notification_channels(id,workspace_id,created_by,kind,label,encrypted_destination,destination_hint) values($1,$2,$3,'email','Existing channel',$4,'fixture')", [channelId, workspaceId, actorUserId, encryptSecret('ops@example.test')])
    await db.query("insert into jobs(id,workspace_id,type,status,attempt_count,maximum_attempts,payload) values($1,$2,'notification.deliver','dead_letter',5,5,$3)", [jobId, workspaceId, { manualRetryGeneration: 2 }])
    await denyAll('Revoked role')
    await db.query('delete from auth_members where organization_id=$1', [organization]); await denyAll('Removed membership')
    await db.query("insert into auth_members(id,organization_id,user_id,role) values($1,$2,$3,'owner')", [randomUUID(), organization, actorUserId]); await authorize()
    for (const state of ['grace', 'suspended', 'deletion_pending', 'deleted']) { await db.query('update workspaces set access_state=$1 where id=$2', [state, workspaceId]); await denyAll(state) }
    await db.query("update workspaces set access_state='trial',trial_ends_at=now()-interval '1 second' where id=$1", [workspaceId]); await denyAll('Expired trial')
    for (const [name, run] of Object.entries(operations)) {
      await authorize(); const before = await snapshot()
      await blocker.query('begin'); await blocker.query('select pg_advisory_xact_lock(hashtext($1))', [`${workspaceId}:workspace-access`])
      await blocker.query('update workspaces set owner_user_id=$2::text,auth_owner_user_id=$2::text where id=$1', [workspaceId, otherOwner])
      await blocker.query("update auth_members set role='client' where organization_id=$1", [organization])
      const pending = Promise.allSettled([run()])
      try { await waitFor("select 1 from pg_locks where locktype='advisory' and not granted and objid=(hashtext($1)::bigint & 4294967295)::oid", [`${workspaceId}:workspace-access`]) }
      finally { await blocker.query('commit') }
      assert.equal((await pending)[0].status, 'rejected', `${name} must reauthorize`); assert.deepEqual(await snapshot(), before)
    }
    for (const [name, plan] of [['key_create', 'studio'], ['channel_create', 'solo'], ['safety', 'studio']] as const) {
      await authorize(); const before = await snapshot()
      await blocker.query('begin'); await blocker.query('select pg_advisory_xact_lock(hashtext($1))', [`${workspaceId}:workspace-access`])
      await blocker.query('update workspaces set plan=$1 where id=$2', [plan, workspaceId])
      const pending = Promise.allSettled([operations[name]()])
      try { await waitFor("select 1 from pg_locks where locktype='advisory' and not granted and objid=(hashtext($1)::bigint & 4294967295)::oid", [`${workspaceId}:workspace-access`]) }
      finally { await blocker.query('commit') }
      assert.equal((await pending)[0].status, 'rejected'); assert.deepEqual(await snapshot(), before)
    }
    for (const [name, run] of Object.entries(operations)) {
      await authorize(); await db.query("update workspaces set access_state='trial',trial_ends_at=clock_timestamp()+interval '1 second' where id=$1", [workspaceId])
      const before = await snapshot()
      await blocker.query('begin'); await blocker.query('lock table audit_events in share mode')
      const pending = Promise.allSettled([run()])
      try {
        await waitFor("select 1 from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and query like '%insert into%audit_events%'")
        while (!(await db.query('select trial_ends_at<=clock_timestamp() as expired from workspaces where id=$1', [workspaceId])).rows[0].expired) await setTimeout(20)
      } finally { await blocker.query('commit') }
      assert.equal((await pending)[0].status, 'rejected', `${name} must roll back after expiry`); assert.deepEqual(await snapshot(), before)
    }
    await authorize(); const before = await snapshot()
    await db.query('update clients set is_manager=true where id=$1', [clientId]); await assert.rejects(operations.safety, /introuvable/)
    await db.query("update clients set is_manager=false,currency_code='USD' where id=$1", [clientId]); await assert.rejects(operations.safety, /USD/)
    await db.query("update clients set currency_code='EUR' where id=$1", [clientId])
    await assert.rejects(() => saveWorkspaceSafetyPolicy({ ...policy, scope: 'workspace' }), /Périmètre/)
    assert.deepEqual(await snapshot(), before)
    const revelation = await operations.key_create()
    const secret = (await db.query('select encrypted_secret from secret_revelations where id=$1', [revelation.id])).rows[0]
    assert.equal(decryptSecret(secret.encrypted_secret), token)
    await operations.key_revoke(); await operations.channel_create(); await operations.channel_disable(); await operations.retry(); await operations.safety()
    assert.equal((await db.query('select token_hash from api_keys where workspace_id=$1 and name=$2', [workspaceId, key.name])).rows[0].token_hash, hashToken(token))
    assert.equal(decryptSecret((await db.query('select encrypted_destination from notification_channels where id=$1', [channelId])).rows[0].encrypted_destination), 'revoked')
    assert.deepEqual((await db.query('select status,maximum_attempts,payload from jobs where id=$1', [jobId])).rows[0], { status: 'queued', maximum_attempts: 10, payload: { manualRetryGeneration: 3 } })
    assert.equal((await db.query('select count(*) from audit_events where workspace_id=$1', [workspaceId])).rows[0].count, '6')
    await db.query('update workspaces set owner_user_id=$2::text,auth_owner_user_id=$2::text where id=$1', [workspaceId, otherOwner]); await db.query("update auth_members set role='admin' where organization_id=$1", [organization])
    await assert.rejects(operations.key_create, /non autorisée/); await assert.rejects(operations.key_revoke, /non autorisée/)
    await operations.channel_create(); await operations.safety()
    console.log(JSON.stringify({ ok: true, verified: ['six_revoked_removed_inactive_denials', 'six_observed_actor_waits', 'three_observed_downgrade_waits', 'six_post_authorization_trial_rollbacks', 'current_client_currency_and_scope', 'key_hash_and_revelation_atomic', 'channel_credentials_destroyed', 'retry_generation_preserved', 'owner_only_api_admin_other_settings'], providerCalls: 0 }))
  } finally {
    await blocker.query('rollback').catch(() => {}); await blocker.end()
    await db.query('delete from workspaces where id=$1', [workspaceId]); await db.query('delete from auth_organizations where id=$1', [organization])
    await db.query('delete from auth_users where id=any($1::text[])', [[otherOwner, actorUserId]]); await db.end()
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
