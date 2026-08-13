import type { Plan } from '@/lib/entitlements'

export type SafetyPolicyScope = 'workspace' | 'client' | 'campaign'

export function assertSafetyPolicyScope(plan: Plan, scope: SafetyPolicyScope) {
  if ((plan === 'trial' || plan === 'solo') && scope !== 'workspace') {
    throw new Error('Les règles par client sont disponibles à partir du plan Studio.')
  }
  if (plan === 'studio' && scope === 'campaign') {
    throw new Error('Les règles par campagne sont réservées au plan Agency.')
  }
  return scope
}
