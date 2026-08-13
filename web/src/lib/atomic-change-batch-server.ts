import 'server-only'

import { z } from 'zod'
import type { AtomicBatchSource } from '@/lib/atomic-change-batch'
import { GoogleAdsGateway } from '@/lib/google-ads'

export const storedAtomicBatchSourceSchema = z.object({
  id: z.string().uuid(),
  kind: z.enum(['campaign_status', 'campaign_budget', 'keyword_status', 'ad_status']),
  resourceName: z.string().min(1),
  payload: z.record(z.string(), z.unknown()),
})

export const atomicOperationSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('campaign_status'), campaignId: z.string().regex(/^\d+$/), resourceName: z.string(), status: z.enum(['ENABLED', 'PAUSED']) }),
  z.object({ kind: z.literal('campaign_budget'), campaignId: z.string().regex(/^\d+$/), resourceName: z.string(), amountMicros: z.string().regex(/^\d+$/) }),
  z.object({ kind: z.literal('keyword_status'), campaignId: z.string().regex(/^\d+$/), resourceName: z.string(), status: z.enum(['ENABLED', 'PAUSED']) }),
  z.object({ kind: z.literal('ad_status'), campaignId: z.string().regex(/^\d+$/), resourceName: z.string(), status: z.enum(['ENABLED', 'PAUSED']) }),
])

export async function currentAtomicBatchSource(
  gateway: GoogleAdsGateway,
  customerId: string,
  source: z.infer<typeof storedAtomicBatchSourceSchema>,
): Promise<AtomicBatchSource> {
  const campaignId = z.string().regex(/^\d+$/).parse(source.payload.campaignId)
  let currentState: Record<string, unknown>
  if (source.kind === 'campaign_status' || source.kind === 'campaign_budget') {
    const campaign = await gateway.campaignMutationState(customerId, campaignId)
    currentState = source.kind === 'campaign_status'
      ? { resourceName: campaign.campaignResourceName, status: campaign.status }
      : {
          resourceName: campaign.budgetResourceName,
          amountMicros: campaign.budgetMicros,
          explicitlyShared: campaign.budgetExplicitlyShared,
          referenceCount: campaign.budgetReferenceCount,
        }
  } else if (source.kind === 'keyword_status') {
    currentState = await gateway.keywordCriterionState(
      customerId,
      z.string().regex(/^\d+$/).parse(source.payload.adGroupId),
      z.string().regex(/^\d+$/).parse(source.payload.criterionId),
    )
  } else {
    currentState = await gateway.adGroupAdMutationState(
      customerId,
      z.string().regex(/^\d+$/).parse(source.payload.adGroupId),
      z.string().regex(/^\d+$/).parse(source.payload.adId),
    )
  }
  if (currentState.resourceName !== source.resourceName) throw new Error('Une ressource du batch ne correspond plus à Google Ads.')
  return { ...source, expectedState: currentState, proposedState: currentState }
}
