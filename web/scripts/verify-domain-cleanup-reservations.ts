import assert from 'node:assert/strict'
import { createHmac, randomUUID } from 'node:crypto'
import { setTimeout } from 'node:timers/promises'
import { Client } from 'pg'
import { sql } from 'drizzle-orm'
import { withTenantTransaction } from '../src/db/transactions'
import { createWorkspaceCustomDomain } from '../src/lib/workspace-domain-management'
import { purgeWorkspace, runWorkspaceExternalCleanup } from '../src/lib/workspace-deletion'
import type { ClaimedJob } from '../src/lib/jobs'

const url = new URL(process.env.DATABASE_SYSTEM_URL ?? '')
assert(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && url.pathname.startsWith('/yodev_test'), 'Disposable local database required')
const db = new Client({ connectionString: url.href }), blocker = new Client({ connectionString: url.href })
const original = randomUUID(), target = randomUUID(), actor = randomUUID(), organization = randomUUID()
const hostname = `purge-${original}.example.test`, otherHostname = `assigned-${target}.example.test`
const key = process.env.DELETION_TOMBSTONE_KEY ?? process.env.APP_ENCRYPTION_KEY!
const hash = createHmac('sha256', key).update(original).digest('hex')
const extraJobId = randomUUID(), extraHash = createHmac('sha256', key).update(extraJobId).digest('hex')
let providerCalls = 0
const originalFetch = globalThis.fetch
process.env.VERCEL_API_TOKEN = 'local-fixture-only'; process.env.VERCEL_PROJECT_ID = 'local-fixture-project'
globalThis.fetch = async (address) => { assert(String(address).startsWith('https://api.vercel.com/')); providerCalls++; return Response.json('removed') }
const create = () => createWorkspaceCustomDomain({ workspaceId: target, actorUserId: actor, hostname, token: randomUUID() })
async function waitFor(pattern: string) {
  const until = Date.now() + 5_000
  while (Date.now() < until) {
    if ((await db.query("select 1 from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and query like $1", [pattern])).rowCount) return
    await setTimeout(20)
  }
  assert.fail(`Expected PostgreSQL lock wait: ${pattern}`)
}
async function main() {
  await db.connect(); await blocker.connect()
  try {
    await db.query('insert into auth_users(id,name,email,email_verified) values($1,$1,$2,true)', [actor, `${actor}@example.test`])
    await db.query('insert into auth_organizations(id,name,slug) values($1::text,$1::text,$1::text)', [organization])
    await db.query("insert into workspaces(id,name,slug,owner_user_id,plan,access_state,auth_organization_id) values($1::uuid,'original',$1::text,'fixture','agency','deletion_pending',null),($2::uuid,'target',$2::text,$3,'agency','active',$4)", [original, target, actor, organization])
    await db.query("insert into auth_members(id,organization_id,user_id,role) values($1,$2,$1,'owner')", [actor, organization])
    await db.query("insert into deletion_requests(workspace_id,requested_by,previous_access_state,purge_at) values($1,'fixture','active',clock_timestamp()-interval '1 day')", [original])
    await db.query("insert into workspace_domains(workspace_id,hostname,dns_token_hash) values($1,$2,repeat('a',64))", [original, hostname])

    // A failed purge must not leave reservations or a cleanup job outside the rolled-back transaction.
    await db.query("create function public.fixture_domain_purge_wait() returns trigger language plpgsql as $$ begin raise exception 'fixture purge rollback'; end $$")
    await db.query(`create trigger fixture_domain_purge_wait before delete on workspaces for each row when (old.id='${original}') execute function public.fixture_domain_purge_wait()`)
    await assert.rejects(() => purgeWorkspace(original))
    assert.equal((await db.query('select 1 from workspace_domain_cleanup_reservations where workspace_hash=$1', [hash])).rowCount, 0)
    assert.equal((await db.query('select 1 from workspace_deletion_tombstones where workspace_hash=$1', [hash])).rowCount, 0)
    assert.equal((await db.query("select 1 from jobs where deduplication_key=$1", [`workspace.external_cleanup:${hash}`])).rowCount, 0)
    assert.equal((await db.query('select 1 from workspaces where id=$1', [original])).rowCount, 1)

    // A later purge of a restored workspace must re-arm an earlier released reservation.
    await db.query('insert into workspace_domain_cleanup_reservations(hostname,workspace_hash,released_at) values($1,$2,clock_timestamp())', [hostname, hash])
    await db.query('create or replace function public.fixture_domain_purge_wait() returns trigger language plpgsql as $$ begin perform pg_advisory_xact_lock(5545601); return old; end $$')
    await blocker.query('begin'); await blocker.query('select pg_advisory_xact_lock(5545601)')
    const purge = Promise.allSettled([purgeWorkspace(original)])
    let creation: ReturnType<typeof Promise.allSettled> | undefined
    try {
      await waitFor('delete from "workspaces"%')
      creation = Promise.allSettled([create()])
      await waitFor('insert into "workspace_domains"%')
    } finally { await blocker.query('commit') }
    assert.equal((await purge)[0].status, 'fulfilled')
    const refused = (await creation!)[0]; assert.equal(refused.status, 'rejected')
    if (refused.status === 'rejected') assert.equal(refused.reason.message, 'Ce domaine reste réservé pendant son nettoyage. Contactez le support.')
    assert.equal((await db.query('select 1 from workspace_domains where workspace_id=$1', [target])).rowCount, 0)
    assert.equal((await db.query('select 1 from secret_revelations where workspace_id=$1', [target])).rowCount, 0)
    assert.equal((await db.query('select 1 from audit_events where workspace_id=$1', [target])).rowCount, 0)
    assert.equal((await db.query('select 1 from workspace_domain_cleanup_reservations where workspace_hash=$1 and released_at is null', [hash])).rowCount, 1)
    assert.equal(providerCalls, 0)
    await db.query('drop trigger fixture_domain_purge_wait on workspaces'); await db.query('drop function public.fixture_domain_purge_wait()')

    const queued = (await db.query('select id,payload from jobs where deduplication_key=$1', [`workspace.external_cleanup:${hash}`])).rows[0]
    await db.query("update jobs set status='running',lease_owner='reservation-fixture',attempt_count=1,lease_expires_at=clock_timestamp()+interval '1 minute' where id=$1", [queued.id])
    const claimed = { id: queued.id, workspaceId: null, type: 'workspace.external_cleanup', leaseOwner: 'reservation-fixture', attemptCount: 1 } as ClaimedJob
    await runWorkspaceExternalCleanup(queued.payload, claimed); assert.equal(providerCalls, 1)
    await db.query('delete from jobs where id=$1', [queued.id])
    await assert.rejects(create, /reste réservé/)
    assert.equal((await db.query('select 1 from workspace_domain_cleanup_reservations where workspace_hash=$1 and released_at is null', [hash])).rowCount, 1)

    // Legacy overlap: a hostname may already have been reassigned before this migration.
    await db.query("insert into workspace_domains(workspace_id,hostname,dns_token_hash) values($1,$2,repeat('a',64))", [target, otherHostname])
    await db.query('insert into workspace_domain_cleanup_reservations(hostname,workspace_hash) values($1,$2)', [otherHostname, extraHash])
    const payload = { workspaceHash: extraHash, logoUrl: null, hostnames: [otherHostname] }
    await db.query("insert into workspace_deletion_tombstones(workspace_hash,deletion_requested_at,retain_until) values($1,clock_timestamp(),clock_timestamp()+interval '1 day')", [extraHash])
    await db.query("insert into jobs(id,type,payload,deduplication_key,status,lease_owner,attempt_count,lease_expires_at) values($1,'workspace.external_cleanup',$2,$3,'running','reservation-fixture',1,clock_timestamp()+interval '1 minute')", [extraJobId, JSON.stringify(payload), `workspace.external_cleanup:${extraHash}`])
    await assert.rejects(() => runWorkspaceExternalCleanup(payload, { ...claimed, id: extraJobId }), /assigned/)
    assert.equal(providerCalls, 1)
    assert.equal((await db.query('select 1 from workspace_domains where hostname=$1', [otherHostname])).rowCount, 1)

    const privileges = (await db.query("select has_table_privilege('yodev_app','workspace_domain_cleanup_reservations','SELECT') as read,has_table_privilege('yodev_app','workspace_domain_cleanup_reservations','INSERT') as insert,has_table_privilege('yodev_app','workspace_domain_cleanup_reservations','UPDATE') as update,has_table_privilege('yodev_app','workspace_domain_cleanup_reservations','DELETE') as delete")).rows[0]
    assert.deepEqual(privileges, { read: false, insert: false, update: false, delete: false })
    await assert.rejects(() => withTenantTransaction({ workspaceId: target, userId: actor }, (tx) => tx.execute(sql`select * from workspace_domain_cleanup_reservations`)))
    await assert.rejects(() => withTenantTransaction({ workspaceId: target, userId: actor }, (tx) => tx.execute(sql`insert into workspace_domains(workspace_id,hostname,dns_token_hash) values(${target}::uuid,${hostname.toUpperCase()},${'a'.repeat(64)})`)))
    console.log(JSON.stringify({ ok: true, verified: ['purge_reservation_rollback_atomic', 'released_reservation_rearmed_by_purge', 'creation_waits_for_purge_then_is_denied', 'no_denied_domain_revelation_or_audit', 'reservation_survives_cleanup_and_job_retention', 'legacy_assigned_hostname_denies_cleanup', 'tenant_sql_cannot_read_or_release_reservations', 'noncanonical_hostname_cannot_bypass_guard'], realProviderCalls: 0 }))
  } finally {
    await blocker.query('rollback').catch(() => {}); await blocker.end(); globalThis.fetch = originalFetch
    await db.query('drop trigger if exists fixture_domain_purge_wait on workspaces'); await db.query('drop function if exists public.fixture_domain_purge_wait()')
    await db.query('delete from jobs where deduplication_key=any($1::text[])', [[`workspace.external_cleanup:${hash}`, `workspace.external_cleanup:${extraHash}`]])
    await db.query('delete from workspace_domain_cleanup_reservations where workspace_hash=any($1::text[])', [[hash, extraHash]])
    await db.query('delete from workspace_deletion_tombstones where workspace_hash=any($1::text[])', [[hash, extraHash]])
    await db.query('delete from workspaces where id=any($1::uuid[])', [[original, target]])
    await db.query('delete from auth_organizations where id=$1', [organization]); await db.query('delete from auth_users where id=$1', [actor]); await db.end()
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
