import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { setTimeout } from 'node:timers/promises'
import { Client } from 'pg'
import { eq } from 'drizzle-orm'
import { jobs } from '../src/db/schema'
import { withSystemTransaction } from '../src/db/transactions'
import { deliverScheduledReport } from '../src/lib/scheduled-reports'
import { encryptSecret } from '../src/lib/crypto'
import { hashToken } from '../src/lib/tokens'
import type { ClaimedJob } from '../src/lib/jobs'

const url = new URL(process.env.DATABASE_SYSTEM_URL ?? '')
assert(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && url.pathname.startsWith('/yodev_test'), 'Disposable local database required')
const db = new Client({ connectionString: url.href }), blocker = new Client({ connectionString: url.href })
const workspaceId = randomUUID(), clientId = randomUUID()
const originalFetch = globalThis.fetch
process.env.NOTIFICATIONS_ENABLED = '1'
process.env.YODEV_MAIL_API_KEY = 'local-fixture-only'
process.env.YODEV_MAIL_API_URL = 'https://report-admission-fixture.example.test'
let submissions = 0, ambiguous = false
let onSubmit: (() => Promise<void>) | undefined
const verified: string[] = []
globalThis.fetch = async (input, init) => {
  assert.equal(String(input), 'https://report-admission-fixture.example.test/v1/emails')
  const body = JSON.parse(String(init?.body))
  assert.equal(body.to.email, 'original@example.test')
  assert(body.content.html.includes('?edition='))
  submissions++
  await onSubmit?.()
  if (ambiguous) throw new Error('Simulated interrupted response')
  return Response.json({ data: { id: randomUUID(), status: 'queued' } }, { status: 202 })
}
async function fixture() {
  process.env.NOTIFICATIONS_ENABLED = '1'
  await db.query("update workspaces set access_state='active',plan='agency',trial_ends_at=null where id=$1", [workspaceId])
  await db.query('update clients set active=true,is_manager=false where id=$1', [clientId])
  const shareId = randomUUID(), scheduleId = randomUUID(), jobId = randomUUID(), token = randomUUID()
  await db.query("insert into share_links(id,workspace_id,client_id,created_by,label,mode,period_days,token_hash,token_prefix,encrypted_report_token,expires_at) values($1,$2,$3,'fixture','Admission report','fixed',7,$4,$5,$6,clock_timestamp()+interval '90 days')", [shareId, workspaceId, clientId, hashToken(token), token.slice(0, 12), encryptSecret(token)])
  await db.query("insert into report_schedules(id,workspace_id,client_id,share_id,created_by,name,cadence,schedule_weekday,recipient_emails,encrypted_report_token) values($1,$2,$3,$4,'fixture','Admission report','weekly',1,array['original@example.test'],$5)", [scheduleId, workspaceId, clientId, shareId, encryptSecret(token)])
  const runKey = `weekly:${new Date().toISOString().slice(0, 10)}`
  await db.query("insert into jobs(id,workspace_id,type,status,payload,lease_owner,lease_expires_at,attempt_count) values($1,$2,'report.schedule_deliver','running',$3,'fixture-worker',clock_timestamp()+interval '1 hour',1)", [jobId, workspaceId, JSON.stringify({ scheduleId, runKey })])
  const job = await withSystemTransaction((tx) => tx.query.jobs.findFirst({ where: eq(jobs.id, jobId) })) as ClaimedJob
  return { shareId, scheduleId, jobId, job, run: () => deliverScheduledReport(scheduleId, runKey, job) }
}
type Fixture = Awaited<ReturnType<typeof fixture>>
async function waitForLock(pattern: string) {
  const deadline = Date.now() + 8_000
  while (Date.now() < deadline) {
    if ((await db.query("select 1 from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and query like $1", [pattern])).rowCount) return
    await setTimeout(20)
  }
  assert.fail(`Expected real database lock wait: ${pattern}`)
}
async function duringWait(f: Fixture, lock: string, pattern: string, mutate: () => Promise<unknown>) {
  await blocker.query('begin'); await blocker.query(lock)
  const pending = Promise.allSettled([f.run()])
  try { await waitForLock(pattern); await mutate() } finally { await blocker.query('commit') }
  const [outcome] = await pending
  assert.equal(outcome.status, 'rejected')
  return outcome
}
async function assertNoPublication(f: Fixture) {
  assert.equal((await db.query('select 1 from report_editions where schedule_id=$1', [f.scheduleId])).rowCount, 0)
  const schedule = (await db.query('select delivery_lease_owner,last_run_key from report_schedules where id=$1', [f.scheduleId])).rows[0]
  assert.equal(schedule.delivery_lease_owner, null); assert.equal(schedule.last_run_key, null)
}
async function main() {
  await db.connect(); await blocker.connect()
  try {
    await db.query("insert into workspaces(id,name,slug,owner_user_id,plan,access_state) values($1::uuid,$1::text,$1::text,'fixture','agency','active')", [workspaceId])
    await db.query("insert into clients(id,workspace_id,google_customer_id,name,timezone,currency_code) values($1,$2,'7900000000','Report admission','UTC','EUR')", [clientId, workspaceId])
    await db.query("insert into daily_account_metrics(workspace_id,client_id,metric_date,currency_code,timezone,coverage_status,source_version,cost_micros,impressions,clicks,conversions) select $1,$2,to_char(day,'YYYY-MM-DD'),'EUR','UTC','complete','fixture-v1',1000000,100,10,1 from generate_series(current_date-100,current_date-1,interval '1 day') day", [workspaceId, clientId])
    for (const access of ['grace', 'suspended', 'deletion_pending', 'deleted', 'expired-trial']) {
      const f = await fixture()
      await db.query("update workspaces set access_state=$2,trial_ends_at=clock_timestamp()-interval '1 second' where id=$1", [workspaceId, access === 'expired-trial' ? 'trial' : access])
      await assert.rejects(f.run, /non autorisé/); await assertNoPublication(f)
    }
    verified.push('five_workspace_denials_before_publication')
    for (const target of ['jobs', 'share_links']) {
      const f = await fixture()
      await db.query("update jobs set lease_expires_at=clock_timestamp()+interval '250 milliseconds' where id=$1", [f.jobId])
      await duringWait(f, `select id from ${target} where id='${target === 'jobs' ? f.jobId : f.shareId}' for update`, `%from "${target}"%`, () => setTimeout(400))
      await assertNoPublication(f)
    }
    verified.push('job_and_share_row_waits_expire_before_publication')
    for (const expiry of ['job', 'trial']) {
      const f = await fixture()
      if (expiry === 'job') await db.query("update jobs set lease_expires_at=clock_timestamp()+interval '250 milliseconds' where id=$1", [f.jobId])
      else await db.query("update workspaces set access_state='trial',trial_ends_at=clock_timestamp()+interval '250 milliseconds' where id=$1", [workspaceId])
      await duringWait(f, 'lock table report_editions in share mode', 'insert into "report_editions"%', () => setTimeout(400))
      await assertNoPublication(f)
    }
    verified.push('publication_wait_job_and_trial_expiry_roll_back_edition_and_lease')
    const changes: Record<string, (f: Fixture) => Promise<unknown>> = {
      grace: () => db.query("update workspaces set access_state='grace' where id=$1", [workspaceId]),
      trial: () => db.query("update workspaces set access_state='trial',trial_ends_at=clock_timestamp()-interval '1 second' where id=$1", [workspaceId]),
      disabled: (f) => db.query('update report_schedules set enabled=false where id=$1', [f.scheduleId]),
      revoked: (f) => db.query('update share_links set active=false where id=$1', [f.shareId]),
      expired: (f) => db.query("update share_links set expires_at=clock_timestamp()-interval '1 second' where id=$1", [f.shareId]),
      token: (f) => db.query('update share_links set token_hash=$2 where id=$1', [f.shareId, hashToken(randomUUID())]),
      inactive: () => db.query('update clients set active=false where id=$1', [clientId]),
      manager: () => db.query('update clients set is_manager=true where id=$1', [clientId]),
      recipient: (f) => db.query("update report_schedules set recipient_emails=array['replacement@example.test'] where id=$1", [f.scheduleId]),
      job: (f) => db.query("update jobs set lease_expires_at=clock_timestamp()-interval '1 second' where id=$1", [f.jobId]),
      lease: (f) => db.query("update report_schedules set delivery_lease_until=clock_timestamp()-interval '1 second' where id=$1", [f.scheduleId]),
      flag: async () => { process.env.NOTIFICATIONS_ENABLED = '0' },
    }
    for (const [name, change] of Object.entries(changes)) {
      const f = await fixture(), before = submissions
      await duringWait(f, 'lock table transactional_email_deliveries in share mode', 'insert into "transactional_email_deliveries"%', () => change(f))
      assert.equal(submissions, before, name)
      const ledger = (await db.query('select status from transactional_email_deliveries where business_key=$1', [`report-schedule:${f.scheduleId}:${f.job.payload.runKey}`])).rows[0]
      assert.equal(ledger.status, ['job', 'lease', 'flag'].includes(name) ? 'pending' : 'failed', name)
      assert.equal((await db.query('select last_run_key from report_schedules where id=$1', [f.scheduleId])).rows[0].last_run_key, null)
    }
    verified.push('twelve_revocations_after_durable_claim_wait_without_submission')
    const uncertain = await fixture(); ambiguous = true
    await assert.rejects(uncertain.run, /ambigu/); ambiguous = false
    const beforeUncertain = submissions
    await duringWait(uncertain, 'lock table transactional_email_deliveries in share mode', 'insert into "transactional_email_deliveries"%', () => changes.recipient(uncertain))
    assert.equal(submissions, beforeUncertain)
    assert.equal((await db.query('select status from transactional_email_deliveries where business_key=$1', [`report-schedule:${uncertain.scheduleId}:${uncertain.job.payload.runKey}`])).rows[0].status, 'ambiguous')
    verified.push('uncertain_acceptance_preserved_after_recipient_revocation')
    const accepted = await fixture(), beforeAccepted = submissions
    onSubmit = async () => { await db.query("update jobs set lease_expires_at=clock_timestamp()-interval '1 second' where id=$1", [accepted.jobId]) }
    await assert.rejects(accepted.run, /lease lost/); onSubmit = undefined
    assert.equal(submissions, beforeAccepted + 1)
    await db.query("update jobs set lease_expires_at=clock_timestamp()+interval '1 hour' where id=$1", [accepted.jobId])
    await changes.recipient(accepted)
    assert.equal('delivered' in await accepted.run(), true)
    assert.equal(submissions, beforeAccepted + 1)
    assert.equal((await db.query('select 1 from report_editions where schedule_id=$1', [accepted.scheduleId])).rowCount, 1)
    verified.push('accepted_retry_reconciles_frozen_edition_without_resubmission')
    const auditWait = await fixture(), beforeAudit = submissions
    onSubmit = async () => {
      await blocker.query('begin'); await blocker.query('lock table audit_events in share mode')
      await db.query("update jobs set lease_expires_at=clock_timestamp()+interval '250 milliseconds' where id=$1", [auditWait.jobId])
    }
    const waiting = Promise.allSettled([auditWait.run()])
    try { await waitForLock('insert into "audit_events"%'); await setTimeout(400) } finally { await blocker.query('commit'); onSubmit = undefined }
    assert.equal((await waiting)[0].status, 'rejected')
    assert.equal((await db.query('select last_run_key from report_schedules where id=$1', [auditWait.scheduleId])).rows[0].last_run_key, null)
    assert.equal((await db.query("select 1 from audit_events where entity_id=$1 and action='report.schedule_delivered'", [auditWait.scheduleId])).rowCount, 0)
    await db.query("update jobs set lease_expires_at=clock_timestamp()+interval '1 hour' where id=$1", [auditWait.jobId])
    assert.equal('delivered' in await auditWait.run(), true)
    assert.equal(submissions, beforeAudit + 1)
    verified.push('completion_audit_wait_expiry_rolls_back_then_reconciles_without_resubmission')
    assert.equal((await db.query("select has_table_privilege('yodev_system','report_editions','UPDATE') as allowed")).rows[0].allowed, false)
    console.log(JSON.stringify({ ok: true, verified, simulatedSubmissions: submissions, realProviderCalls: 0 }))
  } finally {
    await blocker.query('rollback')
    globalThis.fetch = originalFetch
    await db.query('delete from workspaces where id=$1', [workspaceId])
    await blocker.end(); await db.end()
  }
}
main().then(() => process.exit(0)).catch((error) => { console.error(error); process.exit(1) })
