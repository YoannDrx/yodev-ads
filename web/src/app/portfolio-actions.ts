'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { deletePortfolioView, savePortfolioView } from '@/lib/portfolio-views'
import { portfolioCriteriaSchema } from '@/lib/portfolio-query'
import { requireWorkspacePermission } from '@/lib/workspace'

function outcome(error: unknown) {
  return error instanceof Error && error.message === 'Portfolio view conflict' ? 'conflict'
    : error instanceof Error && error.message === 'Portfolio view quota' ? 'quota' : 'unavailable'
}

export async function storePortfolioView(form: FormData) {
  const { workspace, session } = await requireWorkspacePermission('portfolio:save_view')
  let feedback = 'saved'
  const params = new URLSearchParams()
  try {
    const criteria = portfolioCriteriaSchema.parse(JSON.parse(String(form.get('criteria'))))
    for (const [key, value] of Object.entries(criteria)) if (value && value !== 'all') params.set(key, value)
    const name = form.get('name')
    if (typeof name !== 'string') throw new Error('Invalid view name')
    await savePortfolioView({ workspaceId: workspace.id, actorUserId: session.userId, name, criteria,
      id: form.get('id') ? String(form.get('id')) : undefined, version: form.get('version') ? String(form.get('version')) : undefined })
  } catch (error) { feedback = outcome(error) }
  revalidatePath('/portfolio')
  params.set('view_notice', feedback)
  redirect(`/portfolio?${params}`)
}

export async function removePortfolioView(form: FormData) {
  const { workspace, session } = await requireWorkspacePermission('portfolio:save_view')
  let feedback = 'deleted'
  try { await deletePortfolioView({ workspaceId: workspace.id, actorUserId: session.userId, id: String(form.get('id')), version: String(form.get('version')) }) }
  catch (error) { feedback = outcome(error) }
  revalidatePath('/portfolio')
  redirect(`/portfolio?view_notice=${feedback}`)
}
