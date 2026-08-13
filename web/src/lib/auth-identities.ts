import 'server-only'

import { eq } from 'drizzle-orm'
import { authUsers } from '@/db/schema'
import { withSystemTransaction } from '@/db/transactions'

export function authUser(userId: string) {
  return withSystemTransaction((db) => db.query.authUsers.findFirst({ where: eq(authUsers.id, userId) }))
}

export async function verifiedAuthUserEmail(userId: string) {
  const user = await authUser(userId)
  return user?.emailVerified ? user.email.toLowerCase() : null
}
