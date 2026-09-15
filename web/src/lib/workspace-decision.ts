import 'server-only'

import type { Capability, EntitlementContext } from '@/lib/entitlements'
import { featureEnabled, type FeatureFlag } from '@/lib/feature-flags'
import { permissionsForRole, type Permission, type WorkspaceRole } from '@/lib/permissions'
import { workspaceLifecycleAllowsPermission } from '@/lib/workspace-access'

export type AccessDecision = { allowed: true } | { allowed: false; reason: 'role' | 'lifecycle' | 'plan' | 'disabled' }

export function workspaceDecision(input: {
  role: WorkspaceRole
  state: string
  permission: Permission
  entitlements?: EntitlementContext
  capability?: Capability
  features?: FeatureFlag[]
}): AccessDecision {
  if (!permissionsForRole(input.role).has(input.permission)) return { allowed: false, reason: 'role' }
  if (!workspaceLifecycleAllowsPermission(input.state, input.permission)) return { allowed: false, reason: 'lifecycle' }
  if (input.capability && !input.entitlements?.capabilities.has(input.capability)) return { allowed: false, reason: 'plan' }
  if (input.features?.some((flag) => !featureEnabled(flag))) return { allowed: false, reason: 'disabled' }
  return { allowed: true }
}

export function workspacePermissions(role: WorkspaceRole, state: string) {
  return new Set([...permissionsForRole(role)].filter((permission) => workspaceDecision({ role, state, permission }).allowed))
}
