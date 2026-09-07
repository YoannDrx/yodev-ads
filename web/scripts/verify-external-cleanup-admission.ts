import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { setTimeout } from 'node:timers/promises'
import { Client } from 'pg'
import type { ClaimedJob } from '../src/lib/jobs'
import { runWorkspaceExternalCleanup } from '../src/lib/workspace-deletion'
import { hashToken } from '../src/lib/tokens'

const url = new URL(process.env.DATABASE_SYSTEM_URL ?? '')
assert(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && url.pathname.startsWith('/yodev_test'), 'Disposable local database required')
const db = new Client({ connectionString: url.href }), blocker = new Client({ connectionString: url.href })
const jobId = randomUUID(), workspaceHash = hashToken(`cleanup-admission:${jobId}`)
const input = { workspaceHash, logoUrl: null, hostnames: [`cleanup-${jobId}.example.test`, `second-${jobId}.example.test`] }
const claimed = { id: jobId, workspaceId: null, type: 'workspace.external_cleanup', leaseOwner: 'first-worker', attemptCount: 1 } as ClaimedJob
const originalFetch = globalThis.fetch
const calls: string[] = []
let onFetch: (() => Promise<Response | undefined>) | undefined
process.env.VERCEL_API_TOKEN = 'local-fixture-only'; process.env.VERCEL_PROJECT_ID = 'local-fixture-project'
globalThis.fetch = async (address, init) => {
  assert(String(address).startsWith('https://api.vercel.com/'), 'Unexpected provider URL')
  calls.push(`${init?.method ?? 'GET'} ${address}`)
  return await onFetch?.() ?? Response.json('removed')
}
async function reset() {
  await db.query('delete from domain_cleanup_attempts where job_id=$1', [jobId])
  calls.length = 0; onFetch = undefined
  await db.query("update jobs set type='workspace.external_cleanup',status='running',lease_owner='first-worker',attempt_count=1,lease_expires_at=clock_timestamp()+interval '1 minute',payload=$2,deduplication_key=$3 where id=$1", [jobId, JSON.stringify(input), `workspace.external_cleanup:${workspaceHash}`])
  await db.query("update workspace_deletion_tombstones set external_cleanup_status='pending',external_cleanup_error=null,external_cleanup_completed_at=null where workspace_hash=$1", [workspaceHash])
}
async function receipt() { return (await db.query('select external_cleanup_status,external_cleanup_error,external_cleanup_completed_at from workspace_deletion_tombstones where workspace_hash=$1', [workspaceHash])).rows[0] }
async function waitFor(pattern: string) {
  const until = Date.now() + 5_000
  while (Date.now() < until) {
    if ((await db.query("select 1 from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and query like $1", [pattern])).rowCount) return
    await setTimeout(20)
  }
  assert.fail(`Expected PostgreSQL lock wait: ${pattern}`)
}
async function waitForExpiry() {
  const until = Date.now() + 5_000
  while (Date.now() < until) {
    if ((await db.query('select lease_expires_at<=clock_timestamp() as expired from jobs where id=$1', [jobId])).rows[0].expired) return
    await setTimeout(20)
  }
  assert.fail('Expected lease expiry')
}
async function deny() {
  const before = await receipt()
  await assert.rejects(() => runWorkspaceExternalCleanup(input, claimed))
  assert.deepEqual(await receipt(), before); assert.equal(calls.length, 0)
}
async function main() {
  await db.connect(); await blocker.connect()
  try {
    await db.query("insert into jobs(id,workspace_id,type,status,lease_owner,lease_expires_at,attempt_count,payload,deduplication_key) values($1,null,'workspace.external_cleanup','running','first-worker',clock_timestamp()+interval '1 minute',1,$2,$3)", [jobId, JSON.stringify(input), `workspace.external_cleanup:${workspaceHash}`])
    await db.query("insert into workspace_deletion_tombstones(workspace_hash,deletion_requested_at,retain_until) values($1,clock_timestamp(),clock_timestamp()+interval '1 day')", [workspaceHash])
    for (const hostname of input.hostnames) await db.query('insert into workspace_domain_cleanup_reservations(hostname,workspace_hash) values($1,$2) on conflict do nothing', [hostname, workspaceHash])
    for (const assignment of ["status='pending'", "lease_owner='successor'", 'attempt_count=2', "type='workspace.purge'", "lease_expires_at=clock_timestamp()-interval '1 second'", "deduplication_key='wrong-cleanup'"]) {
      await reset(); await db.query(`update jobs set ${assignment} where id=$1`, [jobId]); await deny()
    }
    for (const payload of [{ ...input, workspaceHash: 'f'.repeat(64) }, { ...input, hostnames: ['foreign.example.test'] }, { ...input, logoUrl: 'https://foreign.example.test/logo.png' }]) {
      await reset(); await db.query('update jobs set payload=$2 where id=$1', [jobId, JSON.stringify(payload)]); await deny()
    }
    await reset(); await db.query('delete from workspace_deletion_tombstones where workspace_hash=$1', [workspaceHash]); await deny()
    await db.query("insert into workspace_deletion_tombstones(workspace_hash,deletion_requested_at,retain_until) values($1,clock_timestamp(),clock_timestamp()+interval '1 day')", [workspaceHash])

    await reset(); await db.query("update workspace_deletion_tombstones set external_cleanup_status='completed' where workspace_hash=$1", [workspaceHash]); await deny()
    await reset(); await db.query('delete from workspace_domain_cleanup_reservations where hostname=$1 and workspace_hash=$2', [input.hostnames[0], workspaceHash]); await deny()
    await db.query('insert into workspace_domain_cleanup_reservations(hostname,workspace_hash,released_at) values($1,$2,clock_timestamp())', [input.hostnames[0], workspaceHash]); await deny()
    await db.query('update workspace_domain_cleanup_reservations set released_at=null where hostname=$1 and workspace_hash=$2', [input.hostnames[0], workspaceHash])

    await reset()
    await blocker.query('begin'); await blocker.query("update jobs set lease_owner='successor',attempt_count=2 where id=$1", [jobId])
    const jobWait = Promise.allSettled([runWorkspaceExternalCleanup(input, claimed)])
    try { await waitFor('select%from "jobs"%for update') } finally { await blocker.query('commit') }
    assert.equal((await jobWait)[0].status, 'rejected'); assert.equal(calls.length, 0); assert.equal((await receipt()).external_cleanup_status, 'pending')

    await reset(); await db.query("update jobs set lease_expires_at=clock_timestamp()+interval '1 second' where id=$1", [jobId])
    await blocker.query('begin'); await blocker.query('select * from workspace_deletion_tombstones where workspace_hash=$1 for update', [workspaceHash])
    const tombstoneWait = Promise.allSettled([runWorkspaceExternalCleanup(input, claimed)])
    try { await waitFor('select%from "workspace_deletion_tombstones"%for update'); await waitForExpiry() } finally { await blocker.query('commit') }
    assert.equal((await tombstoneWait)[0].status, 'rejected'); assert.equal(calls.length, 0); assert.equal((await receipt()).external_cleanup_status, 'pending')

    await reset(); await db.query("update jobs set lease_expires_at=clock_timestamp()+interval '1 second' where id=$1", [jobId])
    await blocker.query('begin'); await blocker.query('select * from workspace_domain_cleanup_reservations where workspace_hash=$1 for update', [workspaceHash])
    const reservationWait = Promise.allSettled([runWorkspaceExternalCleanup(input, claimed)])
    try { await waitFor('select%from "workspace_domain_cleanup_reservations"%for update'); await waitForExpiry() } finally { await blocker.query('commit') }
    assert.equal((await reservationWait)[0].status, 'rejected'); assert.equal(calls.length, 0); assert.equal((await receipt()).external_cleanup_status, 'pending')

    await reset()
    onFetch = async () => {
      await db.query("update jobs set lease_owner='successor',attempt_count=2 where id=$1", [jobId])
      await db.query("update workspace_deletion_tombstones set external_cleanup_status='completed',external_cleanup_completed_at=clock_timestamp() where workspace_hash=$1", [workspaceHash])
      return Response.json('removed')
    }
    await assert.rejects(() => runWorkspaceExternalCleanup(input, claimed), /lease lost/)
    assert.equal(calls.length, 1); const successor = await receipt(); assert.equal(successor.external_cleanup_status, 'completed')
    onFetch = undefined
    await assert.rejects(() => runWorkspaceExternalCleanup(input, claimed), /lease lost/)
    assert.deepEqual(await receipt(), successor)
    const replay = await runWorkspaceExternalCleanup(input, { ...claimed, leaseOwner: 'successor', attemptCount: 2 })
    assert('skipped' in replay)
    assert.equal(replay.skipped, 'already_completed'); assert.equal(calls.length, 1)

    await reset()
    onFetch = async () => {
      await db.query("update jobs set lease_expires_at=clock_timestamp()-interval '1 second' where id=$1", [jobId])
      return Response.json({ error: { code: 'not_found' } }, { status: 404 })
    }
    await assert.rejects(() => runWorkspaceExternalCleanup(input, claimed), /lease lost/)
    assert.equal(calls.length, 1); assert.equal((await receipt()).external_cleanup_status, 'running')

    // Hold an AFTER UPDATE trigger so completion/failure must recheck the clock after writing.
    await db.query(`create or replace function public.fixture_cleanup_receipt_wait() returns trigger language plpgsql as $$ begin perform pg_advisory_xact_lock(5545501); return new; end $$`)
    await db.query(`create trigger fixture_cleanup_receipt_wait after update on workspace_deletion_tombstones for each row when (new.workspace_hash='${workspaceHash}' and new.external_cleanup_status in ('completed','failed')) execute function public.fixture_cleanup_receipt_wait()`)
    for (const fail of [false, true]) {
      await reset(); await db.query("update jobs set lease_expires_at=clock_timestamp()+interval '1 second' where id=$1", [jobId])
      if (fail) onFetch = async () => Response.json({ error: { code: 'forbidden' } }, { status: 403 })
      await blocker.query('begin'); await blocker.query('select pg_advisory_xact_lock(5545501)')
      const pending = Promise.allSettled([runWorkspaceExternalCleanup(input, claimed)])
      try { await waitFor('update "workspace_deletion_tombstones"%'); await waitForExpiry() } finally { await blocker.query('commit') }
      assert.equal((await pending)[0].status, 'rejected')
      const result = await receipt(); assert.equal(result.external_cleanup_status, 'running'); assert.equal(result.external_cleanup_completed_at, null); assert.equal(result.external_cleanup_error, null)
    }
    await db.query('drop trigger fixture_cleanup_receipt_wait on workspace_deletion_tombstones'); await db.query('drop function public.fixture_cleanup_receipt_wait()')
    await reset()
    await runWorkspaceExternalCleanup(input, claimed)
    assert.equal(calls.length, 2); const completed = await receipt(); assert.equal(completed.external_cleanup_status, 'completed'); assert(completed.external_cleanup_completed_at)
    await runWorkspaceExternalCleanup(input, claimed); assert.equal(calls.length, 2); assert.deepEqual(await receipt(), completed)
    console.log(JSON.stringify({ ok: true, verified: ['nine_job_and_payload_denials', 'missing_tombstone_and_incomplete_receipt_denied', 'missing_or_released_reservation_denied', 'reservation_wait_rechecks_expiry', 'job_row_wait_rechecks_attempt', 'tombstone_wait_rechecks_expiry', 'successor_receipt_not_overwritten', 'expired_attempt_stops_404_followup', 'two_post_write_expiry_rollbacks', 'confirmed_receipt_replay_without_provider'], realProviderCalls: 0 }))
  } finally {
    await blocker.query('rollback').catch(() => {}); await blocker.end(); globalThis.fetch = originalFetch
    await db.query('drop trigger if exists fixture_cleanup_receipt_wait on workspace_deletion_tombstones'); await db.query('drop function if exists public.fixture_cleanup_receipt_wait()')
    await db.query('delete from workspace_domain_cleanup_reservations where workspace_hash=$1', [workspaceHash])
    await db.query('delete from domain_cleanup_attempts where job_id=$1', [jobId])
    await db.query('delete from jobs where id=$1', [jobId]); await db.query('delete from workspace_deletion_tombstones where workspace_hash=$1', [workspaceHash]); await db.end()
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
