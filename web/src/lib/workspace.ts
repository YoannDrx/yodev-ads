import 'server-only'

import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { getDb } from '@/db'
import { workspaces } from '@/db/schema'

export async function requireWorkspace() {
  const session = await auth()
  if (!session.userId) return session.redirectToSignIn()
  if (!session.orgId) redirect('/onboarding')

  const db = getDb()
  const defaultName = session.orgSlug ? titleFromSlug(session.orgSlug) : 'Mon agence'
  const [workspace] = await db
    .insert(workspaces)
    .values({
      clerkOrganizationId: session.orgId,
      ownerUserId: session.userId,
      name: defaultName,
      slug: session.orgSlug ?? session.orgId,
    })
    .onConflictDoUpdate({
      target: workspaces.clerkOrganizationId,
      set: { updatedAt: new Date() },
    })
    .returning()

  return {
    session,
    workspace,
    isAdmin: session.orgRole === 'org:admin',
  }
}

export async function requireAdminWorkspace() {
  const context = await requireWorkspace()
  if (!context.isAdmin) throw new Error('Cette action est réservée aux administrateurs de l’organisation.')
  return context
}

function titleFromSlug(slug: string) {
  return slug
    .split('-')
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`)
    .join(' ')
}
