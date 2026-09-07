import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { Client } from 'pg'
import { eq } from 'drizzle-orm'
import { portfolioViews, workspaces } from '../src/db/schema'
import { withSystemTransaction, withTenantTransaction } from '../src/db/transactions'
import { deletePortfolioView, listPortfolioViews, savePortfolioView } from '../src/lib/portfolio-views'

const url = new URL(process.env.DATABASE_SYSTEM_URL ?? '')
assert(['localhost','127.0.0.1','[::1]'].includes(url.hostname) && url.pathname.startsWith('/yodev_test'), 'Disposable local database required')
globalThis.fetch = async () => { throw new Error('Provider calls forbidden') }
const workspaceId = '83000000-0000-4000-8000-000000000001', foreignId = '83000000-0000-4000-8000-000000000002'
const actorA = randomUUID(), actorB = randomUUID(), organizations = [randomUUID(), randomUUID()]
const identity = new Client({ connectionString: url.href })
const criteria = { q: 'literal %_', currency: 'USD', attention: 'critical' as const, assignee: '' }
const cleanup = async () => { for (const id of [workspaceId,foreignId]) await withSystemTransaction((db) => db.delete(workspaces).where(eq(workspaces.id,id))) }
async function main() {
  await identity.connect()
  await cleanup()
  try {
    for (const user of [actorA, actorB]) await identity.query('insert into auth_users(id,name,email,email_verified) values($1,$1,$2,true)', [user, `views-${user}@example.test`])
    for (const organization of organizations) {
      await identity.query('insert into auth_organizations(id,name,slug) values($1::text,$1::text,$1::text)', [organization])
      for (const user of [actorA, actorB]) await identity.query("insert into auth_members(id,organization_id,user_id,role) values($1,$2,$3,'analyst')", [randomUUID(), organization, user])
    }
    await withSystemTransaction((db) => db.insert(workspaces).values([workspaceId,foreignId].map((id,index) => ({ id, ownerUserId: actorA, authOwnerUserId: actorA, authOrganizationId: organizations[index], name: 'Views fixture', slug: `views-${id}`, accessState: 'internal', plan: 'internal' }))))
    const first = await savePortfolioView({ workspaceId, actorUserId: actorA, name: 'My priorities', criteria })
    assert.equal((await listPortfolioViews(workspaceId,actorA)).length,1)
    assert.equal((await listPortfolioViews(workspaceId,actorB)).length,0)
    assert.equal((await listPortfolioViews(foreignId,actorA)).length,0)
    // RLS must enforce the owner even when application WHERE clauses are omitted.
    assert.equal((await withTenantTransaction({ workspaceId, userId: actorB }, (db) => db.select().from(portfolioViews))).length,0)
    await assert.rejects(withTenantTransaction({ workspaceId,userId:actorB }, (db) => db.insert(portfolioViews).values({ workspaceId,userId:actorA,name:'Forged',criteria })))
    await assert.rejects(deletePortfolioView({ workspaceId, actorUserId:actorB, id:first.id, version:first.version }), /conflict/)
    await assert.rejects(savePortfolioView({ workspaceId:foreignId,actorUserId:actorA,id:first.id,version:first.version,name:'Foreign',criteria }), /conflict/)
    const updates = await Promise.allSettled(['One','Two'].map((name) => savePortfolioView({ workspaceId,actorUserId:actorA,id:first.id,version:first.version,name,criteria })))
    assert.equal(updates.filter((result) => result.status==='fulfilled').length,1)
    assert.equal(updates.filter((result) => result.status==='rejected').length,1)
    const current = (await listPortfolioViews(workspaceId,actorA))[0]
    assert.notEqual(current.version,first.version)
    await assert.rejects(deletePortfolioView({workspaceId,actorUserId:actorA,id:first.id,version:first.version}), /conflict/)
    for(let index=1;index<19;index++) await savePortfolioView({workspaceId,actorUserId:actorA,name:`View ${index}`,criteria})
    const quota = await Promise.allSettled(['Last one','Last two'].map((name) => savePortfolioView({workspaceId,actorUserId:actorA,name,criteria})))
    assert.equal(quota.filter((result) => result.status==='fulfilled').length,1)
    assert.equal((await listPortfolioViews(workspaceId,actorA)).length,20)
    const other = await savePortfolioView({workspaceId,actorUserId:actorB,name:'Independent quota',criteria})
    assert.equal((await listPortfolioViews(workspaceId,actorB)).length,1)
    await deletePortfolioView({workspaceId,actorUserId:actorB,id:other.id,version:other.version})
    await withSystemTransaction((db) => db.update(workspaces).set({accessState:'grace'}).where(eq(workspaces.id,workspaceId)))
    assert.equal((await listPortfolioViews(workspaceId,actorA)).length,20)
    await assert.rejects(savePortfolioView({workspaceId,actorUserId:actorB,name:'Grace write',criteria}), /non autorisée/)
    await assert.rejects(deletePortfolioView({workspaceId,actorUserId:actorA,id:current.id,version:current.version}), /non autorisée/)
    await withSystemTransaction((db) => db.update(workspaces).set({accessState:'suspended'}).where(eq(workspaces.id,workspaceId)))
    assert.equal((await listPortfolioViews(workspaceId,actorA)).length,0)
    await assert.rejects(savePortfolioView({workspaceId,actorUserId:actorA,id:randomUUID(),name:'Incomplete update',criteria}))
    await cleanup()
    assert.equal((await withSystemTransaction((db) => db.select().from(portfolioViews).where(eq(portfolioViews.workspaceId,workspaceId)))).length,0)
    console.log(JSON.stringify({ok:true,viewsPerUser:20,verified:['owner_and_tenant_rls','spoofed_owner_insert_denied','optimistic_concurrent_update','stale_delete_denied','concurrent_quota','independent_user_quota','grace_read_no_write','suspension_denied','workspace_deletion_cascade'],providerCalls:0}))
  } finally { await cleanup(); for (const organization of organizations) await identity.query('delete from auth_organizations where id=$1',[organization]); await identity.query('delete from auth_users where id=any($1::text[])',[[actorA,actorB]]); await identity.end() }
}
main().catch((error) => {console.error(error);process.exitCode=1})
