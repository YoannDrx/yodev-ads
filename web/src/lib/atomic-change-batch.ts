import { z } from 'zod'
import type { AtomicGoogleAdsOperation } from '@/lib/google-ads'

export const ATOMIC_BATCH_KINDS = ['campaign_status', 'campaign_budget', 'keyword_status', 'ad_status'] as const
export type AtomicBatchKind = (typeof ATOMIC_BATCH_KINDS)[number]

export type AtomicBatchSource = {
  id: string
  kind: string
  resourceName: string | null
  payload: Record<string, unknown>
  expectedState: Record<string, unknown> | null
  proposedState: Record<string, unknown> | null
}

const status = z.enum(['ENABLED', 'PAUSED'])

export function atomicOperationFromApproval(source: AtomicBatchSource): AtomicGoogleAdsOperation {
  if (!ATOMIC_BATCH_KINDS.includes(source.kind as AtomicBatchKind)) throw new Error(`Mutation ${source.kind} non compatible avec un batch atomique.`)
  if (!source.resourceName || !source.expectedState || !source.proposedState) throw new Error('Une proposition du batch est incomplète.')
  const campaignId = z.string().regex(/^\d+$/).parse(source.payload.campaignId)
  if (source.kind === 'campaign_budget') {
    return {
      kind: 'campaign_budget',
      campaignId,
      resourceName: source.resourceName,
      amountMicros: z.string().regex(/^\d+$/).parse(source.payload.amountMicros),
    }
  }
  const operationStatus = status.parse(source.payload.status)
  return { kind: source.kind as Exclude<AtomicBatchKind, 'campaign_budget'>, campaignId, resourceName: source.resourceName, status: operationStatus }
}

export function atomicChangeBatchState(sources: AtomicBatchSource[], state: 'expectedState' | 'proposedState') {
  if (sources.length < 2 || sources.length > 20) throw new Error('Un batch atomique doit contenir entre 2 et 20 propositions.')
  const sorted = [...sources].sort((left, right) => left.id.localeCompare(right.id))
  const resources = new Set<string>()
  return {
    atomic: true,
    partialFailure: false,
    changes: sorted.map((source) => {
      if (!source.resourceName || !source[state]) throw new Error('Une proposition du batch est incomplète.')
      if (resources.has(source.resourceName)) throw new Error('Une ressource ne peut apparaître qu’une fois dans le batch.')
      resources.add(source.resourceName)
      return { sourceApprovalId: source.id, kind: source.kind, state: source[state] }
    }),
  }
}
