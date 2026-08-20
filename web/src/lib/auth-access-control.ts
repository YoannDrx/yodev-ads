import { createAccessControl } from 'better-auth/plugins/access'
import { defaultStatements } from 'better-auth/plugins/organization/access'

// Better Auth is the membership/session authority. Product authorization remains
// in permissions.ts and every mutation goes through an audited application
// service, so the generic organization API deliberately receives no mutation
// permissions for any role.
export const authOrganizationAccess = createAccessControl(defaultStatements)

const readOnlyOrganizationRole = {
  organization: [],
  member: [],
  invitation: [],
  team: [],
  ac: [],
} as const

export const authOrganizationRoles = {
  owner: authOrganizationAccess.newRole(readOnlyOrganizationRole),
  admin: authOrganizationAccess.newRole(readOnlyOrganizationRole),
  strategist: authOrganizationAccess.newRole(readOnlyOrganizationRole),
  analyst: authOrganizationAccess.newRole(readOnlyOrganizationRole),
  client: authOrganizationAccess.newRole(readOnlyOrganizationRole),
}
