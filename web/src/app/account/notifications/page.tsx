import Link from 'next/link'
import { AccountMenu } from '@/components/account-menu'
import { FlashMessage } from '@/components/flash-message'
import { TaskNotificationPreferencesForm } from '@/components/task-notification-preferences-form'
import { getMyTaskNotificationPreferences } from '@/lib/data'
import { featureEnabled } from '@/lib/feature-flags'
import { requireWorkspacePagePermission } from '@/lib/workspace'
import { workspaceDecision } from '@/lib/workspace-decision'

export default async function PersonalNotificationsPage({ searchParams }: { searchParams: Promise<{ notice?: string; error?: string }> }) {
  const { workspace, session, role, entitlements } = await requireWorkspacePagePermission('workspace:read', '/account/notifications')
  const [query, preferences] = await Promise.all([searchParams, getMyTaskNotificationPreferences(workspace.id, session.userId)])
  const english = workspace.locale === 'en', locale = english ? 'en' : 'fr'
  const enabled = featureEnabled('notifications') && entitlements.capabilities.has('monitoring')
  const canReadTasks = workspaceDecision({ role, state: workspace.accessState, permission: 'portfolio:read' }).allowed
  return <main className="min-h-screen bg-[#f3f6f8] px-4 py-8 text-[#0d1722]">
    <div className="mx-auto max-w-3xl space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3"><Link href="/account" className="text-sm font-medium text-[#168977] underline">{english ? 'Back to my account' : 'Retour à mon compte'}</Link><AccountMenu locale={locale} /></header>
      <section className="rounded-3xl border bg-white p-6 shadow-sm sm:p-8">
        <h1 className="text-2xl font-semibold">{english ? 'My task notifications' : 'Mes notifications de tâches'}</h1>
        <p className="mt-2 break-words text-sm font-medium">{workspace.name}</p>
        <p className="mb-6 mt-3 text-sm leading-6 text-slate-600">{english ? 'These preferences apply only to this workspace. Emails use your current verified account address. Digests contain your assigned tasks.' : 'Ces préférences concernent uniquement cet espace. Les emails utilisent l’adresse vérifiée actuelle de votre compte. Les récapitulatifs contiennent les tâches qui vous sont assignées.'}</p>
        <FlashMessage notice={query.notice} error={query.error} locale={locale} />
        {!canReadTasks && <p role="status" className="mb-5 rounded-xl bg-amber-50 p-4 text-sm text-amber-900">{english ? 'Your current role does not allow access to tasks, so no task emails will be sent to you. You can still manage your preferences for a future role change.' : 'Votre rôle actuel ne permet pas d’accéder aux tâches : aucun email de tâche ne vous sera envoyé. Vous pouvez gérer vos préférences en prévision d’un changement de rôle.'}</p>}
        {enabled ? <TaskNotificationPreferencesForm taskPreferences={preferences} timezone={workspace.timezone} workspaceId={workspace.id} locale={locale} returnTo="/account/notifications" />
          : <p role="status" className="rounded-xl bg-slate-50 p-4 text-sm text-slate-600">{english ? 'Task notifications are currently unavailable for this workspace.' : 'Les notifications de tâches sont actuellement indisponibles pour cet espace.'}</p>}
      </section>
    </div>
  </main>
}
