import Link from 'next/link'
import { AccountSelectionEditor } from '@/components/account-selection-editor'
import { FlashMessage } from '@/components/flash-message'
import { PageHeading } from '@/components/page-heading'
import { Button } from '@/components/ui/button'
import { getWorkspaceAccountSelection } from '@/lib/account-selection'
import { workspaceDecision } from '@/lib/workspace-decision'
import { requireWorkspacePermission } from '@/lib/workspace'

export default async function AccountsPage({ searchParams }: { searchParams: Promise<{ notice?: string; error?: string; selection?: string }> }) {
  const query = await searchParams
  const { workspace, role } = await requireWorkspacePermission('portfolio:read')
  const english = workspace.locale === 'en'
  const selection = await getWorkspaceAccountSelection(workspace.id)
  const canManage = workspaceDecision({ role, state: workspace.accessState, permission: 'google:connect' }).allowed
  const feedback = query.selection === 'saved' ? (english ? 'Selection saved.' : 'Sélection enregistrée.') : undefined
  const error = query.selection === 'conflict' ? (english ? 'Another change was saved meanwhile. Your selection was not saved. Review the refreshed inventory before trying again.' : 'Une autre modification a été enregistrée entre-temps. Votre sélection n’a pas été enregistrée. Vérifiez l’inventaire actualisé avant de recommencer.') : query.selection === 'unavailable' ? (english ? 'Selection could not be saved. Check the quota and available accounts.' : 'La sélection n’a pas pu être enregistrée. Vérifiez le quota et les comptes disponibles.') : query.error
  return <>
    <PageHeading eyebrow={english ? 'Portfolio' : 'Portefeuille'} title={english ? 'Client accounts' : 'Comptes clients'} description={english ? 'Choose which MCC accounts to manage and their priority when the plan changes.' : 'Choisissez les comptes du MCC à gérer et leur priorité lors d’un changement de forfait.'} actions={canManage ? <Button asChild variant="outline"><Link href="/settings">{english ? 'Manage connection' : 'Gérer la connexion'}</Link></Button> : undefined} />
    <FlashMessage notice={feedback ?? query.notice} error={error} locale={english ? 'en' : 'fr'} />
    <AccountSelectionEditor key={selection.version} {...selection} canManage={canManage} locale={english ? 'en' : 'fr'} />
  </>
}
