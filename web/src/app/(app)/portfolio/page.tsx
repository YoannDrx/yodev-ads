import Link from 'next/link'
import { notFound } from 'next/navigation'
import { storePortfolioView, removePortfolioView } from '@/app/portfolio-actions'
import { getPortfolioWorkload } from '@/lib/portfolio-workload'
import { listPortfolioViews, MAX_PORTFOLIO_VIEWS } from '@/lib/portfolio-views'
import { workspaceDecision } from '@/lib/workspace-decision'
import { PageHeading } from '@/components/page-heading'
import { Card, CardContent } from '@/components/ui/card'
import { getPortfolioSnapshot } from '@/lib/portfolio-data'
import { portfolioDecimal, readPortfolioCriteria } from '@/lib/portfolio-query'
import { reportInteger, reportMoney } from '@/lib/report-format'
import { requireWorkspacePermission } from '@/lib/workspace'

export default async function PortfolioPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const raw = await searchParams
  const { workspace, session, role } = await requireWorkspacePermission('portfolio:read')
  const locale = workspace.locale === 'en' ? 'en' : 'fr', english = locale === 'en'
  let invalidFilters = false, criteria
  try { criteria = readPortfolioCriteria(raw) } catch { criteria = readPortfolioCriteria({}); invalidFilters = true }
  const [snapshot, savedViews, workload] = await Promise.all([
    getPortfolioSnapshot(workspace.id, { ...criteria, cursor: invalidFilters ? undefined : raw.cursor }),
    listPortfolioViews(workspace.id, session.userId),
    getPortfolioWorkload(workspace.id),
  ])
  const canSaveView = workspaceDecision({ role, state: workspace.accessState, permission: 'portfolio:save_view' }).allowed
  if (!snapshot) notFound()
  const { page, summary, groups, query } = snapshot
  const queryParams = new URLSearchParams(Object.entries(query).filter(([, value]) => value && value !== 'all'))
  const firstPage = `/portfolio?${queryParams}`
  if (page.nextCursor) queryParams.set('cursor', page.nextCursor)
  const attentionLabels = {
    all: english ? 'All accounts' : 'Tous les comptes', action: english ? 'Needs attention' : 'À traiter', critical: english ? 'Critical alerts' : 'Alertes critiques',
    missing_data: english ? 'Unqualified data' : 'Données non qualifiées', overdue: english ? 'Overdue tasks' : 'Tâches en retard', pending_approval: english ? 'Pending decisions' : 'Décisions en attente',
  }
  const pacingLabels = { missing_goal: english ? 'Set a goal' : 'Objectif à définir', missing_data: english ? 'Incomplete month' : 'Mois incomplet', under: english ? 'Below pace' : 'Sous le rythme', on_track: english ? 'On track' : 'Dans le rythme', over: english ? 'Above pace' : 'Au-dessus du rythme' }
  return <>
    <PageHeading eyebrow={english ? 'Agency overview' : 'Vue agence'} title={english ? 'Client portfolio' : 'Portefeuille clients'} description={english ? 'Find accounts to review, pending decisions and delivery gaps from stored, qualified data.' : 'Repérez les comptes à revoir, les décisions en attente et les lacunes de collecte à partir des données enregistrées et qualifiées.'} actions={<Link href="/accounts" className="text-sm underline">{english ? 'Choose managed accounts' : 'Choisir les comptes gérés'}</Link>} />
    {invalidFilters && <p role="alert" className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm">{english ? 'Unsupported filters were reset. Choose the filters below.' : 'Les filtres non reconnus ont été réinitialisés. Choisissez les filtres ci-dessous.'}</p>}
    {typeof raw.view_notice === 'string' && ['saved','deleted','conflict','quota','unavailable'].includes(raw.view_notice) && <p role={['saved','deleted'].includes(raw.view_notice) ? 'status' : 'alert'} className="mb-4 rounded-lg border bg-white p-3 text-sm">{{
      saved: english ? 'View saved.' : 'Vue enregistrée.', deleted: english ? 'View deleted.' : 'Vue supprimée.',
      conflict: english ? 'This view changed or is no longer available. Review the latest version before saving.' : 'Cette vue a changé ou n’est plus disponible. Vérifiez la dernière version avant d’enregistrer.',
      quota: english ? `You can save up to ${MAX_PORTFOLIO_VIEWS} personal views per workspace.` : `Vous pouvez enregistrer ${MAX_PORTFOLIO_VIEWS} vues personnelles par espace.`,
      unavailable: english ? 'The view could not be saved. Check your access and the form.' : 'La vue n’a pas pu être enregistrée. Vérifiez votre accès et le formulaire.',
    }[raw.view_notice]}</p>}
    <details className="mb-5 rounded-xl border bg-white p-4" data-portfolio-saved-views>
      <summary className="cursor-pointer font-medium">{english ? 'My saved views' : 'Mes vues enregistrées'} · {savedViews.length}/{MAX_PORTFOLIO_VIEWS}</summary>
      <p className="mt-3 text-sm text-muted-foreground">{english ? 'Saved views are personal to this workspace. A link shares filters with authorized teammates; it does not grant access or freeze the data.' : 'Les vues enregistrées sont personnelles à cet espace. Un lien partage les filtres avec les membres autorisés ; il n’accorde aucun droit d’accès et ne fige pas les données.'}</p>
      {canSaveView && <form action={storePortfolioView} className="mt-4 flex flex-wrap items-end gap-3">
        <input type="hidden" name="criteria" value={JSON.stringify(query)} />
        <label className="grid gap-1 text-xs">{english ? 'New view name' : 'Nom de la nouvelle vue'}<input name="name" required maxLength={80} className="h-10 rounded-lg border px-3 text-sm" /></label>
        <button disabled={savedViews.length >= MAX_PORTFOLIO_VIEWS} className="h-10 rounded-lg bg-[#0d1722] px-4 text-sm text-white disabled:opacity-50">{english ? 'Save current filters' : 'Enregistrer ces filtres'}</button>
      </form>}
      <ul className="mt-4 space-y-3">{savedViews.map((view) => <li key={view.id} className="rounded-lg border p-3">
        <Link href={`/portfolio?${new URLSearchParams(Object.entries(view.criteria).filter(([, value]) => value && value !== 'all'))}`} className="break-words text-sm font-semibold underline [overflow-wrap:anywhere]">{view.name}</Link>
        {canSaveView && <details className="mt-2 text-xs"><summary className="cursor-pointer">{english ? 'Edit or delete this view' : 'Modifier ou supprimer cette vue'}</summary>
          <form action={storePortfolioView} className="mt-3 flex flex-wrap items-end gap-3">
            <input type="hidden" name="id" value={view.id} /><input type="hidden" name="version" value={view.version} /><input type="hidden" name="criteria" value={JSON.stringify(query)} />
            <label className="grid gap-1">{english ? 'View name' : 'Nom de la vue'}<input name="name" defaultValue={view.name} required maxLength={80} className="h-10 rounded-lg border px-3 text-sm" /></label>
            <button className="h-10 rounded-lg border px-3 text-sm">{english ? 'Replace with current filters' : 'Remplacer par les filtres affichés'}</button>
          </form>
          <form action={removePortfolioView} className="mt-3"><input type="hidden" name="id" value={view.id} /><input type="hidden" name="version" value={view.version} /><button className="rounded-lg border px-3 py-2 text-sm">{english ? 'Delete saved view' : 'Supprimer la vue enregistrée'}</button></form>
        </details>}
      </li>)}</ul>
    </details>
    <p className="mb-4 text-sm"><Link href={firstPage} className="underline">{english ? 'Shareable view link (sign-in required)' : 'Lien partageable de cette vue (connexion requise)'}</Link></p>
    <form action="/portfolio" className="mb-6 flex flex-wrap items-end gap-3 rounded-xl border bg-white p-4">
      <label className="grid gap-1 text-xs">{english ? 'Account name or ID' : 'Nom ou ID du compte'}<input type="search" name="q" defaultValue={query.q} maxLength={120} className="h-10 rounded-lg border px-3 text-sm" /></label>
      <label className="grid gap-1 text-xs">{english ? 'Priority filter' : 'Filtrer les priorités'}<select name="attention" defaultValue={query.attention} className="h-10 rounded-lg border bg-white px-3 text-sm">{Object.entries(attentionLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label className="grid gap-1 text-xs">{english ? 'Currency (ISO code)' : 'Devise (code ISO)'}<input name="currency" defaultValue={query.currency} maxLength={3} pattern="[A-Z]{3}" placeholder="EUR" className="h-10 w-28 rounded-lg border px-3 text-sm" /></label>
      <label className="grid gap-1 text-xs">{english ? 'Task assignee' : 'Responsable des tâches'}<select name="assignee" defaultValue={query.assignee} className="h-10 max-w-64 rounded-lg border bg-white px-3 text-sm">
        <option value="">{english ? 'All assignees' : 'Tous les responsables'}</option>
        {query.assignee && !workload.some((member) => (member.userId ?? 'unassigned') === query.assignee) && <option value={query.assignee}>{english ? 'Selected member' : 'Membre sélectionné'}</option>}
        {workload.map((member) => <option key={member.userId ?? 'unassigned'} value={member.userId ?? 'unassigned'}>{member.userId === null ? (english ? 'Unassigned tasks' : 'Tâches non attribuées') : member.name ?? `${english ? 'Member' : 'Membre'} ${member.userId.slice(0,8)}`}</option>)}
      </select></label>
      <button className="h-10 rounded-lg bg-[#0d1722] px-4 text-sm text-white">{english ? 'Apply filters' : 'Appliquer les filtres'}</button>
      <Link href="/portfolio" className="py-2 text-sm underline">{english ? 'Reset' : 'Réinitialiser'}</Link>
    </form>
    {snapshot.observedAt && <p className="mb-4 text-xs text-muted-foreground">{english ? 'View calculated' : 'Vue calculée le'} {new Date(snapshot.observedAt).toLocaleString(english ? 'en-GB' : 'fr-FR', { timeZone: workspace.timezone })} · {workspace.timezone}</p>}
    {page.invalidCursor ? <p role="alert" className="mb-5 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm">{english ? 'This page link is invalid or expired.' : 'Ce lien de page est invalide ou expiré.'} <Link href={firstPage} className="underline">{english ? 'Latest results' : 'Résultats récents'}</Link></p> : <>
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-label={english ? 'Filtered portfolio summary' : 'Synthèse du portefeuille filtré'}>
        {[[english ? 'Managed accounts' : 'Comptes gérés', summary.accounts], [english ? 'Needs attention' : 'À traiter', summary.needs_action], [english ? 'Unqualified data' : 'Données non qualifiées', summary.unqualified], [english ? 'Critical alerts' : 'Alertes critiques', summary.critical_alerts], [english ? 'Overdue tasks' : 'Tâches en retard', summary.overdue_tasks], [english ? 'Pending decisions' : 'Décisions en attente', summary.pending_approvals]].map(([label, value]) => <Card key={label} className="shadow-none"><CardContent className="p-4"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-2 text-2xl font-semibold">{reportInteger(value, locale)}</p></CardContent></Card>)}
      </section>
      <section className="mt-6" aria-label={english ? 'Comparable totals' : 'Totaux comparables'}>
        <h2 className="text-lg font-semibold">{english ? 'Totals by currency and time zone' : 'Totaux par devise et fuseau'}</h2>
        <p className="mt-2 text-sm text-muted-foreground">{english ? 'Only complete, recent account histories contribute to each group. Missing data is excluded, never treated as zero. No currency conversion.' : 'Seuls les historiques complets et récents contribuent à chaque groupe. Les données manquantes sont exclues, jamais comptées comme zéro. Aucune conversion monétaire.'}</p>
        <div className="mt-4 grid gap-3 lg:grid-cols-2">{groups.map((group) => <Card key={`${group.currency_code}:${group.timezone}:${group.period_from}`} className="shadow-none" data-portfolio-group><CardContent className="p-4">
          <h3 className="font-semibold">{group.currency_code} · {group.timezone}</h3>
          <p className="mt-1 text-xs text-muted-foreground">{group.period_from} → {group.period_through} · {group.qualified_accounts}/{group.accounts} {english ? 'qualified accounts' : 'comptes qualifiés'}</p>
          <dl className="mt-3 grid grid-cols-2 gap-3 text-sm"><div><dt className="text-muted-foreground">{english ? 'Spend' : 'Investissement'}</dt><dd className="break-words font-semibold [overflow-wrap:anywhere]">{group.cost_micros === null ? '—' : reportMoney(group.cost_micros, group.currency_code, locale)}</dd></div><div><dt className="text-muted-foreground">Conversions</dt><dd className="break-words font-semibold [overflow-wrap:anywhere]">{group.conversions === null ? '—' : portfolioDecimal(group.conversions, locale, 4)}</dd></div></dl>
        </CardContent></Card>)}</div>
      </section>
      <section className="mt-7" aria-label={english ? 'Workspace team workload' : 'Charge de l’équipe de l’espace'}>
        <h2 className="text-lg font-semibold">{english ? 'Team workload' : 'Charge de l’équipe'}</h2>
        <p className="mt-2 text-sm text-muted-foreground">{english ? 'Open task counts across the whole workspace, including tasks without a client. This section is independent of the account filters above. Completed and cancelled tasks are excluded.' : 'Nombre de tâches ouvertes dans tout l’espace, y compris les tâches sans client. Cette section est indépendante des filtres de comptes ci-dessus. Les tâches terminées et annulées sont exclues.'}</p>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">{workload.map((member) => <Card key={member.userId ?? 'unassigned'} className="shadow-none" data-portfolio-workload><CardContent className="p-4">
          <h3 className="break-words font-semibold [overflow-wrap:anywhere]">{member.userId === null ? (english ? 'Unassigned tasks' : 'Tâches non attribuées') : member.name ?? `${english ? 'Member' : 'Membre'} ${member.userId.slice(0,8)}`}</h3>
          <p className="mt-2 text-sm">{member.open} {english ? 'open' : 'ouvertes'} · {member.active} {english ? 'in progress' : 'en cours'}</p>
          <p className="mt-1 text-sm">{member.overdue} {english ? 'overdue' : 'en retard'} · {member.blocked} {english ? 'blocked' : 'bloquées'} · {member.urgent} {english ? 'urgent' : 'urgentes'}</p>
          <div className="mt-3 flex flex-wrap gap-3 text-xs"><Link className="underline" href={`/tasks?status=open&assignee=${encodeURIComponent(member.userId ?? 'unassigned')}`}>{english ? 'Review tasks' : 'Revoir les tâches'}</Link><Link className="underline" href={`/portfolio?assignee=${encodeURIComponent(member.userId ?? 'unassigned')}`}>{english ? 'Related managed accounts' : 'Comptes gérés associés'}</Link></div>
        </CardContent></Card>)}</div>
      </section>
      <section className="mt-7">
        <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold">{english ? 'Account review' : 'Revue des comptes'}</h2><p className="text-sm text-muted-foreground">{page.items.length}/{summary.accounts} {english ? 'shown · newest accounts first' : 'affichés · comptes les plus récents en premier'}</p></div>
        <p className="mt-2 text-xs text-muted-foreground">{english ? 'Scroll the table horizontally to see every metric. Account windows end yesterday in their own time zone.' : 'Faites défiler le tableau horizontalement pour lire toutes les mesures. Les périodes se terminent hier dans le fuseau de chaque compte.'}</p>
        <div className="mt-4 overflow-x-auto rounded-xl border bg-white" tabIndex={0} role="region" aria-label={english ? 'Account metrics table' : 'Tableau des mesures par compte'}>
          <table className="w-full min-w-[1100px] text-left text-sm"><thead className="border-b bg-slate-50 text-xs text-muted-foreground"><tr>{[english ? 'Account and coverage' : 'Compte et couverture', english ? '30-day spend' : 'Investissement 30 j', 'Conversions / CPA', 'ROAS', english ? 'Monthly pacing' : 'Pacing du mois', english ? 'Alerts' : 'Alertes', english ? 'Tasks' : 'Tâches', english ? 'Decisions' : 'Décisions'].map((label) => <th key={label} scope="col" className="px-4 py-3">{label}</th>)}</tr></thead><tbody>
            {page.items.map((account) => <tr key={account.id} className="border-b last:border-b-0" data-portfolio-account>
              <th scope="row" className="max-w-64 px-4 py-4 align-top font-normal"><Link href={`/dashboard?client=${account.id}`} className="break-words font-semibold underline [overflow-wrap:anywhere]">{account.name}</Link><p className="mt-1 text-xs text-muted-foreground">{account.currency_code} · {account.timezone}</p><p className="mt-2 text-xs">{account.data_state === 'complete' ? (english ? 'Complete and recent' : 'Complet et récent') : account.data_state === 'stale' ? (english ? 'Stale data' : 'Données anciennes') : (english ? 'Incomplete data' : 'Données incomplètes')} · {account.observed_days}/30 {english ? 'days' : 'jours'}</p><p className="mt-1 text-xs text-muted-foreground">{account.period_from} → {account.period_through}</p>{account.last_observed_at && <p className="mt-1 text-xs text-muted-foreground">{english ? 'Observed' : 'Observé le'} {new Date(account.last_observed_at).toLocaleString(english ? 'en-GB' : 'fr-FR', { timeZone: account.timezone })}</p>}</th>
              <td className="px-4 py-4 align-top">{account.cost_micros === null ? '—' : reportMoney(account.cost_micros, account.currency_code, locale)}</td>
              <td className="px-4 py-4 align-top">{account.conversions === null ? '—' : portfolioDecimal(account.conversions, locale, 4)}<p className="mt-1 text-xs text-muted-foreground">CPA {account.cpa_micros === null ? '—' : reportMoney(account.cpa_micros, account.currency_code, locale)}</p></td>
              <td className="px-4 py-4 align-top">{account.roas === null ? '—' : `${portfolioDecimal(account.roas, locale, 4)}×`}</td>
              <td className="px-4 py-4 align-top"><Link href={`/dashboard?client=${account.id}`} className="underline">{pacingLabels[account.pacing_state]}</Link>{account.monthly_budget_micros && <p className="mt-1 text-xs text-muted-foreground">{english ? 'Budget' : 'Budget'} {reportMoney(account.monthly_budget_micros, account.currency_code, locale)}</p>}<p className="mt-1 text-xs">MTD {account.mtd_cost_micros === null ? '—' : reportMoney(account.mtd_cost_micros, account.currency_code, locale)} · {account.mtd_observed_days}/{account.mtd_expected_days} {english ? 'days' : 'jours'}</p>{account.pacing_variance_percent !== null && <p className="mt-1 text-xs">{portfolioDecimal(account.pacing_variance_percent, locale)} % · {english ? 'forecast' : 'prévision'} {reportMoney(account.forecast_micros!, account.currency_code, locale)}</p>}</td>
              <td className="px-4 py-4 align-top"><Link href={`/alerts?client=${account.id}`} className="underline">{account.open_alerts} {english ? 'open' : 'ouvertes'}</Link><p className="mt-1 text-xs">{account.critical_alerts} {english ? 'critical' : 'critiques'}</p></td>
              <td className="px-4 py-4 align-top"><Link href={`/tasks?client=${account.id}&status=open`} className="underline">{account.open_tasks} {english ? 'open' : 'ouvertes'}</Link><p className="mt-1 text-xs">{account.blocked_tasks} {english ? 'blocked' : 'bloquées'} · {account.overdue_tasks} {english ? 'overdue' : 'en retard'}</p></td>
              <td className="px-4 py-4 align-top"><Link href={`/approvals?client=${account.id}`} className="underline">{account.pending_approvals} {english ? 'pending' : 'en attente'}</Link></td>
            </tr>)}
          </tbody></table>
          {summary.accounts === 0 && <p className="p-6 text-sm text-muted-foreground">{english ? 'No managed account matches these filters.' : 'Aucun compte géré ne correspond à ces filtres.'}</p>}
        </div>
        <nav aria-label={english ? 'Portfolio pages' : 'Pages du portefeuille'} className="mt-4 flex flex-wrap justify-end gap-4 text-sm">{page.started && <Link href={firstPage} className="underline">{english ? 'Latest results' : 'Résultats récents'}</Link>}{page.nextCursor && <Link href={`/portfolio?${queryParams}`} className="underline">{english ? 'Older results' : 'Résultats plus anciens'}</Link>}</nav>
      </section>
    </>}
  </>
}
