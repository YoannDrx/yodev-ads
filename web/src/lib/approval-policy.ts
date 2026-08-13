import type { Plan } from '@/lib/entitlements'

export type ApprovalPolicyInput = { requiredApprovals: 1 | 2; allowSelfApproval: boolean }

export function approvalPolicyForPlan(plan: Plan, input: ApprovalPolicyInput) {
  if ((plan === 'trial' || plan === 'solo') && input.requiredApprovals !== 1) {
    throw new Error('La double approbation est disponible à partir du plan Studio.')
  }
  if ((plan === 'trial' || plan === 'agency') && input.allowSelfApproval) {
    throw new Error('L’auto-approbation est désactivée pour ce plan.')
  }
  return {
    requiredApprovals: input.requiredApprovals,
    allowSelfApproval: plan === 'trial' || plan === 'agency' ? false : input.allowSelfApproval,
    approvalMode: input.requiredApprovals === 2 ? 'dual' as const : 'single' as const,
  }
}
