import { z } from 'zod'
import { apiData, apiError, ApiV1Error, authenticateApiRequest, decodeCursor, pageResult } from '@/lib/api-v1'
import { createShareToken, hashToken } from '@/lib/tokens'
import { createApiReport, listApiReports } from '@/lib/api-v1-repository'

export async function GET(request: Request) {
  const requestId = crypto.randomUUID()
  try {
    const credential = await authenticateApiRequest(request, 'reports:read')
    const query = z.object({ cursor: z.string().max(500).optional(), limit: z.coerce.number().int().min(1).max(100).default(50) })
      .parse(Object.fromEntries(new URL(request.url).searchParams))
    const cursor = decodeCursor(query.cursor ?? null)
    const reports = await listApiReports({
      workspaceId: credential.workspace.id,
      actorId: `api-key:${credential.key.id}`,
      cursor,
      limit: query.limit,
    })
    const page = pageResult(reports, query.limit, (row) => ({ at: row.report.createdAt, id: row.report.id }))
    return apiData(page.data, requestId, page.nextCursor)
  } catch (error) {
    return apiError(error, requestId)
  }
}

const createSchema = z.object({ clientId: z.string().uuid(), label: z.string().trim().min(2).max(160) })

export async function POST(request: Request) {
  const requestId = crypto.randomUUID()
  try {
    const credential = await authenticateApiRequest(request, 'reports:write', 'api.propose')
    if (!['agency', 'internal'].includes(credential.entitlements.plan)) {
      throw new ApiV1Error('ENTITLEMENT_REQUIRED', 'Report creation through API requires Agency', 403)
    }
    const input = createSchema.parse(await request.json())
    const token = createShareToken()
    const report = await createApiReport({
      workspaceId: credential.workspace.id,
      actorId: `api-key:${credential.key.id}`,
      clientId: input.clientId,
      label: input.label,
      tokenHash: hashToken(token),
      tokenPrefix: token.slice(0, 12),
      entitlements: credential.entitlements,
    })
    return apiData({ report, token }, requestId, null, 201)
  } catch (error) {
    if (error instanceof z.ZodError) return apiError(new ApiV1Error('INVALID_BODY', 'Invalid report body', 400, { issues: error.issues }), requestId)
    return apiError(error, requestId)
  }
}
