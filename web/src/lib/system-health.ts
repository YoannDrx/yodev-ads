import 'server-only'

import { sql } from 'drizzle-orm'
import { withSystemTransaction } from '@/db/transactions'

export async function verifyDatabaseReachability() {
  await withSystemTransaction((db) => db.execute(sql`select 1`))
}
