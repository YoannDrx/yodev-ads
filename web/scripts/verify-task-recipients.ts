import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { setTimeout } from 'node:timers/promises'
import { Client } from 'pg'
import { eq } from 'drizzle-orm'
import { jobs } from '../src/db/schema'
import { withSystemTransaction } from '../src/db/transactions'
import { deliverPersonalTaskDigest, deliverTaskMention } from '../src/lib/task-notifications'
import type { ClaimedJob } from '../src/lib/jobs'

const url = new URL(process.env.DATABASE_SYSTEM_URL ?? '')
assert(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && url.pathname.startsWith('/yodev_test'), 'Disposable local database required')
process.env.NOTIFICATIONS_ENABLED = '1'
process.env.YODEV_MAIL_API_KEY = 'local-fixture-only'
process.env.YODEV_MAIL_API_URL = 'https://task-recipient-fixture.example.test'
const submissions: Array<{ to: { email: string } }> = []
let ambiguous = false
globalThis.fetch = async (input, init) => {
  assert.equal(String(input), 'https://task-recipient-fixture.example.test/v1/emails')
  submissions.push(JSON.parse(String(init?.body)))
  if (ambiguous) throw new Error('Simulated interrupted provider response')
  return Response.json({ data: { id: randomUUID(), status: 'queued' } }, { status: 202 })
}
const db = new Client({ connectionString: url.href }), blocker = new Client({ connectionString: url.href })
const [workspaceId, organizationId, userId, preferenceId, taskId, commentId, jobId] = Array.from({ length: 7 }, () => randomUUID())
const digestKey = 'daily:2026-09-07'
const operations = { mention: () => deliverTaskMention(commentId, preferenceId), digest: () => deliverPersonalTaskDigest(preferenceId, digestKey) }
async function restore() {
  await db.query("update workspaces set access_state='active',plan='agency',trial_ends_at=null where id=$1", [workspaceId])
  await db.query("insert into auth_members(id,organization_id,user_id,role) values($1,$2,$1,'analyst') on conflict(id) do update set role='analyst'", [userId, organizationId])
  await db.query("update auth_users set email='current@example.test',email_verified=true where id=$1", [userId])
  await db.query("update member_notification_preferences set mention_notifications=true,digest_cadence='daily',last_digest_key=null where id=$1", [preferenceId])
  await db.query('delete from transactional_email_deliveries where workspace_id=$1', [workspaceId])
}
async function waitForClaim() {
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    if ((await db.query("select 1 from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and query like 'insert into%transactional_email_deliveries%'")).rowCount) return
    await setTimeout(20)
  }
  assert.fail('Expected a real transactional delivery INSERT lock wait')
}
async function duringClaim(run: () => Promise<unknown>, mutation: () => Promise<unknown>) {
  const before = submissions.length
  await blocker.query('begin'); await blocker.query('lock table transactional_email_deliveries in share mode')
  const result = Promise.allSettled([run()])
  try { await waitForClaim(); await mutation() } finally { await blocker.query('commit') }
  const [outcome] = await result
  assert.equal(submissions.length, before, 'No provider submission after revocation during claim wait')
  return outcome
}
const changes = {
  removed: () => db.query('delete from auth_members where id=$1', [userId]),
  client: () => db.query("update auth_members set role='client' where id=$1", [userId]),
  unverified: () => db.query('update auth_users set email_verified=false where id=$1', [userId]),
  grace: () => db.query("update workspaces set access_state='grace' where id=$1", [workspaceId]),
  expired: () => db.query("update workspaces set access_state='trial',trial_ends_at=clock_timestamp()-interval '1 second' where id=$1", [workspaceId]),
}
async function main() {
  await db.connect(); await blocker.connect()
  try {
    await db.query("insert into auth_users(id,name,email,email_verified) values($1,'Current member','current@example.test',true)", [userId])
    await db.query('insert into auth_organizations(id,name,slug) values($1::text,$1::text,$1::text)', [organizationId])
    await db.query("insert into workspaces(id,name,slug,auth_organization_id,owner_user_id,plan,access_state) values($1,$2::text,$2::text,$2::text,'different-owner','agency','active')", [workspaceId, organizationId])
    // Intentionally invalid legacy ciphertext: recipients must come from the current verified identity.
    await db.query("insert into member_notification_preferences(id,workspace_id,auth_user_id,mention_handle,display_name,encrypted_email,digest_cadence) values($1,$2,$3,'fixture','Old name','obsolete-ciphertext','daily')", [preferenceId, workspaceId, userId])
    await db.query("insert into workspace_tasks(id,workspace_id,created_by,title,description,assigned_to) values($1,$2,$3,'Private task','Fixture',$3)", [taskId, workspaceId, userId])
    await db.query("insert into task_comments(id,workspace_id,task_id,author_user_id,body,mentions) values($1,$2,$3,$4,'@fixture private comment',array['fixture'])", [commentId, workspaceId, taskId, userId])
    for (const [name, change] of Object.entries(changes)) {
      await restore(); await change()
      for (const run of Object.values(operations)) { const before = submissions.length; assert.deepEqual(await run(), { skipped: true }, name); assert.equal(submissions.length, before) }
    }
    for (const run of Object.values(operations)) {
      await restore(); process.env.NOTIFICATIONS_ENABLED = '0'; assert.deepEqual(await run(), { skipped: true }); process.env.NOTIFICATIONS_ENABLED = '1'
      await restore(); const before = submissions.length
      const result = await run(); assert.equal('accepted' in result && result.accepted, true)
      assert.equal(submissions.length, before + 1); assert.equal(submissions.at(-1)?.to.email, 'current@example.test')
      await run(); assert.equal(submissions.length, before + 1, 'Accepted business keys are not resubmitted')
      for (const change of [...Object.values(changes),
        () => db.query("update auth_users set email='replacement@example.test' where id=$1", [userId]),
        () => db.query("update member_notification_preferences set mention_notifications=false,digest_cadence='none' where id=$1", [preferenceId]),
      ]) {
        await restore(); const outcome = await duringClaim(run, change)
        assert.equal(outcome.status, 'fulfilled'); if (outcome.status === 'fulfilled') assert.deepEqual(outcome.value, { skipped: true })
        assert.equal((await db.query('select status from transactional_email_deliveries where workspace_id=$1', [workspaceId])).rows[0].status, 'failed')
      }
      await restore(); ambiguous = true; await assert.rejects(run, /ambigu/); ambiguous = false
      await duringClaim(run, changes.client)
      assert.equal((await db.query('select status from transactional_email_deliveries where workspace_id=$1', [workspaceId])).rows[0].status, 'ambiguous', 'A prior uncertain send remains to reconcile')
    }
    await restore()
    await db.query("insert into jobs(id,workspace_id,type,status,payload,deduplication_key,lease_owner,lease_expires_at,attempt_count) values($1::uuid,$2,'task.mention_deliver','running',$3::jsonb,$1::text,'fixture-worker',clock_timestamp()+interval '1 hour',1)", [jobId, workspaceId, JSON.stringify({ preferenceId, commentId })])
    const job = await withSystemTransaction((tx) => tx.query.jobs.findFirst({ where: eq(jobs.id, jobId) })) as ClaimedJob
    for (const wrong of [{ ...job, workspaceId: randomUUID() }, { ...job, attemptCount: 2 }, { ...job, leaseOwner: 'other-worker' }, { ...job, payload: { ...job.payload, commentId: randomUUID() } }]) {
      const before = submissions.length; await assert.rejects(() => deliverTaskMention(commentId, preferenceId, wrong)); assert.equal(submissions.length, before)
    }
    const outcome = await duringClaim(() => deliverTaskMention(commentId, preferenceId, job), () => db.query("update jobs set lease_expires_at=clock_timestamp()-interval '1 second' where id=$1", [jobId]))
    assert.equal(outcome.status, 'rejected')
    assert.equal((await db.query('select status from transactional_email_deliveries where workspace_id=$1', [workspaceId])).rows[0].status, 'pending')
    assert.equal((await db.query("select has_table_privilege('yodev_system','auth_users','UPDATE') as allowed")).rows[0].allowed, false)
    console.log(JSON.stringify({ ok: true, verified: ['current_verified_mailbox', 'both_recipient_denial_matrices', 'fourteen_revocations_during_delivery_claim_wait', 'two_ambiguous_attempts_preserved', 'accepted_keys_not_resubmitted', 'job_workspace_payload_lease_attempt_fencing', 'expired_lease_after_claim_no_submission', 'auth_identity_role_remains_read_only'], simulatedSubmissions: submissions.length, realProviderCalls: 0 }))
  } finally {
    await blocker.query('rollback').catch(() => {}); await blocker.end()
    await db.query('delete from transactional_email_deliveries where workspace_id=$1', [workspaceId])
    await db.query('delete from workspaces where id=$1', [workspaceId]); await db.query('delete from auth_organizations where id=$1', [organizationId])
    await db.query('delete from auth_users where id=$1', [userId]); await db.end()
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
