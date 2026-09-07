import assert from 'node:assert/strict'
import { Client } from 'pg'

const url = new URL(process.env.DATABASE_SYSTEM_URL ?? '')
assert(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && url.pathname.startsWith('/yodev_test'), 'Disposable local database required')
const workspaceId = '86100000-0000-4000-8000-000000000001', org = 'membership-admission-fixture'
const users = Array.from({ length: 7 }, (_, index) => `membership-admission-${index}`)
const db = new Client({ connectionString: url.href }), contenders = [new Client({ connectionString: url.href }), new Client({ connectionString: url.href })]
async function cleanup() {
  await db.query('delete from workspaces where id=$1', [workspaceId])
  await db.query('delete from auth_organizations where id=$1', [org])
  await db.query('delete from auth_users where id=any($1::text[])', [users])
}
async function main() {
  await db.connect()
  try {
    await cleanup()
    await db.query('insert into auth_organizations(id,name,slug) values($1::text,$1::text,$1::text)', [org])
    for (const user of users) await db.query('insert into auth_users(id,name,email,email_verified) values($1,$1,$2,true)', [user, `${user}@example.test`])
    await db.query("insert into workspaces(id,name,slug,auth_organization_id,owner_user_id,auth_owner_user_id,plan,access_state) values($1,$2::text,$2::text,$2::text,$3::text,$3::text,'studio','active')", [workspaceId, org, users[0]])
    for (const user of users.slice(0, 4)) await db.query('insert into auth_members(id,user_id,organization_id,role) values($1,$1,$2,$3)', [user, org, user === users[0] ? 'owner' : 'analyst'])
    for (const contender of contenders) {
      await contender.connect(); await contender.query('set role yodev_auth')
      // Both requests observe the same free seat before either writes.
      assert.equal(Number((await contender.query('select count(*) from auth_members where organization_id=$1', [org])).rows[0].count), 4)
    }
    const results = await Promise.allSettled(contenders.map((contender, index) => contender.query("insert into auth_members(id,user_id,organization_id,role) values($1,$1,$2,'analyst')", [users[index + 4], org])))
    const count = Number((await db.query('select count(*) from auth_members where organization_id=$1', [org])).rows[0].count)
    if (process.env.YODEV_EXPECT_UNSAFE_MEMBERSHIP === '1') {
      assert.equal(count, 6)
      console.log(JSON.stringify({ reproduced: 'concurrent_membership_quota_overflow', before: 4, after: count, limit: 5 }))
      return
    }
    assert.equal(count, 5)
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1)
    const rejected = results.find((result) => result.status === 'rejected') as PromiseRejectedResult
    assert.equal(rejected.reason.code, '23514')
    for (const state of ['grace', 'suspended', 'deletion_pending', 'deleted']) {
      await db.query('update workspaces set access_state=$1 where id=$2', [state, workspaceId])
      await assert.rejects(contenders[0].query("insert into auth_members(id,user_id,organization_id,role) values($1,$1,$2,'analyst')", [users[6], org]), (error: unknown) => (error as { code: string }).code === '23514')
    }
    await db.query("update workspaces set access_state='trial',plan='internal',trial_ends_at=now()-interval '1 hour' where id=$1", [workspaceId])
    await assert.rejects(contenders[0].query("insert into auth_members(id,user_id,organization_id,role) values($1,$1,$2,'analyst')", [users[6], org]))
    // Plan downgrades keep current members; later role changes remain possible.
    await db.query("update workspaces set access_state='active',plan='solo' where id=$1", [workspaceId])
    await contenders[0].query("update auth_members set role='client' where id=$1", [users[1]])
    await assert.rejects(contenders[0].query("insert into auth_members(id,user_id,organization_id,role) values($1,$1,$2,'analyst')", [users[6], org]))
    assert.equal(Number((await db.query('select count(*) from auth_members where organization_id=$1', [org])).rows[0].count), 5)
    console.log(JSON.stringify({ ok: true, verified: ['concurrent_membership_quota_serialized_as_auth_role', 'inactive_workspace_admission_denied', 'expired_trial_admission_denied_even_with_internal_plan', 'downgrade_preserves_members_and_role_updates'], providerCalls: 0 }))
  } finally { await cleanup(); await Promise.allSettled(contenders.map((client) => client.end())); await db.end() }
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
