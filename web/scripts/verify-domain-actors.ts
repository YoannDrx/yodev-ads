import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { setTimeout } from 'node:timers/promises'
import dns from 'node:dns/promises'
import { syncBuiltinESMExports } from 'node:module'
import { Client } from 'pg'
import * as domains from '../src/lib/workspace-domain-management'
import { hashToken } from '../src/lib/tokens'

const url = new URL(process.env.DATABASE_SYSTEM_URL ?? '')
assert(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && url.pathname.startsWith('/yodev_test'), 'Disposable local database required')
const db = new Client({ connectionString: url.href }), blocker = new Client({ connectionString: url.href })
const [workspaceId, organizationId, actor, domainId] = Array.from({ length: 4 }, () => randomUUID())
const hostname = `domain-${domainId}.example.test`, token = randomUUID()
const context = { workspaceId, actorUserId: actor }, full = { ...context, domainId }
const calls: string[] = []
let dnsCalls = 0, onDns: (() => Promise<unknown>) | undefined, onFetch: ((url: string, method: string) => Promise<unknown>) | undefined
const originalFetch = globalThis.fetch, originalTxt = dns.resolveTxt
process.env.VERCEL_API_TOKEN = 'local-fixture-only'; process.env.VERCEL_PROJECT_ID = 'local-fixture-project'
dns.resolveTxt = async (name) => {
  assert.equal(name, `_yodev-ads.${hostname}`); dnsCalls++; await onDns?.()
  return [[`yodev-domain-verification=${token}`]]
}
syncBuiltinESMExports()
globalThis.fetch = async (input, init) => {
  const address = String(input), method = init?.method ?? 'GET'
  assert(address.startsWith('https://api.vercel.com/') || address === `https://${hostname}/api/health`, 'Unexpected provider URL')
  calls.push(`${method} ${address}`); await onFetch?.(address, method)
  return Response.json(address.includes('/config') ? { misconfigured: false } : { name: hostname, verified: true })
}
const operations = {
  create: () => domains.createWorkspaceCustomDomain({ ...context, hostname, token }),
  verify: () => domains.verifyWorkspaceCustomDomain(full),
  revoke: () => domains.revokeWorkspaceCustomDomain(full),
}
type Operation = keyof typeof operations
async function restore(operation: Operation) {
  onDns = undefined; onFetch = undefined; calls.length = 0; dnsCalls = 0
  await db.query("update workspaces set access_state='active',plan='agency',trial_ends_at=null where id=$1", [workspaceId])
  await db.query("insert into auth_members(id,organization_id,user_id,role) values($1,$2,$1,'admin') on conflict(id) do update set role='admin'", [actor, organizationId])
  await db.query('delete from secret_revelations where workspace_id=$1', [workspaceId])
  await db.query('delete from workspace_domains where workspace_id=$1', [workspaceId])
  await db.query('delete from audit_events where workspace_id=$1', [workspaceId])
  if (operation !== 'create') await db.query('insert into workspace_domains(id,workspace_id,hostname,dns_token_hash) values($1,$2,$3,$4)', [domainId, workspaceId, hostname, hashToken(token)])
}
async function snapshot() { return (await db.query('select (select json_agg(d order by id) from workspace_domains d where workspace_id=$1) as domains,(select json_agg(r order by id) from secret_revelations r where workspace_id=$1) as revelations,(select json_agg(a order by id) from audit_events a where workspace_id=$1) as audits', [workspaceId])).rows[0] }
async function waitFor(pattern: string) {
  const end = Date.now() + 5_000
  while (Date.now() < end) {
    if ((await db.query("select 1 from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and query like $1", [pattern])).rowCount) return
    await setTimeout(20)
  }
  assert.fail(`Expected database lock wait: ${pattern}`)
}
async function denied(operation: Operation) {
  const before = await snapshot(), beforeCalls = calls.length, beforeDns = dnsCalls
  await assert.rejects(operations[operation], /non autorisée/)
  assert.deepEqual(await snapshot(), before); assert.equal(calls.length, beforeCalls); assert.equal(dnsCalls, beforeDns)
}
async function main() {
  await db.connect(); await blocker.connect()
  try {
    await db.query('insert into auth_users(id,name,email,email_verified) values($1,$1,$2,true)', [actor, `${actor}@example.test`])
    await db.query('insert into auth_organizations(id,name,slug) values($1::text,$1::text,$1::text)', [organizationId])
    await db.query("insert into workspaces(id,name,slug,auth_organization_id,owner_user_id,plan,access_state) values($1,$2::text,$2::text,$2::text,'other-owner','agency','active')", [workspaceId, organizationId])
    for (const operation of Object.keys(operations) as Operation[]) {
      for (const role of ['client', 'analyst', 'strategist']) { await restore(operation); await db.query('update auth_members set role=$1 where id=$2', [role, actor]); await denied(operation) }
      await restore(operation); await db.query('delete from auth_members where id=$1', [actor]); await denied(operation)
      for (const state of ['grace', 'suspended', 'deletion_pending', 'deleted']) { await restore(operation); await db.query('update workspaces set access_state=$1 where id=$2', [state, workspaceId]); await denied(operation) }
      await restore(operation); await db.query("update workspaces set access_state='trial',trial_ends_at=clock_timestamp()-interval '1 second' where id=$1", [workspaceId]); await denied(operation)
      await restore(operation); const before = await snapshot()
      await blocker.query('begin'); await blocker.query("update auth_members set role='client' where id=$1", [actor])
      const pending = Promise.allSettled([operations[operation]()])
      try { await waitFor('%select * from public.lock_workspace_actor%') } finally { await blocker.query('commit') }
      assert.equal((await pending)[0].status, 'rejected'); assert.deepEqual(await snapshot(), before); assert.equal(calls.length, 0); assert.equal(dnsCalls, 0)
    }
    for (const operation of ['create', 'verify'] as const) {
      await restore(operation); await db.query("update workspaces set plan='solo' where id=$1", [workspaceId]); await denied(operation)
      await restore(operation); await db.query("update workspaces set access_state='trial',trial_ends_at=clock_timestamp()+interval '1 second' where id=$1", [workspaceId])
      const before = await snapshot()
      await blocker.query('begin'); await blocker.query('lock table audit_events in share mode')
      const pending = Promise.allSettled([operations[operation]()])
      try { await waitFor('insert into%audit_events%'); while (!(await db.query('select trial_ends_at<=clock_timestamp() as expired from workspaces where id=$1', [workspaceId])).rows[0].expired) await setTimeout(20) }
      finally { await blocker.query('commit') }
      assert.equal((await pending)[0].status, 'rejected'); assert.deepEqual(await snapshot(), before)
    }
    for (const stage of ['dns', 'provider', 'health']) {
      await restore('verify'); const before = await snapshot()
      const demote = () => db.query("update auth_members set role='client' where id=$1", [actor])
      if (stage === 'dns') onDns = demote
      else onFetch = async (address, method) => { if ((stage === 'provider' && method === 'POST') || (stage === 'health' && address.endsWith('/api/health'))) await demote() }
      await assert.rejects(operations.verify, /non autorisée/)
      assert.deepEqual(await snapshot(), before)
      assert.equal(calls.length, stage === 'dns' ? 0 : stage === 'provider' ? 1 : 3)
    }
    await restore('verify')
    onFetch = async (address) => { if (address.endsWith('/api/health')) await db.query('update workspace_domains set dns_token_hash=$2 where id=$1', [domainId, hashToken(randomUUID())]) }
    await assert.rejects(operations.verify, /a changé/)
    const changed = await snapshot(); assert.equal(changed.domains[0].verification_status, 'pending'); assert.equal(changed.domains[0].last_error, null); assert.equal(changed.audits, null)
    await restore('verify'); assert.equal((await domains.verifyWorkspaceCustomDomain(full)).active, true)
    assert.equal((await snapshot()).domains[0].verification_status, 'active')
    await restore('revoke'); await db.query("update workspaces set plan='solo' where id=$1", [workspaceId]); await operations.revoke()
    assert.equal((await snapshot()).domains[0].verification_status, 'revoked'); assert.equal(calls.filter((c) => c.startsWith('DELETE')).length, 1)
    await restore('revoke'); onFetch = async () => { await db.query("update auth_members set role='client' where id=$1", [actor]) }
    await operations.revoke(); assert.equal((await snapshot()).domains[0].verification_status, 'revoked')
    assert.equal((await snapshot()).audits[0].action, 'workspace_domain.revoked')
    await restore('verify'); onFetch = async () => { throw new Error('private-provider-credential') }
    await assert.rejects(operations.verify)
    assert.equal((await snapshot()).domains[0].last_error, 'Opération du domaine non finalisée. Réessayez ou contactez le support.')
    console.log(JSON.stringify({ ok: true, verified: ['three_current_actor_and_lifecycle_matrices', 'three_membership_row_waits_before_provider', 'current_capability_for_creation_and_verification', 'two_post_audit_trial_rollbacks', 'revocations_during_dns_provider_and_health_waits', 'changed_domain_revision_not_overwritten_or_failed', 'authorized_activation', 'downgrade_still_allows_removal', 'admitted_removal_receipt_survives_later_actor_revocation', 'safe_persisted_failure'], realProviderCalls: 0 }))
  } finally {
    await blocker.query('rollback').catch(() => {}); await blocker.end()
    globalThis.fetch = originalFetch; dns.resolveTxt = originalTxt; syncBuiltinESMExports()
    await db.query('delete from workspaces where id=$1', [workspaceId]); await db.query('delete from auth_organizations where id=$1', [organizationId]); await db.query('delete from auth_users where id=$1', [actor]); await db.end()
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
