import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, writeFile, copyFile, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pg from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'

const base = new URL(process.env.YODEV_TEST_DATABASE_URL ?? 'postgresql://postgres@127.0.0.1:55438/yodev_test')
assert(['localhost', '127.0.0.1', '[::1]'].includes(base.hostname) && base.pathname.startsWith('/yodev_test'), 'Disposable local database required')
const databaseName = `yodev_test_domain_migration_${randomUUID().replaceAll('-', '')}`
const controlUrl = new URL(base); controlUrl.pathname = '/postgres'
const control = new pg.Client({ connectionString: controlUrl.href })
const databaseUrl = new URL(base); databaseUrl.pathname = `/${databaseName}`
const client = new pg.Client({ connectionString: databaseUrl.href })
const temp = await mkdtemp(join(tmpdir(), 'yodev-domain-migration-'))
const migrations = new URL('../drizzle/', import.meta.url).pathname
const journal = JSON.parse(await readFile(join(migrations, 'meta/_journal.json'), 'utf8'))
const last = journal.entries.find((entry) => entry.tag === '0060_domain_cleanup_reservations')
assert(last)
const old = journal.entries.filter((entry) => entry.idx < last.idx)
await mkdir(join(temp, 'meta'))
await writeFile(join(temp, 'meta/_journal.json'), JSON.stringify({ ...journal, entries: old }))
for (const entry of old) await copyFile(join(migrations, `${entry.tag}.sql`), join(temp, `${entry.tag}.sql`))
await control.connect()
try {
  await control.query(`create database "${databaseName}"`)
  await client.connect()
  const database = drizzle(client)
  await migrate(database, { migrationsFolder: temp })
  assert.equal(Number((await client.query('select count(*) from drizzle.__drizzle_migrations')).rows[0].count), 60)
  const payload = { workspaceHash: 'a'.repeat(64), logoUrl: null, hostnames: ['legacy-cleanup.example.test'] }
  await client.query("insert into jobs(type,payload,deduplication_key,status) values('workspace.external_cleanup',$1,'legacy-cleanup','dead_letter')", [JSON.stringify(payload)])
  await migrate(database, { migrationsFolder: migrations })
  assert.equal(Number((await client.query('select count(*) from drizzle.__drizzle_migrations')).rows[0].count), journal.entries.length)
  const reservation = (await client.query('select hostname,workspace_hash,released_at from workspace_domain_cleanup_reservations')).rows[0]
  assert.deepEqual(reservation, { hostname: payload.hostnames[0], workspace_hash: payload.workspaceHash, released_at: null })
  await client.query("delete from jobs where deduplication_key='legacy-cleanup'")
  assert.equal((await client.query('select * from workspace_domain_cleanup_reservations')).rowCount, 1)
  await migrate(database, { migrationsFolder: migrations })
  assert.equal((await client.query('select * from workspace_domain_cleanup_reservations')).rowCount, 1)
  console.log(JSON.stringify({ ok: true, migrations: journal.entries.length, verified: ['fresh_0000_through_0059', 'legacy_dead_letter_cleanup_backfilled_by_0060', 'reservation_survives_terminal_job_deletion', 'migration_replay_idempotent'], realProviderCalls: 0 }))
} finally {
  await client.end().catch(() => {})
  await control.query(`drop database if exists "${databaseName}" with (force)`)
  await control.end(); await rm(temp, { recursive: true, force: true })
}
