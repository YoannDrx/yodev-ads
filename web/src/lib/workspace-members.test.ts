import { describe, expect, it } from 'vitest'
import { workspaceRoleFromAuth } from '@/lib/workspace-members'

describe('workspace member roles', () => {
  it('maps every manageable Better Auth organization role', () => {
    for (const role of ['admin', 'operator', 'analyst', 'viewer'] as const) {
      expect(workspaceRoleFromAuth(role)).toBe(role)
    }
  })

  it('fails unknown Better Auth roles closed to viewer', () => {
    expect(workspaceRoleFromAuth('unknown')).toBe('viewer')
    expect(workspaceRoleFromAuth('')).toBe('viewer')
  })
})
