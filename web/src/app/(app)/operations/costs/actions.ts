'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { requireWorkspacePermission } from '@/lib/workspace'
import { OperatingCostConflict, saveOperatingCost } from '@/lib/operating-costs'
import { costMonthSchema } from '@/lib/operating-cost-model'

export async function recordOperatingCost(formData: FormData) {
  const month = costMonthSchema.safeParse(formData.get('month'))
  const query = new URLSearchParams({ month: month.success ? month.data : new Date().toISOString().slice(0, 7) })
  try {
    const { workspace, session } = await requireWorkspacePermission('workspace:admin')
    if (workspace.accessState !== 'internal') throw new Error('Operator required')
    await saveOperatingCost({ operatorWorkspaceId: workspace.id, actorUserId: session.userId, entry: Object.fromEntries(formData) })
    query.set('notice', 'Observation enregistrée avec sa version et son audit.')
  } catch (error) {
    query.set('error', error instanceof OperatingCostConflict ? error.message : 'Enregistrement refusé. Vérifiez les champs, la répartition à 100 %, la période et vos droits.')
  }
  revalidatePath('/operations/costs')
  redirect(`/operations/costs?${query}`)
}
