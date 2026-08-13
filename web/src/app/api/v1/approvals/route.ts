import { z } from 'zod'
import { apiData, apiError, ApiV1Error, authenticateApiRequest, decodeCursor, pageResult } from '@/lib/api-v1'
import { createApiApproval, getApiApprovalContext, listApiApprovals } from '@/lib/api-v1-repository'
import { stateHash } from '@/lib/approval-state'
import { assertBudgetChangeSafety } from '@/lib/budget-safety'
import { GoogleAdsGateway } from '@/lib/google-ads'

export async function GET(request: Request) {
  const requestId = crypto.randomUUID()
  try {
    const credential = await authenticateApiRequest(request, 'approvals:read')
    const query = z.object({ cursor: z.string().max(500).optional(), limit: z.coerce.number().int().min(1).max(100).default(50) })
      .parse(Object.fromEntries(new URL(request.url).searchParams))
    const cursor = decodeCursor(query.cursor ?? null)
    const rows = await listApiApprovals({
      workspaceId: credential.workspace.id,
      actorId: `api-key:${credential.key.id}`,
      cursor,
      limit: query.limit,
    })
    const page = pageResult(rows, query.limit, (row) => ({ at: row.approval.createdAt, id: row.approval.id }))
    return apiData(page.data, requestId, page.nextCursor)
  } catch (error) {
    return apiError(error, requestId)
  }
}

const proposalSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('campaign_status'),
    clientId: z.string().uuid(),
    campaignId: z.string().regex(/^\d+$/),
    status: z.enum(['ENABLED', 'PAUSED']),
  }),
  z.object({
    kind: z.literal('campaign_budget'),
    clientId: z.string().uuid(),
    campaignId: z.string().regex(/^\d+$/),
    budgetResourceName: z.string().min(1).max(300),
    dailyBudget: z.number().positive().max(10_000_000),
  }),
])

export async function POST(request: Request) {
  const requestId = crypto.randomUUID()
  try {
    const credential = await authenticateApiRequest(request, 'approvals:propose', 'api.propose')
    const input = proposalSchema.parse(await request.json())
    const actorId = `api-key:${credential.key.id}`
    const { client, connection } = await getApiApprovalContext({
      workspaceId: credential.workspace.id,
      actorId,
      clientId: input.clientId,
    })
    if (!client) throw new ApiV1Error('CLIENT_NOT_FOUND', 'Client not found', 404)
    if (!connection) throw new ApiV1Error('GOOGLE_NOT_CONNECTED', 'Google Ads connection is unavailable', 409)

    const gateway = new GoogleAdsGateway(connection)
    const current = await gateway.campaignMutationState(client.googleCustomerId, input.campaignId)
    let payload: Record<string, unknown>
    let expectedState: Record<string, unknown>
    let proposedState: Record<string, unknown>
    let resourceName: string
    let validationRequestId: string | null
    let title: string

    if (input.kind === 'campaign_status') {
      validationRequestId = (await gateway.validateCampaignStatus(client.googleCustomerId, input.campaignId, input.status)).requestId
      resourceName = current.campaignResourceName
      payload = { campaignId: input.campaignId, status: input.status }
      expectedState = { resourceName, status: current.status }
      proposedState = { resourceName, status: input.status }
      title = `${input.status === 'PAUSED' ? 'Suspendre' : 'Activer'} « ${current.campaignName} »`
    } else {
      if (current.budgetResourceName !== input.budgetResourceName) {
        throw new ApiV1Error('GOOGLE_STATE_DRIFT', 'Campaign budget no longer matches the proposal', 409)
      }
      const amountMicros = String(Math.round(input.dailyBudget * 1_000_000))
      await assertBudgetChangeSafety({
        workspace: credential.workspace,
        client,
        campaignId: input.campaignId,
        currentBudgetMicros: current.budgetMicros,
        proposedBudgetMicros: amountMicros,
      })
      validationRequestId = (await gateway.validateBudget(client.googleCustomerId, input.budgetResourceName, amountMicros)).requestId
      resourceName = current.budgetResourceName
      payload = { campaignId: input.campaignId, budgetResourceName: input.budgetResourceName, amountMicros, dailyBudget: input.dailyBudget }
      expectedState = {
        resourceName,
        amountMicros: current.budgetMicros,
        explicitlyShared: current.budgetExplicitlyShared,
        referenceCount: current.budgetReferenceCount,
      }
      proposedState = { ...expectedState, amountMicros }
      title = `Budget de « ${current.campaignName} » à ${input.dailyBudget} ${client.currencyCode}/j`
    }

    const approval = await createApiApproval({
      workspaceId: credential.workspace.id,
      actorId,
      clientId: client.id,
      kind: input.kind,
      title,
      payload,
      resourceName,
      expectedState,
      proposedState,
      expectedStateHash: stateHash(expectedState),
      requiredApprovals: credential.workspace.requiredApprovals,
      validationRequestId,
      requestId,
    })
    return apiData(approval, requestId, null, 201)
  } catch (error) {
    if (error instanceof z.ZodError) return apiError(new ApiV1Error('INVALID_BODY', 'Invalid approval proposal', 400, { issues: error.issues }), requestId)
    return apiError(error, requestId)
  }
}
