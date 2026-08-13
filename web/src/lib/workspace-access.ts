const graceReadPaths = ['/accounts', '/history', '/alerts', '/tasks', '/approvals', '/reports', '/audit', '/support', '/billing'] as const

function pathMatches(pathname: string, allowed: string) {
  return pathname === allowed || pathname.startsWith(`${allowed}/`)
}

export function workspaceAccessAllowsPath(state: string, pathname: string) {
  if (state === 'internal' || state === 'trial' || state === 'active') return true
  if (state === 'grace') return graceReadPaths.some((path) => pathMatches(pathname, path))
  return pathMatches(pathname, '/billing')
}

export function workspaceCanCallGoogle(state: string) {
  return state === 'internal' || state === 'trial' || state === 'active'
}

export function workspaceLifecycleAllowsPermission(state: string, permission: string) {
  if (state === 'internal' || state === 'trial' || state === 'active') return true
  return permission === 'billing:manage' || permission === 'workspace:export' || permission === 'workspace:delete'
}
