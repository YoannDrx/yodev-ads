import { describe, expect, it } from 'vitest'
import { workspaceAccessAllowsPath, workspaceCanCallGoogle, workspaceLifecycleAllowsPermission } from '@/lib/workspace-access'

describe('workspace lifecycle access boundary', () => {
  it('allows the complete application and Google reads only in operational states', () => {
    for (const state of ['internal', 'trial', 'active'] as const) {
      expect(workspaceAccessAllowsPath(state, '/analysis')).toBe(true)
      expect(workspaceCanCallGoogle(state)).toBe(true)
    }
  })

  it('limits grace to stored views and billing without Google calls', () => {
    for (const path of ['/accounts', '/history', '/alerts/critical', '/tasks', '/approvals', '/reports', '/audit', '/support', '/billing']) {
      expect(workspaceAccessAllowsPath('grace', path)).toBe(true)
    }
    for (const path of ['/dashboard', '/analysis', '/insights', '/settings', '/agents']) {
      expect(workspaceAccessAllowsPath('grace', path)).toBe(false)
    }
    expect(workspaceCanCallGoogle('grace')).toBe(false)
  })

  it('limits suspended and deletion states to billing, export and deletion controls', () => {
    for (const state of ['suspended', 'deletion_pending', 'deleted'] as const) {
      expect(workspaceAccessAllowsPath(state, '/billing')).toBe(true)
      expect(workspaceAccessAllowsPath(state, '/billing/export')).toBe(true)
      expect(workspaceAccessAllowsPath(state, '/history')).toBe(false)
      expect(workspaceCanCallGoogle(state)).toBe(false)
      expect(workspaceLifecycleAllowsPermission(state, 'billing:manage')).toBe(true)
      expect(workspaceLifecycleAllowsPermission(state, 'workspace:export')).toBe(true)
      expect(workspaceLifecycleAllowsPermission(state, 'workspace:delete')).toBe(true)
      expect(workspaceLifecycleAllowsPermission(state, 'workspace:read')).toBe(false)
      expect(workspaceLifecycleAllowsPermission(state, 'google:connect')).toBe(false)
    }
  })
})
