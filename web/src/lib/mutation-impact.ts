export type MutationConflict = {
  code: string
  severity: 'info' | 'warning' | 'blocking'
  message: string
  resourceName?: string
}

export type MutationImpactPreview = {
  atomic: boolean
  partialFailure: false
  operationCount: number
  summary: string
  affectedResources: string[]
  conflicts: MutationConflict[]
  observationWindowDays: number
}

export function mutationConflicts(
  kind: string,
  expectedState: Record<string, unknown>,
  proposedState: Record<string, unknown>,
): MutationConflict[] {
  if (stateHash(expectedState) === stateHash(proposedState)) {
    return [{ code: 'NO_EFFECT', severity: 'blocking', message: 'La ressource possède déjà l’état demandé.' }]
  }
  const conflicts: MutationConflict[] = []
  if ((kind === 'campaign_status' || kind === 'keyword_status' || kind === 'ad_status') && proposedState.status === 'PAUSED') {
    conflicts.push({
      code: 'TRAFFIC_INTERRUPTION',
      severity: 'warning',
      message: kind === 'campaign_status'
        ? 'La campagne ne diffusera plus après cette suspension.'
        : 'Cet élément ne participera plus à la diffusion après cette suspension.',
      resourceName: typeof proposedState.resourceName === 'string' ? proposedState.resourceName : undefined,
    })
  }
  if (kind === 'campaign_budget' && expectedState.explicitlyShared === true) {
    conflicts.push({
      code: 'SHARED_BUDGET',
      severity: 'warning',
      message: `Le budget est partagé par ${String(expectedState.referenceCount ?? 'plusieurs')} campagnes.`,
      resourceName: typeof expectedState.resourceName === 'string' ? expectedState.resourceName : undefined,
    })
  }
  if (kind === 'keyword_create_negative') {
    conflicts.push({ code: 'NEGATIVE_TRAFFIC_FILTER', severity: 'warning', message: 'Le nouveau mot-clé négatif peut exclure des requêtes actuellement diffusées.' })
    if (proposedState.scope === 'campaign') {
      conflicts.push({
        code: 'CAMPAIGN_WIDE_TRAFFIC_FILTER',
        severity: 'warning',
        message: 'Cette exclusion s’appliquera à tous les groupes d’annonces de la campagne.',
        resourceName: typeof proposedState.campaignResourceName === 'string' ? proposedState.campaignResourceName : undefined,
      })
    }
    if (proposedState.scope === 'account') {
      conflicts.push({
        code: 'ACCOUNT_WIDE_TRAFFIC_FILTER',
        severity: 'warning',
        message: 'Cette exclusion s’appliquera à toutes les campagnes actuelles et futures du compte.',
        resourceName: typeof proposedState.customerResourceName === 'string' ? proposedState.customerResourceName : undefined,
      })
    }
  }
  if (kind === 'rsa_create_draft') {
    conflicts.push({ code: 'PAUSED_DRAFT', severity: 'info', message: 'Le RSA sera créé en pause et ne diffusera pas automatiquement.' })
  }
  return conflicts
}

function resourceNames(states: Array<Record<string, unknown>>) {
  return [...new Set(states.flatMap((state) => {
    const direct = typeof state.resourceName === 'string' ? [state.resourceName] : []
    const scoped = ['campaignResourceName', 'customerResourceName'].flatMap((field) =>
      typeof state[field] === 'string' ? [String(state[field])] : [],
    )
    const nested = Array.isArray(state.changes)
      ? state.changes.flatMap((change) => change && typeof change === 'object' && typeof (change as Record<string, unknown>).resourceName === 'string'
        ? [String((change as Record<string, unknown>).resourceName)]
        : [])
      : []
    return [...direct, ...scoped, ...nested]
  }))]
}

export function buildMutationImpactPreview(input: {
  kind: string
  expectedState: Record<string, unknown>
  proposedState: Record<string, unknown>
  conflicts?: MutationConflict[]
  summary: string
  atomic?: boolean
  operationCount?: number
  observationWindowDays?: number
}): MutationImpactPreview {
  const observationWindowDays = input.observationWindowDays ?? 7
  if (!Number.isInteger(observationWindowDays) || observationWindowDays < 1 || observationWindowDays > 30) {
    throw new Error('La fenêtre d’observation doit contenir entre 1 et 30 jours.')
  }
  const operationCount = input.operationCount ?? 1
  if (!Number.isInteger(operationCount) || operationCount < 1 || operationCount > 20) {
    throw new Error('Un aperçu doit contenir entre 1 et 20 opérations.')
  }
  return {
    atomic: input.atomic ?? operationCount > 1,
    partialFailure: false,
    operationCount,
    summary: input.summary,
    affectedResources: resourceNames([input.expectedState, input.proposedState]),
    conflicts: input.conflicts ?? [],
    observationWindowDays,
  }
}

export function mergeAtomicImpactPreviews(previews: MutationImpactPreview[], summary: string) {
  if (previews.length < 2 || previews.length > 20) throw new Error('Un batch atomique doit contenir entre 2 et 20 opérations.')
  const operationCount = previews.reduce((total, preview) => total + preview.operationCount, 0)
  if (operationCount > 20) throw new Error('Un batch atomique ne peut pas dépasser 20 opérations.')
  const conflicts = [...new Map(previews.flatMap((preview) => preview.conflicts).map((conflict) => [
    `${conflict.code}:${conflict.resourceName ?? ''}:${conflict.message}`,
    conflict,
  ])).values()]
  if (conflicts.some((conflict) => conflict.severity === 'blocking')) {
    throw new Error('Un batch atomique ne peut pas contenir un conflit bloquant.')
  }
  return {
    atomic: true,
    partialFailure: false,
    operationCount,
    summary,
    affectedResources: [...new Set(previews.flatMap((preview) => preview.affectedResources))],
    conflicts,
    observationWindowDays: Math.max(...previews.map((preview) => preview.observationWindowDays)),
  } satisfies MutationImpactPreview
}
import { stateHash } from '@/lib/approval-state'
