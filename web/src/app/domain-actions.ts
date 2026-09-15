'use server'

import { cookies } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { requireWorkspacePermission } from '@/lib/workspace'
import { requireCapability } from '@/lib/entitlements'
import { requireFeature } from '@/lib/feature-flags'
import { createDomainVerificationToken } from '@/lib/tokens'
import { normalizeCustomHostname } from '@/lib/vercel-domains'
import { createWorkspaceCustomDomain, revokeWorkspaceCustomDomain, verifyWorkspaceCustomDomain } from '@/lib/workspace-domain-management'
import { domainActionError } from '@/lib/domain-action-errors'

function toUrl(path: string, kind: 'notice' | 'error', value: string) { return `${path}?${kind}=${encodeURIComponent(value)}` }

async function requireDomainFormContext(formData: FormData) {
  const context = await requireWorkspacePermission('workspace:admin')
  const displayed = formData.getAll('workspaceId')
  if (displayed.length !== 1 || displayed[0] !== context.workspace.id) throw new Error('L’espace actif a changé. Rechargez la page avant d’enregistrer.')
  requireFeature('customDomains', 'Les domaines personnalisés sont temporairement désactivés.')
  return context
}

export async function createWorkspaceDomain(formData: FormData) {
  let target: string
  try {
    const { workspace, session, entitlements } = await requireDomainFormContext(formData)
    requireCapability(entitlements, 'custom_domain')
    const hostname = normalizeCustomHostname(z.string().trim().min(4).max(253).parse(formData.get('hostname')))
    const token = createDomainVerificationToken()
    const revelation = await createWorkspaceCustomDomain({ workspaceId: workspace.id, actorUserId: session.userId, hostname, token })
    const cookieStore = await cookies()
    cookieStore.set('yodev_secret_revelation', revelation.id, {
      httpOnly: true,
      sameSite: 'strict',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 10 * 60,
      path: '/api/secret-revelation',
    })
    target = `/settings?notice=${encodeURIComponent('Domaine enregistré. Publiez le TXT révélé avant de vérifier.')}&reveal=domain-dns&revealId=${revelation.id}`
  } catch (error) {
    target = toUrl('/settings', 'error', domainActionError(error))
  }
  revalidatePath('/settings')
  redirect(target)
}

export async function verifyWorkspaceDomain(formData: FormData) {
  let target: string
  try {
    const { workspace, session, entitlements } = await requireDomainFormContext(formData)
    requireCapability(entitlements, 'custom_domain')
    const domainId = z.string().uuid().parse(formData.get('domainId'))
    const result = await verifyWorkspaceCustomDomain({ workspaceId: workspace.id, actorUserId: session.userId, domainId })
    target = result.active
      ? toUrl('/settings', 'notice', 'Domaine vérifié, routé et actif pour les nouveaux liens de rapport.')
      : toUrl('/settings', 'notice', 'Propriété confirmée. Configurez les enregistrements indiqués puis relancez la vérification.')
  } catch (error) {
    target = toUrl('/settings', 'error', domainActionError(error))
  }
  revalidatePath('/settings')
  redirect(target)
}

export async function revokeWorkspaceDomain(formData: FormData) {
  let target: string
  try {
    const { workspace, session } = await requireDomainFormContext(formData)
    const domainId = z.string().uuid().parse(formData.get('domainId'))
    await revokeWorkspaceCustomDomain({ workspaceId: workspace.id, actorUserId: session.userId, domainId })
    target = toUrl('/settings', 'notice', 'Domaine retiré de Vercel et révoqué. Le domaine Yodev reste disponible.')
  } catch (error) {
    target = toUrl('/settings', 'error', domainActionError(error))
  }
  revalidatePath('/settings')
  redirect(target)
}

