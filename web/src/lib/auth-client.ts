'use client'

import { passkeyClient } from '@better-auth/passkey/client'
import { createAuthClient } from 'better-auth/react'
import { magicLinkClient, organizationClient } from 'better-auth/client/plugins'
import { authOrganizationAccess, authOrganizationRoles } from '@/lib/auth-access-control'

export const authClient = createAuthClient({
  plugins: [
    organizationClient({ ac: authOrganizationAccess, roles: authOrganizationRoles }),
    magicLinkClient(),
    passkeyClient(),
  ],
})
