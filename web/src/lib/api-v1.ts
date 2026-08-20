import 'server-only'

import { createHash, createHmac } from 'node:crypto'
import { and, eq, isNull, or, sql } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { apiKeys, auditEvents, rateLimitBuckets, workspaces } from '@/db/schema'
import { withSystemTransaction } from '@/db/transactions'
import { entitlementContext, isPlan, isWorkspaceAccessState, type Capability } from '@/lib/entitlements'
import { featureEnabled, privateApiWorkspaceAllowed } from '@/lib/feature-flags'
import { hashToken } from '@/lib/tokens'

export type ApiScope =
  | 'portfolio:read'
  | 'performance:read'
  | 'alerts:read'
  | 'approvals:read'
  | 'approvals:propose'
  | 'reports:read'
  | 'reports:write'

export class ApiV1Error extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message)
  }
}

export function apiData<T>(data: T, requestId: string, nextCursor: string | null = null, status = 200) {
  return NextResponse.json({ data, meta: { requestId, nextCursor } }, { status, headers: { 'X-Request-Id': requestId } })
}

export function apiError(error: unknown, requestId: string) {
  const known = error instanceof ApiV1Error
  const code = known ? error.code : 'INTERNAL_ERROR'
  const message = known ? error.message : 'An unexpected error occurred'
  const status = known ? error.status : 500
  const details = known ? error.details : {}
  return NextResponse.json(
    { error: { code, message, requestId, details } },
    { status, headers: { 'X-Request-Id': requestId } },
  )
}

const cursorSchema = z.object({ at: z.string().datetime(), id: z.string().uuid() })

export type CursorValue = { at: Date; id: string }

export function encodeCursor(value: { at: Date; id: string }) {
  return Buffer.from(JSON.stringify({ at: value.at.toISOString(), id: value.id }), 'utf8').toString('base64url')
}

export function decodeCursor(value: string | null) {
  if (!value) return null
  try {
    const decoded = cursorSchema.parse(JSON.parse(Buffer.from(value, 'base64url').toString('utf8')))
    return { at: new Date(decoded.at), id: decoded.id }
  } catch {
    throw new ApiV1Error('INVALID_CURSOR', 'Cursor is invalid', 400)
  }
}

export function pageResult<T>(rows: T[], limit: number, cursorOf: (value: T) => { at: Date; id: string }) {
  const hasMore = rows.length > limit
  const page = rows.slice(0, limit)
  const last = page.at(-1)
  return {
    data: page,
    nextCursor: hasMore && last ? encodeCursor(cursorOf(last)) : null,
  }
}

function minuteWindow(date: Date) {
  return new Date(Math.floor(date.getTime() / 60_000) * 60_000)
}

async function consumeApiRateLimit(workspaceId: string, keyId: string, now = new Date()) {
  const windowStart = minuteWindow(now)
  const keyHash = createHash('sha256').update(`api-key:${keyId}`).digest('hex')
  const [bucket] = await withSystemTransaction((db) => db
      .insert(rateLimitBuckets)
      .values({
        workspaceId,
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
  if (bucket.count > 120) throw new ApiV1Error('RATE_LIMITED', 'API rate limit exceeded', 429, { retryAfterSeconds: 60 })
}

function requestIpHash(request: Request) {
  const key = process.env.API_IP_HASH_KEY ?? process.env.LEGAL_FINGERPRINT_KEY ?? process.env.APP_ENCRYPTION_KEY
  if (!key) throw new ApiV1Error('SERVER_MISCONFIGURED', 'API security hashing is not configured', 503)
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
  return createHmac('sha256', key).update(ip).digest('hex')
}

export async function authenticateApiRequest(
  request: Request,
  requiredScope: ApiScope,
  requiredCapability: Capability = 'api.read',
) {
  if (!featureEnabled('publicApi')) throw new ApiV1Error('FEATURE_DISABLED', 'Private API beta is disabled', 503)
  const authorization = request.headers.get('authorization')
  const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : ''
  if (!token.startsWith('ya_live_')) throw new ApiV1Error('INVALID_API_KEY', 'Invalid API key', 401)

  const now = new Date()
  const [credential] = await withSystemTransaction((db) => db
      .select({ key: apiKeys, workspace: workspaces })
      .from(apiKeys)
      .innerJoin(workspaces, eq(workspaces.id, apiKeys.workspaceId))
      .where(
        and(
          eq(apiKeys.tokenHash, hashToken(token)),
          isNull(apiKeys.revokedAt),
          or(isNull(apiKeys.expiresAt), sql`${apiKeys.expiresAt} > ${now}`),
        ),
      )
      .limit(1))
  if (!credential) throw new ApiV1Error('INVALID_API_KEY', 'Invalid or expired API key', 401)
  if (!privateApiWorkspaceAllowed(credential.workspace.id, credential.workspace.accessState)) {
    throw new ApiV1Error('FEATURE_DISABLED', 'Private API beta is disabled for this workspace', 503)
  }
  if (!isPlan(credential.workspace.plan) || !isWorkspaceAccessState(credential.workspace.accessState)) {
    throw new ApiV1Error('WORKSPACE_SUSPENDED', 'Workspace access is unavailable', 403)
  }
  const entitlements = entitlementContext(credential.workspace.accessState, credential.workspace.plan)
  if (!entitlements.capabilities.has(requiredCapability)) {
    throw new ApiV1Error('ENTITLEMENT_REQUIRED', `Capability required: ${requiredCapability}`, 403)
  }
  if (!credential.key.scopes.includes(requiredScope)) {
    throw new ApiV1Error('INSUFFICIENT_SCOPE', `API scope required: ${requiredScope}`, 403)
  }
  await consumeApiRateLimit(credential.workspace.id, credential.key.id, now)
  await withSystemTransaction((db) => db
    .update(apiKeys)
    .set({ lastUsedAt: now, lastIpHash: requestIpHash(request), updatedAt: now })
    .where(eq(apiKeys.id, credential.key.id)))
  const path = new URL(request.url).pathname
  await withSystemTransaction((db) => db.insert(auditEvents).values({
    workspaceId: credential.workspace.id,
    actorUserId: `api-key:${credential.key.id}`,
    action: 'api.request',
    entityType: 'api_key',
    entityId: credential.key.id,
    metadata: { method: request.method, path, scope: requiredScope },
  }))
  return { ...credential, entitlements }
}
