import 'server-only'

export type WorkspaceAccessState =
  | 'internal'
  | 'trial'
  | 'active'
  | 'grace'
  | 'suspended'
  | 'deletion_pending'
  | 'deleted'

export type Plan = 'trial' | 'solo' | 'studio' | 'agency' | 'internal'

export type Capability =
  | 'google.read'
  | 'google.mutate.basic'
  | 'google.mutate.advanced'
  | 'monitoring'
  | 'notifications.webhook'
  | 'reports.white_label'
  | 'api.read'
  | 'api.propose'
  | 'approvals.dual'
  | 'custom_domain'
  | 'collaboration'

export type QuotaResource = 'advertiserAccounts' | 'members' | 'monitors' | 'reports' | 'notificationChannels' | 'apiKeys'

export type EntitlementContext = {
  state: WorkspaceAccessState
  plan: Plan
  limits: Record<QuotaResource, number | null>
  capabilities: ReadonlySet<Capability>
}

type PlanDefinition = {
  limits: EntitlementContext['limits']
  capabilities: readonly Capability[]
}

const planDefinitions: Record<Plan, PlanDefinition> = {
  trial: {
    limits: { advertiserAccounts: 1, members: 1, monitors: 3, reports: 1, notificationChannels: 1, apiKeys: 0 },
    capabilities: ['google.read', 'monitoring'],
  },
  solo: {
    limits: { advertiserAccounts: 3, members: 1, monitors: 5, reports: 3, notificationChannels: 1, apiKeys: 0 },
    capabilities: ['google.read', 'google.mutate.basic', 'monitoring'],
  },
  studio: {
    limits: { advertiserAccounts: 15, members: 5, monitors: 50, reports: 25, notificationChannels: 10, apiKeys: 5 },
    capabilities: [
      'google.read',
      'google.mutate.basic',
      'google.mutate.advanced',
      'monitoring',
      'notifications.webhook',
      'reports.white_label',
      'api.read',
      'approvals.dual',
      'collaboration',
    ],
  },
  agency: {
    limits: { advertiserAccounts: 50, members: 15, monitors: 200, reports: 100, notificationChannels: 25, apiKeys: 20 },
    capabilities: [
      'google.read',
      'google.mutate.basic',
      'google.mutate.advanced',
      'monitoring',
      'notifications.webhook',
      'reports.white_label',
      'api.read',
      'api.propose',
      'approvals.dual',
      'custom_domain',
      'collaboration',
    ],
  },
  internal: {
    limits: { advertiserAccounts: null, members: null, monitors: null, reports: null, notificationChannels: null, apiKeys: null },
    capabilities: [
      'google.read',
      'google.mutate.basic',
      'google.mutate.advanced',
      'monitoring',
      'notifications.webhook',
      'reports.white_label',
      'api.read',
      'api.propose',
      'approvals.dual',
      'custom_domain',
      'collaboration',
    ],
  },
}

export function isPlan(value: string): value is Plan {
  return value in planDefinitions
}

export function isWorkspaceAccessState(value: string): value is WorkspaceAccessState {
  return ['internal', 'trial', 'active', 'grace', 'suspended', 'deletion_pending', 'deleted'].includes(value)
}

export function entitlementContext(state: WorkspaceAccessState, plan: Plan): EntitlementContext {
  const effectivePlan = state === 'internal' ? 'internal' : plan
  const definition = planDefinitions[effectivePlan]
  const capabilities = state === 'active' || state === 'trial' || state === 'internal'
    ? new Set(definition.capabilities)
    : new Set<Capability>()
  return { state, plan: effectivePlan, limits: { ...definition.limits }, capabilities }
}

export function workspaceHasCapability(state: string, plan: string, capability: Capability) {
  if (!isWorkspaceAccessState(state) || !isPlan(plan)) return false
  return entitlementContext(state, plan).capabilities.has(capability)
}

export function requireCapability(context: EntitlementContext, capability: Capability) {
  if (!context.capabilities.has(capability)) {
    const error = new Error(`Capability required: ${capability}`)
    error.name = 'EntitlementRequiredError'
    throw error
  }
}

export function requireQuota(context: EntitlementContext, resource: QuotaResource, currentUsage: number) {
  const limit = context.limits[resource]
  if (limit !== null && currentUsage >= limit) {
    const error = new Error(`Quota exceeded: ${resource} (${currentUsage}/${limit})`)
    error.name = 'QuotaExceededError'
    throw error
  }
}
