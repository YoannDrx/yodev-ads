import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { setTimeout } from 'node:timers/promises'
import { Client } from 'pg'
import { runWorkspaceExternalCleanup } from '../src/lib/workspace-deletion'
import { domainCleanupProviderScope } from '../src/lib/domain-cleanup-receipts'
import { hashToken } from '../src/lib/tokens'
import type { ClaimedJob } from '../src/lib/jobs'

const url = new URL(process.env.DATABASE_SYSTEM_URL ?? '')
assert(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && url.pathname.startsWith('/yodev_test'), 'Disposable local database required')
const db = new Client({ connectionString: url.href })
const jobId = randomUUID(), workspaceHash = hashToken(`cleanup-receipts:${jobId}`)
const input = { workspaceHash, logoUrl: null, hostnames: [`first-${jobId}.example.test`, `second-${jobId}.example.test`] }
const claimed = { id: jobId, workspaceId: null, type: 'workspace.external_cleanup', leaseOwner: 'first-worker', attemptCount: 1 } as ClaimedJob
const originalFetch = globalThis.fetch
let calls = 0, onFetch: (() => Promise<Response>) | undefined
process.env.VERCEL_API_TOKEN = 'local-fixture-only'; process.env.VERCEL_PROJECT_ID = 'local-fixture-project'
globalThis.fetch = async (address, init) => {
  assert(String(address).startsWith('https://api.vercel.com/')); assert.equal(init?.method, 'DELETE')
  calls++; return await onFetch?.() ?? Response.json('removed')
}
async function reset() {
  calls = 0; onFetch = undefined
  await db.query('delete from domain_cleanup_attempts where job_id=$1', [jobId])
  await db.query("update jobs set status='running',lease_owner='first-worker',attempt_count=1,lease_expires_at=clock_timestamp()+interval '1 minute' where id=$1", [jobId])
  await db.query("update workspace_deletion_tombstones set external_cleanup_status='pending',external_cleanup_completed_at=null,external_cleanup_error=null where workspace_hash=$1", [workspaceHash])
}
async function nextAttempt() {
  await db.query("update jobs set lease_owner='successor',attempt_count=2,lease_expires_at=clock_timestamp()+interval '1 minute' where id=$1", [jobId])
  return { ...claimed, leaseOwner: 'successor', attemptCount: 2 }
}
async function attempts() { return (await db.query('select hostname,job_attempt,state,already_absent,finished_at from domain_cleanup_attempts where job_id=$1 order by job_attempt,hostname', [jobId])).rows }
async function waitUntil(predicate: () => boolean) {
  const until = Date.now() + 5_000
  while (!predicate() && Date.now() < until) await setTimeout(10)
  assert(predicate(), 'Expected provider barrier')
}
async function main() {
  await db.connect()
  try {
    await db.query("insert into jobs(id,type,payload,deduplication_key,status,lease_owner,attempt_count,lease_expires_at) values($1,'workspace.external_cleanup',$2,$3,'running','first-worker',1,clock_timestamp()+interval '1 minute')", [jobId, JSON.stringify(input), `workspace.external_cleanup:${workspaceHash}`])
    await db.query("insert into workspace_deletion_tombstones(workspace_hash,deletion_requested_at,retain_until) values($1,clock_timestamp(),clock_timestamp()+interval '1 day')", [workspaceHash])
    for (const hostname of input.hostnames) await db.query('insert into workspace_domain_cleanup_reservations(hostname,workspace_hash) values($1,$2)', [hostname, workspaceHash])

    onFetch = async () => calls === 2 ? Response.json({ error: { code: 'error', message: 'private provider detail' } }, { status: 500 }) : Response.json('removed')
    await assert.rejects(() => runWorkspaceExternalCleanup(input, claimed))
    assert.deepEqual((await attempts()).map((row) => row.state), ['confirmed', 'ambiguous']); assert.equal(calls, 2)
    for (const name of ['VERCEL_PROJECT_ID', 'VERCEL_TEAM_ID']) {
      const previous = process.env[name]; process.env[name] = 'changed-provider-scope'
      try { await assert.rejects(async () => runWorkspaceExternalCleanup(input, await nextAttempt()), /configuration changed/) }
      finally { if (previous === undefined) delete process.env[name]; else process.env[name] = previous }
      assert.equal(calls, 2, 'A different provider target cannot reuse the receipt or receive a DELETE')
    }
    onFetch = undefined; await runWorkspaceExternalCleanup(input, await nextAttempt())
    assert.equal(calls, 3, 'Retry must not remove the first domain again')
    assert.deepEqual((await attempts()).map((row) => row.state), ['confirmed', 'ambiguous', 'confirmed'])
    assert.equal((await db.query('select 1 from workspace_domain_cleanup_reservations where workspace_hash=$1 and released_at is null', [workspaceHash])).rowCount, 2)

    await reset()
    onFetch = async () => {
      if (calls === 2) {
        await nextAttempt()
        await db.query("update workspace_deletion_tombstones set external_cleanup_status='pending' where workspace_hash=$1", [workspaceHash])
      }
      return Response.json('removed')
    }
    await assert.rejects(() => runWorkspaceExternalCleanup(input, claimed), /lease lost/)
    assert.deepEqual((await attempts()).map((row) => row.state), ['confirmed', 'confirmed'])
    onFetch = undefined; await runWorkspaceExternalCleanup(input, { ...claimed, leaseOwner: 'successor', attemptCount: 2 })
    assert.equal(calls, 2, 'Late admitted confirmations should be reusable by the successor')

    await reset()
    let release!: () => void
    const barrier = new Promise<void>((resolve) => { release = resolve })
    onFetch = async () => { if (calls === 1) await barrier; return Response.json('removed') }
    const first = Promise.allSettled([runWorkspaceExternalCleanup(input, claimed)])
    try {
      await waitUntil(() => calls === 1)
      await assert.rejects(() => runWorkspaceExternalCleanup(input, claimed), /already recorded/)
      assert.equal(calls, 1)
    } finally { release() }
    assert.equal((await first)[0].status, 'fulfilled'); assert.equal(calls, 2)
    assert.deepEqual((await attempts()).map((row) => row.state), ['confirmed', 'confirmed'])

    await reset(); delete process.env.VERCEL_API_TOKEN; delete process.env.VERCEL_PROJECT_ID
    try { await assert.rejects(() => runWorkspaceExternalCleanup(input, claimed), /VERCEL_API_TOKEN/) }
    finally { process.env.VERCEL_API_TOKEN = 'local-fixture-only'; process.env.VERCEL_PROJECT_ID = 'local-fixture-project' }
    assert.equal(calls, 0); assert.deepEqual((await attempts()).map((row) => row.state), ['not_submitted'])
    await runWorkspaceExternalCleanup(input, await nextAttempt())
    assert.equal(calls, 2); assert.deepEqual((await attempts()).map((row) => row.state), ['not_submitted', 'confirmed', 'confirmed'])

    // Reproduce durable state left by an interrupted process before a receipt exists.
    await reset()
    await db.query("insert into domain_cleanup_attempts(hostname,workspace_hash,job_id,job_attempt,lease_owner,provider_scope_hash) values($1,$2,$3,1,'first-worker',$4)", [input.hostnames[0], workspaceHash, jobId, domainCleanupProviderScope()])
    await assert.rejects(() => runWorkspaceExternalCleanup(input, claimed), /already recorded/)
    assert.equal(calls, 0); assert.equal((await attempts())[0].state, 'submitting')
    await runWorkspaceExternalCleanup(input, await nextAttempt())
    assert.equal(calls, 2); assert.deepEqual((await attempts()).map((row) => row.state), ['submitting', 'confirmed', 'confirmed'])

    await reset()
    await db.query("create function public.fixture_domain_receipt_failure() returns trigger language plpgsql as $$ begin raise exception 'fixture receipt persistence failure'; end $$")
    await db.query(`create trigger fixture_domain_receipt_failure before update on domain_cleanup_attempts for each row when (new.workspace_hash='${workspaceHash}' and new.state='confirmed') execute function public.fixture_domain_receipt_failure()`)
    await assert.rejects(() => runWorkspaceExternalCleanup(input, claimed))
    assert.equal(calls, 1); assert.equal((await attempts())[0].state, 'submitting')
    await db.query('drop trigger fixture_domain_receipt_failure on domain_cleanup_attempts'); await db.query('drop function public.fixture_domain_receipt_failure()')
    await runWorkspaceExternalCleanup(input, await nextAttempt())
    assert.equal(calls, 3); assert.equal((await attempts())[0].state, 'submitting')
    await assert.rejects(() => db.query("update domain_cleanup_attempts set state='ambiguous',already_absent=null where job_id=$1 and state='confirmed'", [jobId]), (error: unknown) => (error as { code?: string }).code === '22023')
    await assert.rejects(() => db.query("update domain_cleanup_attempts set lease_owner='different' where job_id=$1 and state='submitting'", [jobId]), (error: unknown) => (error as { code?: string }).code === '22023')
    const beforeRetention = await attempts(); await db.query('delete from jobs where id=$1', [jobId]); assert.deepEqual(await attempts(), beforeRetention)
    const privileges = (await db.query("select has_table_privilege('yodev_app','domain_cleanup_attempts','SELECT') as read,has_table_privilege('yodev_app','domain_cleanup_attempts','UPDATE') as update,has_table_privilege('yodev_system','domain_cleanup_attempts','DELETE') as delete")).rows[0]
    assert.deepEqual(privileges, { read: false, update: false, delete: false })
    console.log(JSON.stringify({ ok: true, verified: ['partial_success_retry_skips_confirmed_domain', 'changed_project_or_team_denies_reuse_and_transport', 'ambiguity_survives_later_success', 'late_admitted_response_recorded_after_lease_loss', 'same_attempt_concurrency_submits_once', 'pre_dispatch_refusal_is_not_submitted', 'unsubmitted_attempt_allows_corrected_provider_configuration', 'seeded_interruption_stays_unresolved', 'failed_receipt_persistence_stays_unresolved', 'terminal_receipt_and_identity_immutable', 'evidence_survives_job_retention', 'private_receipt_privileges'], realProviderCalls: 0 }))
  } finally {
    globalThis.fetch = originalFetch
    await db.query('drop trigger if exists fixture_domain_receipt_failure on domain_cleanup_attempts'); await db.query('drop function if exists public.fixture_domain_receipt_failure()')
    await db.query('delete from domain_cleanup_attempts where job_id=$1', [jobId]); await db.query('delete from jobs where id=$1', [jobId])
    await db.query('delete from workspace_domain_cleanup_reservations where workspace_hash=$1', [workspaceHash]); await db.query('delete from workspace_deletion_tombstones where workspace_hash=$1', [workspaceHash]); await db.end()
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
