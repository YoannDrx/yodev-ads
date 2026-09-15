'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { saveManagedAccountSelection } from '@/lib/account-selection'
import { requireWorkspacePermission } from '@/lib/workspace'

export async function updateManagedAccounts(formData: FormData) {
  let outcome = 'saved'
  try {
    const { workspace, session } = await requireWorkspacePermission('google:connect')
    if (formData.get('workspaceId') !== workspace.id) throw new Error('Account selection workspace changed.')
    const input = z.object({ clientIds: z.array(z.string().uuid()), version: z.string().regex(/^[a-f0-9]{64}$/), mode: z.enum(['selection', 'priorities']) }).parse({
      clientIds: JSON.parse(String(formData.get('clientIds'))), version: formData.get('version'), mode: formData.get('mode'),
    })
    await saveManagedAccountSelection({ workspaceId: workspace.id, actorUserId: session.userId, clientIds: input.clientIds, version: input.version, priorityOnly: input.mode === 'priorities' })
  } catch (error) {
    outcome = error instanceof Error && error.message === 'Account selection workspace changed.' ? 'workspace_changed'
      : error instanceof Error && error.message === 'Account selection changed. Reload before saving.' ? 'conflict' : 'unavailable'
  }
  revalidatePath('/accounts')
  revalidatePath('/dashboard', 'layout')
  redirect(`/accounts?selection=${outcome}`)
}
