import { z } from 'zod'
import { apiData, apiError, authenticateApiRequest, decodeCursor, pageResult } from '@/lib/api-v1'
import { listApiAlerts } from '@/lib/api-v1-repository'

const querySchema = z.object({
  status: z.enum(['open', 'acknowledged', 'snoozed', 'resolved', 'reopened']).optional(),
  cursor: z.string().max(500).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
})

export async function GET(request: Request) {
  const requestId = crypto.randomUUID()
  try {
    const credential = await authenticateApiRequest(request, 'alerts:read')
    const input = querySchema.parse(Object.fromEntries(new URL(request.url).searchParams))
    const cursor = decodeCursor(input.cursor ?? null)
    const rows = await listApiAlerts({
      workspaceId: credential.workspace.id,
      actorId: `api-key:${credential.key.id}`,
      status: input.status,
      cursor,
      limit: input.limit,
    })
    const page = pageResult(rows, input.limit, (row) => ({ at: row.alert.detectedAt, id: row.alert.id }))
    return apiData(page.data, requestId, page.nextCursor)
  } catch (error) {
    return apiError(error, requestId)
  }
}
