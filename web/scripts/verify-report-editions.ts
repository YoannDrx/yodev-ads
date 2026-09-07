import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { and, eq, sql } from 'drizzle-orm'
import { clients, dailyAccountMetrics, jobs, reportEditions, reportSchedules, shareLinks, workspaces } from '../src/db/schema'
import { withSystemTransaction, withTenantTransaction } from '../src/db/transactions'
import { accountCalendarDate, shiftCalendarDate } from '../src/lib/calendar-window'
import { clientReportCsv } from '../src/lib/client-report-model'
import { decryptSecret, encryptSecret } from '../src/lib/crypto'
import { createReportEditionInTransaction, getPublicReportEdition } from '../src/lib/report-editions'
import { createWorkspacePublicReport, reviseWorkspacePublicReport } from '../src/lib/public-report-workflows'
import { createApiReport } from '../src/lib/api-v1-repository'
import { entitlementContext } from '../src/lib/entitlements'
import { createClientReportPdf } from '../src/lib/client-report-pdf'
import { deliverScheduledReport } from '../src/lib/scheduled-reports'
import { rotateWorkspaceSecrets } from '../src/lib/secret-rotation'
import { hashToken } from '../src/lib/tokens'

const url = new URL(process.env.DATABASE_SYSTEM_URL ?? '')
assert(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && url.pathname.startsWith('/yodev_test'), 'Disposable local database required')
const workspaceId = '77000000-0000-4000-8000-000000000001', foreignId = '77000000-0000-4000-8000-000000000002'
const owner = 'report-edition-fixture', now = new Date()
globalThis.fetch = async () => { throw new Error('Provider calls are forbidden in this fixture') }
async function main() {
  for (const id of [workspaceId, foreignId]) await withSystemTransaction((db) => db.delete(workspaces).where(eq(workspaces.id, id)))
  await withSystemTransaction((db) => db.insert(workspaces).values([workspaceId, foreignId].map((id) => ({ id, ownerUserId: owner, name: 'Report fixture', brandName: 'Original agency', slug: `report-edition-${id}`, plan: 'agency', accessState: 'active' }))))
  try {
    const [client] = await withSystemTransaction((db) => db.insert(clients).values({ workspaceId, googleCustomerId: '7700000000', name: 'Report client', timezone: 'Europe/Paris', currencyCode: 'EUR' }).returning())
    const today = accountCalendarDate(now, client.timezone)
    await withSystemTransaction(async (db) => {
      await db.execute(sql`insert into daily_account_metrics(workspace_id,client_id,metric_date,currency_code,timezone,coverage_status,source_version,cost_micros,impressions,clicks,conversions)
        select ${workspaceId},${client.id},to_char(day,'YYYY-MM-DD'),'EUR','Europe/Paris','complete','fixture-v1',2000000,100,10,0.3000
        from generate_series(${shiftCalendarDate(today, -100)}::date,${shiftCalendarDate(today, -1)}::date,interval '1 day') day`)
      await db.execute(sql`insert into daily_campaign_metrics(workspace_id,client_id,campaign_id,metric_date,campaign_name,campaign_type,status,currency_code,cost_micros,impressions,clicks,conversions)
        select ${workspaceId},${client.id},'42',to_char(day,'YYYY-MM-DD'),'Archived campaign','SEARCH','REMOVED','EUR',1000000,50,5,0.1000
        from generate_series(${shiftCalendarDate(today, -100)}::date,${shiftCalendarDate(today, -1)}::date,interval '1 day') day`)
    })
    async function share(periodDays: number, mode = 'fixed') {
      const token = randomUUID()
      const [row] = await withSystemTransaction((db) => db.insert(shareLinks).values({ workspaceId, clientId: client.id, createdBy: owner, label: 'Report fixture', mode, periodDays, tokenHash: hashToken(token), tokenPrefix: token.slice(0, 12), encryptedReportToken: encryptSecret(token), expiresAt: new Date(now.getTime() + 90 * 86_400_000) }).returning())
      return row
    }
    const fixed = await share(7)
    const initial = await withTenantTransaction({ workspaceId, userId: owner }, (db) => createReportEditionInTransaction(db, { workspaceId, shareId: fixed.id, actorUserId: owner, kind: 'initial', now }))
    assert.equal(initial.model.periodDays, 7)
    assert.equal(initial.model.totals.costMicros, '14000000')
    assert.equal(initial.model.totals.conversions, 2.1)
    assert.equal(initial.model.campaigns[0].costMicros, '7000000')
    assert.equal(initial.model.campaigns[0].status, 'REMOVED')
    const csv = clientReportCsv(initial.model)
    const day = initial.edition.periodFrom
    await withSystemTransaction((db) => db.update(dailyAccountMetrics).set({ costMicros: '9000000', sourceVersion: 'fixture-v2' }).where(and(eq(dailyAccountMetrics.clientId, client.id), eq(dailyAccountMetrics.metricDate, day))))
    await withSystemTransaction((db) => db.update(workspaces).set({ brandName: 'Renamed agency' }).where(eq(workspaces.id, workspaceId)))
    const reread = await getPublicReportEdition({ workspaceId, shareId: fixed.id, editionId: initial.edition.id, now: new Date(now.getTime() + 86_400_000) })
    assert.equal(clientReportCsv(reread.model), csv, 'Reopening does not rewrite figures, period, branding or publication time')
    const revision = await withTenantTransaction({ workspaceId, userId: owner }, (db) => createReportEditionInTransaction(db, { workspaceId, shareId: fixed.id, actorUserId: owner, kind: 'revision', previousEditionId: initial.edition.id, now }))
    assert.notEqual(revision.edition.id, initial.edition.id)
    assert.equal(revision.model.totals.costMicros, '21000000')
    assert.equal(revision.model.brandName, 'Original agency')
    assert.equal(revision.edition.periodFrom, initial.edition.periodFrom)
    assert.equal((await getPublicReportEdition({ workspaceId, shareId: fixed.id, now })).edition.id, initial.edition.id)
    const dynamic = await share(30, 'dynamic')
    const concurrent = await Promise.all([1, 2, 3].map(() => getPublicReportEdition({ workspaceId, shareId: dynamic.id, now })))
    assert.equal(new Set(concurrent.map((result) => result.edition.id)).size, 1)
    assert.equal(concurrent.filter((result) => result.created).length, 1)
    assert.equal(concurrent[0].model.periodDays, 30)
    const quarterly = await share(90)
    const ninety = await withTenantTransaction({ workspaceId, userId: owner }, (db) => createReportEditionInTransaction(db, { workspaceId, shareId: quarterly.id, actorUserId: owner, kind: 'initial', now }))
    assert.equal(ninety.model.periodDays, 90)
    const scheduledShare = await share(30)
    const [schedule] = await withSystemTransaction((db) => db.insert(reportSchedules).values({ workspaceId, clientId: client.id, shareId: scheduledShare.id, createdBy: owner, name: 'Scheduled fixture', cadence: 'monthly', scheduleMonthday: 31, recipientEmails: ['client@example.test'], encryptedReportToken: encryptSecret('fixture-token') }).returning())
    const delivery = { scheduleId: schedule.id, runKey: `monthly:${today}`, tokenHash: scheduledShare.tokenHash, build: (id: string) => ({ from: 'fixture@example.test', to: ['client@example.test'], subject: 'Fixture', html: `<a href="https://example.test/r/fixture?edition=${id}">Report</a>` }) }
    const scheduled = await withSystemTransaction((db) => createReportEditionInTransaction(db, { workspaceId, shareId: scheduledShare.id, actorUserId: owner, kind: 'scheduled', delivery, now }))
    const repeated = await withSystemTransaction((db) => createReportEditionInTransaction(db, { workspaceId, shareId: scheduledShare.id, actorUserId: owner, kind: 'scheduled', delivery: { ...delivery, build: () => ({ from: 'changed@example.test', to: ['changed@example.test'], subject: 'Changed', html: 'Changed' }) }, now: new Date(now.getTime() + 86_400_000) }))
    assert.equal(repeated.edition.id, scheduled.edition.id)
    assert.equal(repeated.edition.encryptedDelivery, scheduled.edition.encryptedDelivery)
    assert.deepEqual(JSON.parse(decryptSecret(repeated.edition.encryptedDelivery!)).to, ['client@example.test'])
    await assert.rejects(withTenantTransaction({ workspaceId, userId: owner }, (db) => db.update(reportEditions).set({ sourceVersion: 'tampered' }).where(eq(reportEditions.id, initial.edition.id))))
    await assert.rejects(withSystemTransaction((db) => db.update(reportEditions).set({ sourceVersion: 'tampered' }).where(eq(reportEditions.id, initial.edition.id))))
    assert.equal((await withTenantTransaction({ workspaceId: foreignId, userId: owner }, (db) => db.query.reportEditions.findMany({ where: eq(reportEditions.shareId, fixed.id) }))).length, 0)
    await assert.rejects(getPublicReportEdition({ workspaceId, shareId: dynamic.id, editionId: initial.edition.id, now }))
    await assert.rejects(withSystemTransaction((db) => db.insert(reportEditions).values({ ...initial.edition, id: randomUUID(), workspaceId: foreignId, deduplicationKey: 'foreign', editionNumber: 9 })))
    // Actual creation and one-shot revision services, without a Google connection.
    const publication = await createWorkspacePublicReport({ workspaceId, actorUserId: owner, clientId: client.id, label: 'Custom dated report', locale: 'en', periodDays: 30,
      periodConfig: { period: 'custom', from: shiftCalendarDate(today, -12), through: shiftCalendarDate(today, -3) }, mode: 'fixed', token: randomUUID(), entitlements: entitlementContext('active', 'agency'), fallbackOrigin: 'https://reports.example.test', now })
    const revelation = await withTenantTransaction({ workspaceId, userId: owner }, (db) => db.query.secretRevelations.findFirst({ where: (table, { eq }) => eq(table.id, publication.id) }))
    const publishedUrl = new URL(decryptSecret(revelation!.encryptedSecret))
    const publishedEdition = await withSystemTransaction((db) => db.query.reportEditions.findFirst({ where: eq(reportEditions.id, publishedUrl.searchParams.get('edition')!) }))
    assert.equal(publishedEdition?.payload.periodDays, 10)
    const revisedPublication = await reviseWorkspacePublicReport({ workspaceId, actorUserId: owner, shareId: publishedEdition!.shareId, previousEditionId: publishedEdition!.id, fallbackOrigin: 'https://reports.example.test', now })
    assert(revisedPublication.id)
    const apiReport = await createApiReport({ workspaceId, actorId: owner, clientId: client.id, label: 'Previous calendar month', token: randomUUID(), periodConfig: { period: 'previous_month' }, entitlements: entitlementContext('active', 'agency') })
    assert.equal(apiReport.periodFrom.slice(-2), '01')
    assert.equal(apiReport.periodThrough.slice(0, 7), shiftCalendarDate(`${today.slice(0, 7)}-01`, -1).slice(0, 7))
    assert.deepEqual(await createClientReportPdf(initial.model), await createClientReportPdf(reread.model), 'PDF bytes use the persisted publication timestamp and model')
    await assert.rejects(getPublicReportEdition({ workspaceId, shareId: fixed.id, editionId: initial.edition.id, now: new Date(now.getTime() + 91 * 86_400_000) }))

    // Simulated transport only: lose the job lease after acceptance, then reconcile without a second submission.
    const workerShare = await share(30)
    const [workerSchedule] = await withSystemTransaction((db) => db.insert(reportSchedules).values({ workspaceId, clientId: client.id, shareId: workerShare.id, createdBy: owner, name: 'Frozen worker report', cadence: 'weekly', scheduleWeekday: 1,
      recipientEmails: ['original@example.test'], encryptedReportToken: workerShare.encryptedReportToken! }).returning())
    const workerRunKey = `weekly:${shiftCalendarDate(today, -1)}`
    const [workerJob] = await withSystemTransaction((db) => db.insert(jobs).values({ workspaceId, type: 'report.schedule_deliver', payload: { scheduleId: workerSchedule.id, runKey: workerRunKey }, status: 'running', leaseOwner: 'fixture-original', attemptCount: 1,
      createdAt: new Date(now.getTime() - 86_400_000), leaseExpiresAt: new Date(now.getTime() + 300_000) }).returning())
    const envNames = ['NOTIFICATIONS_ENABLED', 'YODEV_MAIL_API_KEY', 'YODEV_MAIL_API_URL'] as const
    const originalEnv = Object.fromEntries(envNames.map((key) => [key, process.env[key]]))
    let simulatedSubmissions = 0
    try {
      process.env.NOTIFICATIONS_ENABLED = '1'; process.env.YODEV_MAIL_API_KEY = 'disposable-fixture-only'; process.env.YODEV_MAIL_API_URL = 'https://report-transport.example.test'
      globalThis.fetch = async (url, options) => {
        assert.equal(String(url), 'https://report-transport.example.test/v1/emails')
        const body = JSON.parse(String(options?.body))
        assert.equal(body.to.email, 'original@example.test')
        assert.match(body.content.html, /\?edition=/)
        simulatedSubmissions++
        await withSystemTransaction((db) => db.update(jobs).set({ leaseOwner: 'fixture-successor', attemptCount: 2 }).where(eq(jobs.id, workerJob.id)))
        return new Response(JSON.stringify({ data: { id: randomUUID(), status: 'queued' } }), { status: 202 })
      }
      await assert.rejects(deliverScheduledReport(workerSchedule.id, workerRunKey, workerJob), /lease lost/)
      await withSystemTransaction((db) => db.update(reportSchedules).set({ name: 'Changed report', recipientEmails: ['changed@example.test'] }).where(eq(reportSchedules.id, workerSchedule.id)))
      const [savedEdition] = await withSystemTransaction((db) => db.select().from(reportEditions).where(eq(reportEditions.scheduleId, workerSchedule.id)))
      assert.equal(savedEdition.periodThrough, shiftCalendarDate(today, -2), 'Retry keeps the original enqueue calendar window')
      const successor = { ...workerJob, leaseOwner: 'fixture-successor', attemptCount: 2 }
      const resumed = await deliverScheduledReport(workerSchedule.id, workerRunKey, successor)
      assert('delivered' in resumed && resumed.delivered)
      assert.equal(simulatedSubmissions, 1)
      assert.equal((await withSystemTransaction((db) => db.query.reportEditions.findMany({ where: eq(reportEditions.scheduleId, workerSchedule.id) }))).length, 1)
      const delivered = await withSystemTransaction((db) => db.query.reportSchedules.findFirst({ where: eq(reportSchedules.id, workerSchedule.id) }))
      assert.equal(delivered?.lastRunKey, workerRunKey)
      assert.equal(delivered?.deliveryLeaseOwner, null)
      await assert.rejects(deliverScheduledReport(workerSchedule.id, workerRunKey, { ...successor, workspaceId: foreignId }), /introuvable/)
    } finally {
      for (const key of envNames) { if (originalEnv[key] === undefined) delete process.env[key]; else process.env[key] = originalEnv[key] }
      globalThis.fetch = async () => { throw new Error('Provider calls are forbidden in this fixture') }
    }
    const keyNames = ['APP_ENCRYPTION_KEYS', 'APP_ENCRYPTION_CURRENT_KID'] as const
    const previousKeys = Object.fromEntries(keyNames.map((key) => [key, process.env[key]]))
    try {
      process.env.APP_ENCRYPTION_KEYS = JSON.stringify({ report_fixture: Buffer.alloc(32, 8).toString('base64url') })
      process.env.APP_ENCRYPTION_CURRENT_KID = 'report_fixture'
      const rotated = await rotateWorkspaceSecrets(workspaceId)
      assert(rotated.counts && rotated.counts.reportEditions > 0 && rotated.counts.shareLinks > 0)
      const after = await withSystemTransaction((db) => db.query.reportEditions.findFirst({ where: eq(reportEditions.id, scheduled.edition.id) }))
      assert.equal(decryptSecret(after!.encryptedDelivery!), decryptSecret(scheduled.edition.encryptedDelivery!))
      assert.deepEqual(after!.payload, scheduled.edition.payload)
      await assert.rejects(withSystemTransaction((db) => db.update(reportEditions).set({ payload: { ...after!.payload, clientName: 'tampered' } }).where(eq(reportEditions.id, scheduled.edition.id))))
    } finally { for (const key of keyNames) { if (previousKeys[key] === undefined) delete process.env[key]; else process.env[key] = previousKeys[key] } }
    await withSystemTransaction((db) => db.delete(dailyAccountMetrics).where(and(eq(dailyAccountMetrics.clientId, client.id), eq(dailyAccountMetrics.metricDate, day))))
    const incomplete = await share(90)
    await assert.rejects(withTenantTransaction({ workspaceId, userId: owner }, (db) => createReportEditionInTransaction(db, { workspaceId, shareId: incomplete.id, actorUserId: owner, kind: 'initial', now })))
    assert.equal((await withSystemTransaction((db) => db.query.reportEditions.findMany({ where: eq(reportEditions.shareId, incomplete.id) }))).length, 0)
    assert.equal(clientReportCsv((await getPublicReportEdition({ workspaceId, shareId: fixed.id, editionId: initial.edition.id, now })).model), csv)
    await withSystemTransaction((db) => db.update(shareLinks).set({ active: false }).where(eq(shareLinks.id, fixed.id)))
    await assert.rejects(getPublicReportEdition({ workspaceId, shareId: fixed.id, editionId: initial.edition.id, now }))
    await withSystemTransaction((db) => db.delete(reportSchedules).where(eq(reportSchedules.id, schedule.id)))
    assert.equal((await withSystemTransaction((db) => db.query.reportEditions.findFirst({ where: eq(reportEditions.id, scheduled.edition.id) })))?.scheduleId, null)
    console.log(JSON.stringify({ ok: true, verified: ['qualified_7_30_90_day_editions', 'account_totals_independent_of_campaign_list', 'archived_campaign_included', 'exact_decimal_conversions', 'immutable_reopen_and_csv', 'correction_creates_revision_of_same_period', 'fixed_default_stays_initial', 'concurrent_dynamic_deduplication', 'scheduled_run_freezes_window_and_encrypted_delivery', 'application_and_system_cannot_update_report_content', 'custom_manual_publication_and_revision', 'previous_calendar_month_api_publication', 'pdf_bytes_remain_identical', 'publication_expiry', 'actual_worker_fences_and_accepted_email_reconciliation', 'encryption_rewrap_preserves_report_content', 'tenant_rls_and_composite_scope', 'incomplete_history_does_not_publish', 'existing_edition_survives_history_gap', 'revocation_denies_edition', 'schedule_deletion_preserves_issued_content'], providerCalls: 0 }))
  } finally {
    for (const id of [workspaceId, foreignId]) await withSystemTransaction((db) => db.delete(workspaces).where(eq(workspaces.id, id)))
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
