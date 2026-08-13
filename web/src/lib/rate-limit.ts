import 'server-only'

import { createHmac } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { rateLimitBuckets } from '@/db/schema'
import { withSystemTransaction } from '@/db/transactions'

function pseudonym(value: string) {
  const key = process.env.RATE_LIMIT_HASH_KEY ?? process.env.APP_ENCRYPTION_KEY
  if (!key) throw new Error('RATE_LIMIT_HASH_KEY is not configured')
  return createHmac('sha256', key).update(value).digest('hex')
}

export function fixedWindow(input: { now: Date; windowMs: number }) {
  if (!Number.isInteger(input.windowMs) || input.windowMs <= 0) throw new Error('Rate limit window must be positive')
  const windowStart = new Date(Math.floor(input.now.getTime() / input.windowMs) * input.windowMs)
  const retryAfterSeconds = Math.max(1, Math.ceil((windowStart.getTime() + input.windowMs - input.now.getTime()) / 1000))
  return { windowStart, retryAfterSeconds }
}

export function requestIp(headers: Headers) {
  return headers.get('x-forwarded-for')?.split(',')[0]?.trim() || headers.get('x-real-ip') || 'unknown'
}

export async function consumeRateLimit(input: {
  workspaceId?: string | null
  namespace: string
  identity: string
  limit: number
  windowMs: number
  now?: Date
}) {
  const now = input.now ?? new Date()
  const { windowStart, retryAfterSeconds } = fixedWindow({ now, windowMs: input.windowMs })
  const keyHash = pseudonym(`${input.namespace}:${input.identity}`)
  const [bucket] = await withSystemTransaction((db) => db
    .insert(rateLimitBuckets)
    .values({
      workspaceId: input.workspaceId ?? null,
      keyHash,
      windowStart,
      count: 1,
      expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60_000),
    })
    .onConflictDoUpdate({
      target: [rateLimitBuckets.keyHash, rateLimitBuckets.windowStart],
      set: { count: sql`${rateLimitBuckets.count} + 1`, updatedAt: now },
    })
    .returning({ count: rateLimitBuckets.count }))
  return { allowed: bucket.count <= input.limit, count: bucket.count, limit: input.limit, retryAfterSeconds }
}

export async function consumePublicReportRateLimits(input: {
  workspaceId: string
  token: string
  ip: string
  pdf?: boolean
}) {
  const hour = 60 * 60_000
  const ip = await consumeRateLimit({
    workspaceId: input.workspaceId,
    namespace: input.pdf ? 'public-report-pdf-ip' : 'public-report-ip',
    identity: input.ip,
    limit: input.pdf ? 20 : 60,
    windowMs: hour,
  })
  if (!ip.allowed) return { allowed: false, retryAfterSeconds: ip.retryAfterSeconds }
  const token = await consumeRateLimit({
    workspaceId: input.workspaceId,
    namespace: 'public-report-token',
    identity: input.token,
    limit: 300,
    windowMs: hour,
  })
  return { allowed: ip.allowed && token.allowed, retryAfterSeconds: Math.max(ip.retryAfterSeconds, token.retryAfterSeconds) }
}
