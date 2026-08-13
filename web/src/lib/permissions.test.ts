import { describe, expect, it } from 'vitest'
import { authRoleToWorkspaceRole, permissionsForRole, requirePermission, type WorkspaceRole } from '@/lib/permissions'

describe('workspace permissions', () => {
  it.each([
    ['owner', true, true, true],
    ['admin', false, true, true],
    ['operator', false, false, false],
    ['analyst', false, false, false],
    ['viewer', false, false, false],
  ] as const)('enforces sensitive boundaries for %s', (role, billing, approve, memberAdmin) => {
    const permissions = permissionsForRole(role)
    expect(permissions.has('billing:manage')).toBe(billing)
    expect(permissions.has('google:approve')).toBe(approve)
    expect(permissions.has('members:manage')).toBe(memberAdmin)
  })

  it('maps unknown Better Auth roles to viewer and ownership independently', () => {
    expect(authRoleToWorkspaceRole('operator', false)).toBe('operator')
    expect(authRoleToWorkspaceRole('member', false)).toBe('viewer')
    expect(authRoleToWorkspaceRole(null, true)).toBe('owner')
  })

  it('allows analysts to discuss tasks without operating them', () => {
    expect(permissionsForRole('analyst').has('tasks:comment')).toBe(true)
    expect(permissionsForRole('analyst').has('tasks:manage')).toBe(false)
    expect(permissionsForRole('operator').has('tasks:manage')).toBe(true)
    expect(permissionsForRole('viewer').has('tasks:comment')).toBe(false)
  })

  it('allows members to read support while preserving viewer read-only access', () => {
    expect(permissionsForRole('viewer').has('support:read')).toBe(true)
    expect(permissionsForRole('viewer').has('support:contact')).toBe(false)
    expect(permissionsForRole('analyst').has('support:contact')).toBe(true)
    expect(permissionsForRole('operator').has('support:contact')).toBe(true)
  })

  it.each(['admin', 'operator', 'analyst', 'viewer'] as WorkspaceRole[])('reserves workspace deletion for owner, not %s', (role) => {
    expect(() => requirePermission(role, 'workspace:delete')).toThrowError(/Permission required/)
  })
})
