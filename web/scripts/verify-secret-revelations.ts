import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { setTimeout } from 'node:timers/promises'
import { Client } from 'pg'
import { consumeWorkspaceSecretRevelation } from '../src/lib/data'
import { encryptSecret, decryptSecret } from '../src/lib/crypto'
import { hashToken } from '../src/lib/tokens'

const url = new URL(process.env.DATABASE_SYSTEM_URL ?? '')
assert(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && url.pathname.startsWith('/yodev_test'), 'Disposable local database required')
globalThis.fetch = async () => { throw new Error('Provider calls forbidden') }
process.env.PUBLIC_API_ENABLED = '1'
process.env.NEXT_PUBLIC_APP_URL = 'https://ads.example.test'
const db = new Client({ connectionString: url.href }), blocker = new Client({ connectionString: url.href })
const [workspaceId, organizationId, actor, clientId, keyId, shareId, domainId] = Array.from({ length: 7 }, () => randomUUID())
const token = `ya_live_${randomUUID()}`, reportToken = randomUUID(), dnsToken = randomUUID(), hostname = `${randomUUID()}.example.test`
const items = [
  { id: randomUUID(), kind: 'api_key', secret: token },
  { id: randomUUID(), kind: 'report_url', secret: `https://ads.example.test/r/${reportToken}` },
  { id: randomUUID(), kind: 'domain_dns', secret: JSON.stringify({ type: 'TXT', name: `_yodev-ads.${hostname}`, value: `yodev-domain-verification=${dnsToken}` }) },
]
async function restore() {
  await db.query("update workspaces set access_state='internal',plan='internal',owner_user_id=$2,trial_ends_at=null where id=$1", [workspaceId, actor])
  await db.query("insert into auth_members(id,organization_id,user_id,role) values($1,$2,$1,'admin') on conflict(id) do update set role='admin'", [actor, organizationId])
  await db.query("update api_keys set revoked_at=null,scopes=ARRAY['portfolio:read'],expires_at=clock_timestamp()+interval '1 day' where id=$1", [keyId])
  await db.query('update share_links set active=true,expires_at=clock_timestamp()+interval \'1 day\' where id=$1', [shareId])
  await db.query('update clients set active=true where id=$1', [clientId])
  await db.query('update workspace_domains set revoked_at=null where id=$1', [domainId])
  for (const item of items) await db.query("update secret_revelations set user_id=$2,kind=$3,encrypted_secret=$4,revealed_at=null,expires_at=clock_timestamp()+interval '5 minutes' where id=$1", [item.id, actor, item.kind, encryptSecret(item.secret)])
}
async function unconsumed(id: string) { assert.equal((await db.query('select revealed_at from secret_revelations where id=$1', [id])).rows[0].revealed_at, null) }
async function denied(item: typeof items[number], label: string) {
  await assert.rejects(() => consumeWorkspaceSecretRevelation(workspaceId, actor, item.id), label); await unconsumed(item.id)
}
async function waitFor(pattern: string) {
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    if ((await db.query("select 1 from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and query like $1", [pattern])).rowCount) return
    await setTimeout(20)
  }
  assert.fail(`Expected PostgreSQL wait: ${pattern}`)
}
async function blocked(item: typeof items[number], statement: string, pattern: string, expire?: () => Promise<void>) {
  await blocker.query('begin'); await blocker.query(statement)
  const pending = Promise.allSettled([consumeWorkspaceSecretRevelation(workspaceId, actor, item.id)])
  try { await waitFor(pattern); await expire?.() } finally { await blocker.query('commit') }
  assert.equal((await pending)[0].status, 'rejected'); await unconsumed(item.id)
}
async function waitExpired(table: string, column: string, id: string) {
  while (!(await db.query(`select ${column}<=clock_timestamp() as expired from ${table} where id=$1`, [id])).rows[0].expired) await setTimeout(20)
}
async function main() {
  await db.connect(); await blocker.connect()
  try {
    await db.query('insert into auth_users(id,name,email,email_verified) values($1,$1,$2,true)', [actor, `${actor}@example.test`])
    await db.query('insert into auth_organizations(id,name,slug) values($1::text,$1::text,$1::text)', [organizationId])
    await db.query("insert into workspaces(id,name,slug,auth_organization_id,owner_user_id,plan,access_state) values($1,$2::text,$2::text,$2::text,$3,'internal','internal')", [workspaceId, organizationId, actor])
    await db.query("insert into clients(id,workspace_id,google_customer_id,name) values($1,$2,'7440000001','Revelation fixture')", [clientId, workspaceId])
    await db.query("insert into api_keys(id,workspace_id,created_by,name,token_hash,token_prefix,scopes) values($1,$2,$3,'Fixture',$4,'fixture',ARRAY['portfolio:read'])", [keyId, workspaceId, actor, hashToken(token)])
    await db.query("insert into share_links(id,workspace_id,client_id,created_by,label,token_hash,token_prefix) values($1,$2,$3,$4,'Fixture',$5,'fixture')", [shareId, workspaceId, clientId, actor, hashToken(reportToken)])
    await db.query('insert into workspace_domains(id,workspace_id,hostname,dns_token_hash) values($1,$2,$3,$4)', [domainId, workspaceId, hostname, hashToken(dnsToken)])
    for (const item of items) await db.query("insert into secret_revelations(id,workspace_id,user_id,kind,encrypted_secret,expires_at) values($1,$2,$3,$4,$5,clock_timestamp()+interval '5 minutes')", [item.id, workspaceId, actor, item.kind, encryptSecret(item.secret)])
    for (const item of items) {
      await restore(); await db.query("update workspaces set owner_user_id='other-owner' where id=$1", [workspaceId]); await db.query("update auth_members set role='client' where id=$1", [actor]); await denied(item, `${item.kind}: client must not reveal`)
      await restore(); await db.query('delete from auth_members where id=$1', [actor]); await denied(item, 'removed actor')
      for (const state of ['grace', 'suspended', 'deletion_pending', 'deleted']) {
        await restore(); await db.query('update workspaces set access_state=$1 where id=$2', [state, workspaceId]); await denied(item, state)
      }
      await restore(); await db.query("update secret_revelations set user_id='other-user' where id=$1", [item.id]); await denied(item, 'foreign user')
      await restore(); await db.query("update secret_revelations set kind='unknown' where id=$1", [item.id]); await denied(item, 'unknown kind')
      await restore(); await db.query("update workspaces set owner_user_id='other-owner' where id=$1", [workspaceId])
      await blocked(item, `update auth_members set role='client' where id='${actor}'`, '%select * from public.lock_workspace_actor%')
      await restore(); await db.query("update secret_revelations set expires_at=clock_timestamp()+interval '1 second' where id=$1", [item.id])
      await blocked(item, `select id from secret_revelations where id='${item.id}' for update`, '%secret_revelations%for update%', () => waitExpired('secret_revelations', 'expires_at', item.id))
      await restore(); await db.query("update secret_revelations set expires_at=clock_timestamp()+interval '1 second' where id=$1", [item.id])
      await blocked(item, 'lock table secret_revelations in share mode', 'update%secret_revelations%', () => waitExpired('secret_revelations', 'expires_at', item.id))
    }
    for (const [index, table, id, change] of [[0, 'api_keys', keyId, 'revoked_at=now()'], [1, 'share_links', shareId, 'active=false'], [2, 'workspace_domains', domainId, 'revoked_at=now()']] as const) {
      await restore(); await blocked(items[index], `update ${table} set ${change} where id='${id}'`, `%${table}%for share%`)
    }
    for (const [index, table, id] of [[0, 'api_keys', keyId], [1, 'share_links', shareId]] as const) {
      await restore(); await db.query(`update ${table} set expires_at=clock_timestamp()+interval '1 second' where id=$1`, [id])
      await blocked(items[index], 'lock table secret_revelations in share mode', 'update%secret_revelations%', () => waitExpired(table, 'expires_at', id))
    }
    await restore(); await db.query("update workspaces set access_state='trial',plan='trial',trial_ends_at=clock_timestamp()+interval '1 second' where id=$1", [workspaceId])
    await blocked(items[1], 'lock table secret_revelations in share mode', 'update%secret_revelations%', () => waitExpired('workspaces', 'trial_ends_at', workspaceId))
    await restore(); await db.query("update workspaces set owner_user_id='other-owner' where id=$1", [workspaceId]); await denied(items[0], 'admin is not API owner')
    await db.query("update auth_members set role='analyst' where id=$1", [actor]); assert.equal(decryptSecret((await consumeWorkspaceSecretRevelation(workspaceId, actor, items[1].id))!.encryptedSecret), items[1].secret)
    await restore(); await db.query("update workspaces set access_state='active',plan='studio' where id=$1", [workspaceId]); process.env.PRIVATE_API_WORKSPACE_IDS = workspaceId
    await db.query("update api_keys set scopes=ARRAY['reports:write'] where id=$1", [keyId]); await denied(items[0], 'advanced API scope after downgrade'); await denied(items[2], 'custom domain after downgrade')
    await restore(); await db.query("update secret_revelations set encrypted_secret=$1 where id=$2", [encryptSecret(`https://foreign.example.test/r/${reportToken}`), items[1].id]); await denied(items[1], 'foreign report host')
    await restore(); await db.query("update secret_revelations set encrypted_secret=$1 where id=$2", [encryptSecret(`https://ads.example.test/r/${reportToken}?edition=${randomUUID()}`), items[1].id]); await denied(items[1], 'missing edition')
    await restore(); process.env.PUBLIC_API_ENABLED = '0'; await denied(items[0], 'API disabled'); process.env.PUBLIC_API_ENABLED = '1'
    await restore(); await db.query('update clients set active=false where id=$1', [clientId]); await denied(items[1], 'inactive report account')
    assert.equal((await db.query("select has_table_privilege('yodev_app','report_editions','UPDATE') as allowed")).rows[0].allowed, false)
    for (const [number, duration] of [[1, '1 day'], [2, '1 second']] as const) {
      await restore(); const editionId = randomUUID()
      await db.query("insert into report_editions(id,workspace_id,client_id,share_id,kind,edition_number,deduplication_key,period_from,period_through,timezone,currency_code,source_version,payload,expires_at) values($1,$2,$3,$4,'initial',$5,$6,'2026-08-01','2026-08-07','Europe/Paris','EUR','fixture','{}',clock_timestamp()+$7::interval)", [editionId, workspaceId, clientId, shareId, number, `fixture-${number}`, duration])
      const secret = `${items[1].secret}?edition=${editionId}`
      await db.query('update secret_revelations set encrypted_secret=$1 where id=$2', [encryptSecret(secret), items[1].id])
      if (number === 1) assert.equal(decryptSecret((await consumeWorkspaceSecretRevelation(workspaceId, actor, items[1].id)).encryptedSecret), secret)
      else await blocked(items[1], 'lock table secret_revelations in share mode', 'update%secret_revelations%', () => waitExpired('report_editions', 'expires_at', editionId))
    }
    for (const item of items) {
      await restore()
      const results = await Promise.allSettled([consumeWorkspaceSecretRevelation(workspaceId, actor, item.id), consumeWorkspaceSecretRevelation(workspaceId, actor, item.id)])
      const succeeded = results.filter((result) => result.status === 'fulfilled')
      assert.equal(succeeded.length, 1, 'Exactly one concurrent revelation')
      assert.equal(decryptSecret(succeeded[0].value!.encryptedSecret), item.secret)
    }
    console.log(JSON.stringify({ ok: true, verified: ['three_kind_current_actor_matrix', 'owner_only_api_and_analyst_report', 'three_membership_waits', 'six_secret_expiry_waits', 'three_resource_revocation_waits', 'two_resource_expiry_rollbacks', 'final_trial_rollback', 'API_flag_and_inactive_report', 'immutable_edition_without_UPDATE_grant_and_expiry_rollback', 'three_exactly_once_concurrent_revelations'], providerCalls: 0 }))
  } finally {
    await blocker.query('rollback').catch(() => {}); await blocker.end()
    await db.query('delete from workspaces where id=$1', [workspaceId]); await db.query('delete from auth_organizations where id=$1', [organizationId]); await db.query('delete from auth_users where id=$1', [actor]); await db.end()
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
