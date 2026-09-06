import { afterEach, describe, expect, it, vi } from 'vitest'
import { entitlementContext, type Plan, type WorkspaceAccessState } from './entitlements'
import { workspaceDecision, workspacePermissions } from './workspace-decision'
import { permissionsForRole, type WorkspaceRole } from './permissions'

const roles: WorkspaceRole[] = ['owner', 'admin', 'strategist', 'analyst', 'client']
const plans: Plan[] = ['trial', 'solo', 'studio', 'agency', 'internal']
const states: WorkspaceAccessState[] = ['trial', 'active', 'internal', 'grace', 'suspended', 'deletion_pending', 'deleted']
afterEach(() => vi.unstubAllEnvs())

describe('workspace access decisions', () => {
  it('keeps Google proposals closed outside operational lifecycle for every role and plan', () => {
    vi.stubEnv('GOOGLE_READS_ENABLED', '1')
    for (const role of roles) for (const plan of plans) for (const state of states) {
      const entitlements = entitlementContext(state, plan)
      const decision = workspaceDecision({ role, state, entitlements, permission: 'google:propose', capability: 'google.mutate.advanced', features: ['googleReads'] })
      expect(decision.allowed).toBe(permissionsForRole(role).has('google:propose') && ['trial', 'active', 'internal'].includes(state) && entitlements.capabilities.has('google.mutate.advanced'))
    }
  })
  it('allows stored portfolio and audit access in grace without management rights', () => {
    expect(workspacePermissions('analyst', 'grace').has('portfolio:read')).toBe(true)
    expect(workspacePermissions('client', 'grace').has('portfolio:read')).toBe(false)
    expect(workspacePermissions('admin', 'grace').has('audit:read')).toBe(true)
    for (const role of roles) {
      expect(workspacePermissions(role, 'grace').has('workspace:admin')).toBe(false)
      expect(workspacePermissions(role, 'grace').has('reports:manage')).toBe(false)
      expect(workspacePermissions(role, 'suspended').has('support:read')).toBe(true)
    }
  })
  it('returns the precise failed gate', () => {
    const input = { role: 'owner' as const, state: 'active', permission: 'google:propose' as const }
    expect(workspaceDecision({ ...input, role: 'analyst' })).toEqual({ allowed: false, reason: 'role' })
    expect(workspaceDecision({ ...input, state: 'grace' })).toEqual({ allowed: false, reason: 'lifecycle' })
    expect(workspaceDecision({ ...input, capability: 'google.mutate.basic' })).toEqual({ allowed: false, reason: 'plan' })
    vi.stubEnv('GOOGLE_READS_ENABLED', '0')
    expect(workspaceDecision({ ...input, features: ['googleReads'] })).toEqual({ allowed: false, reason: 'disabled' })
  })
})
