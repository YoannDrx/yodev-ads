import 'server-only'

import { z } from 'zod'
import {
  accountNegativeKeywordApprovalState,
  type AccountNegativeKeywordState,
  GoogleAdsGateway,
  type NegativeKeywordScope,
} from '@/lib/google-ads'

export const keywordCreationPayloadSchema = z.object({
  scope: z.enum(['ad_group', 'campaign', 'account']).default('ad_group'),
  campaignId: z.string().regex(/^\d+$/),
  campaignIds: z.array(z.string().regex(/^\d+$/)).max(500).optional(),
  adGroupId: z.string().regex(/^\d+$/).optional(),
  keywordText: z.string().trim().min(1).max(80),
  matchType: z.enum(['EXACT', 'PHRASE', 'BROAD']),
  negative: z.boolean(),
})

export type KeywordCreationPayload = z.infer<typeof keywordCreationPayloadSchema>

export type KeywordCreationContext = {
  scope: NegativeKeywordScope
  approvalState: Record<string, unknown>
  resourceName: string
  operationCount: number
  accountState?: AccountNegativeKeywordState
}

export async function currentKeywordCreationContext(
  gateway: GoogleAdsGateway,
  customerId: string,
  rawPayload: KeywordCreationPayload,
): Promise<KeywordCreationContext> {
  const payload = keywordCreationPayloadSchema.parse(rawPayload)
  if (!payload.negative && payload.scope !== 'ad_group') {
    throw new Error('Un mot-clé positif ne peut être créé qu’au niveau du groupe d’annonces.')
  }
  if (payload.scope === 'ad_group') {
    if (!payload.adGroupId) throw new Error('Le groupe d’annonces est requis pour cette portée.')
    const state = await gateway.keywordTextState(customerId, payload.adGroupId, payload.keywordText)
    if (state.campaignId !== BigInt(payload.campaignId).toString()) {
      throw new Error('Le groupe d’annonces ne correspond pas à la campagne transmise.')
    }
    return { scope: payload.scope, approvalState: state, resourceName: state.adGroupResourceName, operationCount: 1 }
  }
  if (payload.scope === 'campaign') {
    const state = await gateway.campaignNegativeKeywordState(customerId, payload.campaignId, payload.keywordText)
    return { scope: payload.scope, approvalState: state, resourceName: state.campaignResourceName, operationCount: 1 }
  }
  const accountState = await gateway.accountNegativeKeywordState(customerId, payload.keywordText)
  return {
    scope: payload.scope,
    approvalState: accountNegativeKeywordApprovalState(accountState),
    resourceName: accountState.customerResourceName,
    operationCount: 1 + (accountState.sharedSetResourceName ? 0 : 1) + (accountState.attached ? 0 : 1),
    accountState,
  }
}

export function proposedKeywordCreationState(context: KeywordCreationContext, payload: KeywordCreationPayload) {
  const expected = context.approvalState
  const normalizedText = String(expected.normalizedText ?? payload.keywordText.trim().replace(/\s+/g, ' ').toLocaleLowerCase('und'))
  return {
    ...expected,
    ...(context.scope === 'account' ? { configured: true } : {}),
    matches: [{ text: normalizedText, matchType: payload.matchType, negative: payload.negative, status: 'ENABLED' }],
  }
}

export async function mutateKeywordCreation(
  gateway: GoogleAdsGateway,
  customerId: string,
  payload: KeywordCreationPayload,
  context: KeywordCreationContext,
  validateOnly = false,
) {
  if (payload.scope !== context.scope) throw new Error('La portée du mot-clé a changé.')
  if (payload.scope === 'ad_group') {
    if (!payload.adGroupId) throw new Error('Le groupe d’annonces est requis pour cette portée.')
    return gateway.mutateKeywordCreate(
      customerId,
      payload.adGroupId,
      payload.keywordText,
      payload.matchType,
      payload.negative,
      validateOnly,
    )
  }
  if (!payload.negative) throw new Error('Les portées campagne et compte acceptent uniquement des mots-clés négatifs.')
  if (payload.scope === 'campaign') {
    return gateway.mutateCampaignNegativeKeyword(
      customerId,
      payload.campaignId,
      payload.keywordText,
      payload.matchType,
      validateOnly,
    )
  }
  if (!context.accountState) throw new Error('L’état de la liste négative compte est indisponible.')
  return gateway.mutateAccountNegativeKeyword(
    customerId,
    context.accountState,
    payload.keywordText,
    payload.matchType,
    validateOnly,
  )
}
