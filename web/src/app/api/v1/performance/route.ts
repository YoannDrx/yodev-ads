import { z } from 'zod'
import { apiData, apiError, ApiV1Error, authenticateApiRequest } from '@/lib/api-v1'
import { getApiPerformance } from '@/lib/api-v1-repository'

const querySchema = z.object({
  clientId: z.string().uuid(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
})

export async function GET(request: Request) {
  const requestId = crypto.randomUUID()
  try {
    const credential = await authenticateApiRequest(request, 'performance:read')
    const input = querySchema.parse(Object.fromEntries(new URL(request.url).searchParams))
    if (input.from > input.to) throw new ApiV1Error('INVALID_DATE_RANGE', '`from` must precede `to`', 400)
    const historyDays = ({ trial: 30, solo: 90, studio: 365, agency: 730, internal: 730 } as const)[credential.entitlements.plan]
    const earliest = new Date()
    earliest.setUTCDate(earliest.getUTCDate() - historyDays)
    if (input.from < earliest.toISOString().slice(0, 10)) {
      throw new ApiV1Error('HISTORY_LIMIT_EXCEEDED', 'Requested period exceeds the plan history limit', 403, { historyDays })
    }
    const { client, metrics } = await getApiPerformance({
      workspaceId: credential.workspace.id,
      actorId: `api-key:${credential.key.id}`,
      clientId: input.clientId,
      from: input.from,
      to: input.to,
    })
    return apiData({ client, period: { from: input.from, to: input.to }, metrics }, requestId)
  } catch (error) {
    if (error instanceof z.ZodError) return apiError(new ApiV1Error('INVALID_QUERY', 'Invalid performance query', 400, { issues: error.issues }), requestId)
    return apiError(error, requestId)
  }
}
