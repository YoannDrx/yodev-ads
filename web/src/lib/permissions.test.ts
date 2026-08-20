import { describe, expect, it } from 'vitest'
import { authRoleToWorkspaceRole, permissionsForRole, requirePermission, type WorkspaceRole } from '@/lib/permissions'

describe('workspace permissions', () => {
  it.each([
    ['owner', true, true, true],
    ['admin', false, true, true],
    ['strategist', false, false, false],
    ['analyst', false, false, false],
    ['client', false, false, false],
  ] as const)('enforces sensitive boundaries for %s', (role, billing, approve, memberAdmin) => {
    const permissions = permissionsForRole(role)
    expect(permissions.has('billing:manage')).toBe(billing)
    expect(permissions.has('google:approve')).toBe(approve)
    expect(permissions.has('members:manage')).toBe(memberAdmin)
  })

  it('maps legacy roles, fails unknown roles closed to client and resolves ownership independently', () => {
    expect(authRoleToWorkspaceRole('operator', false)).toBe('strategist')
    expect(authRoleToWorkspaceRole('viewer', false)).toBe('client')
    expect(authRoleToWorkspaceRole('member', false)).toBe('client')
    expect(authRoleToWorkspaceRole(null, true)).toBe('owner')
  })

  it('allows analysts to discuss tasks without operating them', () => {
    expect(permissionsForRole('analyst').has('tasks:comment')).toBe(true)
    expect(permissionsForRole('analyst').has('tasks:manage')).toBe(false)
    expect(permissionsForRole('strategist').has('tasks:manage')).toBe(true)
    expect(permissionsForRole('client').has('tasks:comment')).toBe(false)
  })

  it('allows every workspace role to contact support within its visibility scope', () => {
    expect(permissionsForRole('client').has('support:read')).toBe(true)
    expect(permissionsForRole('client').has('support:contact')).toBe(true)
    expect(permissionsForRole('analyst').has('support:contact')).toBe(true)
    expect(permissionsForRole('strategist').has('support:contact')).toBe(true)
  })

  it.each(['admin', 'strategist', 'analyst', 'client'] as WorkspaceRole[])('reserves workspace deletion for owner, not %s', (role) => {
    expect(() => requirePermission(role, 'workspace:delete')).toThrowError(/Permission required/)
  })
})
