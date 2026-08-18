import 'server-only'

export type Permission =
  | 'workspace:read'
  | 'portfolio:read'
  | 'workspace:admin'
  | 'billing:manage'
  | 'members:manage'
  | 'google:connect'
  | 'google:propose'
  | 'google:approve'
  | 'monitoring:run'
  | 'alerts:manage'
  | 'tasks:manage'
  | 'tasks:comment'
  | 'support:read'
  | 'support:contact'
  | 'reports:manage'
  | 'api_keys:manage'
  | 'workspace:export'
  | 'workspace:delete'

export type WorkspaceRole = 'owner' | 'admin' | 'strategist' | 'analyst' | 'client'

const allPermissions: readonly Permission[] = [
  'workspace:read',
  'portfolio:read',
  'workspace:admin',
  'billing:manage',
  'members:manage',
  'google:connect',
  'google:propose',
  'google:approve',
  'monitoring:run',
  'alerts:manage',
  'tasks:manage',
  'tasks:comment',
  'support:read',
  'support:contact',
  'reports:manage',
  'api_keys:manage',
  'workspace:export',
  'workspace:delete',
]

const rolePermissions: Record<WorkspaceRole, ReadonlySet<Permission>> = {
  owner: new Set(allPermissions),
  admin: new Set([
    'workspace:read',
    'portfolio:read',
    'workspace:admin',
    'members:manage',
    'google:connect',
    'google:propose',
    'google:approve',
    'monitoring:run',
    'alerts:manage',
    'tasks:manage',
    'tasks:comment',
    'support:read',
    'support:contact',
    'reports:manage',
  ]),
  strategist: new Set(['workspace:read', 'portfolio:read', 'google:propose', 'monitoring:run', 'alerts:manage', 'tasks:manage', 'tasks:comment', 'support:read', 'support:contact']),
  analyst: new Set(['workspace:read', 'portfolio:read', 'reports:manage', 'tasks:comment', 'support:read', 'support:contact']),
  client: new Set(['workspace:read', 'support:read', 'support:contact']),
}

export function permissionsForRole(role: WorkspaceRole) {
  return rolePermissions[role]
}

export function requirePermission(role: WorkspaceRole, permission: Permission) {
  if (!rolePermissions[role].has(permission)) {
    const error = new Error(`Permission required: ${permission}`)
    error.name = 'PermissionDeniedError'
    throw error
  }
}

export function authRoleToWorkspaceRole(authRole: string | null | undefined, isOwner: boolean): WorkspaceRole {
  if (isOwner) return 'owner'
  const role = authRole?.replace(/^org:/, '')
  if (role === 'operator') return 'strategist'
  if (role === 'viewer') return 'client'
  if (role === 'admin' || role === 'strategist' || role === 'analyst' || role === 'client') return role
  return 'client'
}
