import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { Client } from 'pg'
import { randomUUID } from 'node:crypto'
import { and, eq, sql } from 'drizzle-orm'
import { activationMilestones, clients, shareLinks, workspaces } from '../src/db/schema'
import { withSystemTransaction, withTenantTransaction } from '../src/db/transactions'
import { createWorkspaceReportSchedule } from '../src/lib/report-management'
import { createReportEditionInTransaction } from '../src/lib/report-editions'
import { entitlementContext } from '../src/lib/entitlements'
import { hashToken } from '../src/lib/tokens'
import { activationCohorts } from '../src/lib/activation-analytics'

const url = new URL(process.env.DATABASE_SYSTEM_URL ?? '')
assert(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && url.pathname.startsWith('/yodev_test'), 'Disposable local database required')
globalThis.fetch = async () => { throw new Error('Provider calls forbidden') }
const workspaceId = '85000000-0000-4000-8000-000000000001', foreignId = '85000000-0000-4000-8000-000000000002', owner = 'activation-fixture'
const authFixture = new Client({ connectionString: url.href })
const cleanup = async () => { for (const id of [workspaceId, foreignId]) await withSystemTransaction((db) => db.delete(workspaces).where(eq(workspaces.id, id))); await authFixture.query('delete from auth_organizations where id=$1', [workspaceId]); await authFixture.query('delete from auth_users where id=$1', [owner]) }
async function main() {
  await authFixture.connect()
  await cleanup()
  const now = new Date(), createdAt = new Date(now.getTime()-3*86_400_000)
  const milestones = () => withSystemTransaction((db) => db.query.activationMilestones.findMany({ where: eq(activationMilestones.workspaceId, workspaceId) }))
  try {
    await authFixture.query('insert into auth_users(id,name,email,email_verified) values($1,$1,$2,true)', [owner, 'activation-fixture@example.test'])
    await authFixture.query('insert into auth_organizations(id,name,slug) values($1::text,$1::text,$1::text)', [workspaceId])
    await authFixture.query("insert into auth_members(id,organization_id,user_id,role) values($1,$1,$2,'owner')", [workspaceId, owner])
    await withSystemTransaction((db) => db.insert(workspaces).values([workspaceId, foreignId].map((id) => ({ id, authOrganizationId: id === workspaceId ? workspaceId : null, ownerUserId: owner, name: 'Activation fixture', slug: `activation-${id}`, plan: 'agency', accessState: 'active', createdAt }))))
    const [client] = await withSystemTransaction((db) => db.insert(clients).values({ workspaceId, googleCustomerId: '8500000000', name: 'Activation fixture', currencyCode: 'EUR', timezone: 'Europe/Paris' }).returning())
    const schedule = await createWorkspaceReportSchedule({ workspaceId, actorUserId: owner, workspaceLocale: 'fr', clientId: client.id, name: 'Not yet published', cadence: 'weekly', scheduleWeekday: 1, scheduleMonthday: 1, sendHour: 8, timezone: 'Europe/Paris', recipientEmails: ['fixture@example.test'], token: randomUUID(), entitlements: entitlementContext('active','agency'), now })
    assert.equal((await milestones()).length, 0, 'A schedule is not a published report')
    await assert.rejects(withTenantTransaction({workspaceId,userId:owner},(db)=>createReportEditionInTransaction(db,{workspaceId,shareId:schedule.share.id,actorUserId:owner,kind:'initial',now})))
    assert.equal((await milestones()).length, 0, 'A failed publication has no activation event')
    await withSystemTransaction((db)=>db.execute(sql`insert into daily_account_metrics(workspace_id,client_id,metric_date,currency_code,timezone,cost_micros,clicks,conversions,coverage_status,source_version,source_observed_at)
      select ${workspaceId},${client.id},((now() at time zone 'Europe/Paris')::date-days)::text,'EUR','Europe/Paris','1000000','10','1','complete','fixture',now() from generate_series(1,31) days`))
    await assert.rejects(withTenantTransaction({workspaceId,userId:owner},async(db)=>{
      await createReportEditionInTransaction(db,{workspaceId,shareId:schedule.share.id,actorUserId:owner,kind:'initial',now})
      throw new Error('Fixture rollback after publication')
    }),/Fixture rollback/)
    assert.equal((await milestones()).length,0,'Publication rollback also rolls back activation')
    assert.equal((await withSystemTransaction((db)=>db.query.reportEditions.findMany({where:sql`workspace_id=${workspaceId}`}))).length,0)
    const issued = await withTenantTransaction({workspaceId,userId:owner},(db)=>createReportEditionInTransaction(db,{workspaceId,shareId:schedule.share.id,actorUserId:owner,kind:'initial',now}))
    const events = await milestones()
    assert.equal(events.length, 1); assert.equal(events[0].milestone, 'first_report_published'); assert.equal(events[0].sourceEntityId, issued.edition.id); assert.equal(events[0].occurredAt.toISOString(), now.toISOString())
    assert.equal(events[0].metadata.evidence, 'report_edition_v1')
    await withTenantTransaction({workspaceId,userId:owner},(db)=>createReportEditionInTransaction(db,{workspaceId,shareId:schedule.share.id,actorUserId:owner,kind:'initial',now}))
    assert.equal((await milestones()).length, 1)

    // Simulate a pre-upgrade ledger. Backfill may add evidence, never reinterpret
    // or delete the old schedule marker, and must remain idempotent.
    await withSystemTransaction(async(db)=>{
      await db.delete(activationMilestones).where(eq(activationMilestones.workspaceId,workspaceId))
      await db.insert(activationMilestones).values({workspaceId,milestone:'first_report',actorUserId:owner,sourceEntityId:schedule.share.id,occurredAt:createdAt})
      await db.execute(sql`insert into audit_events(workspace_id,actor_user_id,action,entity_type,entity_id,metadata) values(${workspaceId},${owner},'google_ads.account_selection_saved','workspace',${workspaceId},'{"activeAdvertisers":1}'),(${foreignId},${owner},'google_ads.account_selection_saved','workspace',${foreignId},'{"activeAdvertisers":0}')`)
    })
    const statements = (await readFile(new URL('../drizzle/0054_published_report_activation.sql',import.meta.url),'utf8')).split('--> statement-breakpoint').filter((statement)=>statement.includes('INSERT INTO activation_milestones'))
    for (let run=0;run<2;run++) await withTenantTransaction({workspaceId,userId:owner},async(db)=>{for(const statement of statements) await db.execute(sql.raw(statement))})
    const recovered = await milestones()
    assert.equal(recovered.length,3)
    assert.equal(recovered.find((event)=>event.milestone==='first_report')?.occurredAt.toISOString(),createdAt.toISOString())
    assert.equal(recovered.find((event)=>event.milestone==='first_report_published')?.sourceEntityId,issued.edition.id)
    assert.equal(recovered.find((event)=>event.milestone==='accounts_selected')?.metadata.evidence,'account_selection_audit_v1')
    assert.equal((await withSystemTransaction((db)=>db.query.activationMilestones.findMany({where:eq(activationMilestones.workspaceId,foreignId)}))).length,0)
    const cohort=activationCohorts([{id:workspaceId,createdAt}],recovered,new Date(now.getTime()+1000))
    assert.equal(cohort.cohorts.reduce((sum,row)=>sum+row.firstReport,0),1)
    assert.equal(cohort.medianDaysToFirstReport,3)

    const token = randomUUID()
    const [rollbackShare] = await withSystemTransaction(async(db)=>{
      const [foreignClient] = await db.insert(clients).values({workspaceId:foreignId,googleCustomerId:'8599999999',name:'No data'}).returning()
      return db.insert(shareLinks).values({workspaceId:foreignId,clientId:foreignClient.id,createdBy:owner,label:'No data',tokenHash:hashToken(token),tokenPrefix:token.slice(0,12)}).returning()
    })
    await assert.rejects(withTenantTransaction({workspaceId:foreignId,userId:owner},(db)=>createReportEditionInTransaction(db,{workspaceId:foreignId,shareId:rollbackShare.id,actorUserId:owner,kind:'initial',now})))
    assert.equal((await withSystemTransaction((db)=>db.query.activationMilestones.findMany({where:and(eq(activationMilestones.workspaceId,foreignId),eq(activationMilestones.milestone,'first_report_published'))}))).length,0)
    console.log(JSON.stringify({ok:true,verified:['schedule_not_publication','failed_publication_no_milestone','edition_atomic_publication_evidence','reopen_idempotent','legacy_marker_preserved_not_counted','edition_and_selection_backfill_idempotent','tenant_scoped_backfill','future_and_invalid_cohorts_covered_by_unit_tests'],providerCalls:0}))
  } finally { await cleanup(); await authFixture.end() }
}
main().catch((error)=>{console.error(error);process.exitCode=1})
