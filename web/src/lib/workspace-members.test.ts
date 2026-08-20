import { describe, expect, it } from 'vitest'
import { workspaceRoleFromAuth } from '@/lib/workspace-members'

describe('workspace member roles', () => {
  it('maps every manageable Better Auth organization role', () => {
    for (const role of ['admin', 'strategist', 'analyst', 'client'] as const) {
      expect(workspaceRoleFromAuth(role)).toBe(role)
    }
  })

  it('maps legacy roles and fails unknown Better Auth roles closed to client', () => {
    expect(workspaceRoleFromAuth('operator')).toBe('strategist')
    expect(workspaceRoleFromAuth('viewer')).toBe('client')
    expect(workspaceRoleFromAuth('unknown')).toBe('client')
    expect(workspaceRoleFromAuth('')).toBe('client')
  })
})
