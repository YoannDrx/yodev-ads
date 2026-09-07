import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, readdir, copyFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pg from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'

const url = new URL(process.env.YODEV_TEST_DATABASE_URL ?? '')
assert(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && url.pathname.startsWith('/yodev_test'), 'Disposable local empty database required')
const pool = new pg.Pool({ connectionString: url.href, connectionTimeoutMillis: 10_000 })
const folder = await mkdtemp(join(tmpdir(), 'yodev-selection-upgrade-'))
try {
  assert.equal((await pool.query("select to_regclass('public.clients') as existing")).rows[0].existing, null, 'Use a new empty test database')
  await mkdir(join(folder, 'meta'))
  const journal = JSON.parse(await readFile('drizzle/meta/_journal.json', 'utf8'))
  const beforeSelection = journal.entries.filter((entry) => entry.idx < 49)
  await writeFile(join(folder, 'meta/_journal.json'), JSON.stringify({ ...journal, entries: beforeSelection }))
  for (const file of await readdir('drizzle')) if (/^\d+.*\.sql$/.test(file) && Number(file.slice(0, 4)) < 49) await copyFile(join('drizzle', file), join(folder, file))
  const db = drizzle(pool)
  await migrate(db, { migrationsFolder: folder })
  const workspaceId = '76000000-0000-4000-8000-000000000001'
  await pool.query("insert into workspaces(id,owner_user_id,name,slug,plan,access_state) values($1,'upgrade-fixture','Upgrade fixture','selection-upgrade-fixture','studio','active')", [workspaceId])
  for (let index = 0; index < 6; index++) await pool.query('insert into clients(workspace_id,google_customer_id,name,is_manager,active) values($1,$2,$3,$4,$5)', [workspaceId, String(7600000000 + index), `Legacy ${index}`, index < 2, index < 5])
  const previous = (await pool.query('select id,active,is_manager,google_customer_id from clients where workspace_id=$1 order by google_customer_id', [workspaceId])).rows
  await migrate(db, { migrationsFolder: 'drizzle' })
  const migrated = (await pool.query('select id,active,is_manager,google_customer_id,managed_selected,management_priority,google_accessible,inventory_observed_at from clients where workspace_id=$1 order by google_customer_id', [workspaceId])).rows
  for (const [index, account] of migrated.entries()) {
    assert.equal(account.id, previous[index].id)
    assert.equal(account.active, previous[index].active)
    assert.equal(account.managed_selected, previous[index].active && !previous[index].is_manager)
    assert.equal(account.google_accessible, previous[index].active)
    assert.equal(account.inventory_observed_at, null, 'Legacy access is not a newly observed inventory')
    if (!account.is_manager) assert.equal(account.management_priority, index - 1)
  }
  const count = (await pool.query('select count(*) from drizzle.__drizzle_migrations')).rows[0].count
  assert.equal(count, '50')
  await pool.query('delete from workspaces where id=$1', [workspaceId])
  console.log(JSON.stringify({ ok: true, migrations: Number(count), verified: ['49_to_50_upgrade', 'active_advertisers_preserved', 'inactive_accounts_not_auto_selected', 'managers_free', 'stable_legacy_priority', 'no_fabricated_inventory_timestamp'], providerCalls: 0 }))
} finally {
  await pool.end()
  await rm(folder, { recursive: true, force: true })
}
