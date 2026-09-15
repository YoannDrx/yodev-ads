'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { requestAnalyticalRefresh } from '@/lib/analytical-collections'
import { requireWorkspacePermission } from '@/lib/workspace'

export async function refreshAnalyticalData(formData: FormData) {
  const { workspace, session } = await requireWorkspacePermission('monitoring:run')
  const input = z.object({ clientId: z.string().uuid(), destination: z.enum(['/dashboard', '/analysis', '/insights']) }).parse(Object.fromEntries(formData))
  let outcome: string
  try {
    const result = await requestAnalyticalRefresh({ workspaceId: workspace.id, clientId: input.clientId, actorUserId: session.userId })
    outcome = result.created ? 'queued' : result.reason
  } catch {
    // Provider details, credentials and account existence are not reflected in the URL.
    outcome = 'unavailable'
  }
  revalidatePath(input.destination)
  redirect(`${input.destination}?${new URLSearchParams({ client: input.clientId, sync: outcome })}`)
}
