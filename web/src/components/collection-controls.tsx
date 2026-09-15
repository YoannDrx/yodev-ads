import Link from 'next/link'
import type { CollectionPage, CollectionQuery } from '@/lib/collection-pagination'

const labels: Record<string, [string, string]> = {
  open: ['Ouvertes', 'Open'], reopened: ['Rouvertes', 'Reopened'], acknowledged: ['Acquittées', 'Acknowledged'], snoozed: ['Masquées', 'Snoozed'], resolved: ['Résolues', 'Resolved'],
  pending: ['En attente', 'Pending'], approved: ['Approuvées', 'Approved'], executed: ['Exécutées', 'Executed'], rejected: ['Rejetées', 'Rejected'], failed: ['Échouées', 'Failed'], expired: ['Expirées', 'Expired'],
  todo: ['À faire', 'To do'], in_progress: ['En cours', 'In progress'], blocked: ['Bloquées', 'Blocked'], done: ['Terminées', 'Done'], cancelled: ['Annulées', 'Cancelled'],
  awaiting_support: ['En attente du support', 'Awaiting support'], awaiting_customer: ['En attente de votre retour', 'Awaiting customer'], closed: ['Fermées', 'Closed'],
}
function values(query: CollectionQuery) {
  return Object.fromEntries(Object.entries(query).filter(([key, value]) => ['id', 'q', 'status', 'client', 'assignee', 'severity', 'workspace'].includes(key) && typeof value === 'string' && value.length > 0)) as Record<string, string>
}
export function CollectionControls({ path, query, page, locale, statuses }: { path: string; query: CollectionQuery; page: Pick<CollectionPage<unknown>, 'total' | 'nextCursor' | 'started' | 'invalidCursor'> & { items: unknown[] }; locale: 'fr' | 'en'; statuses?: readonly string[] }) {
  const english = locale === 'en', criteria = values(query)
  const first = `${path}?${new URLSearchParams(criteria)}`, next = page.nextCursor ? `${path}?${new URLSearchParams({ ...criteria, cursor: page.nextCursor })}` : null
  return <div className="my-5 space-y-3" data-collection-controls>
    <form action={path} className="flex flex-wrap items-end gap-3">
      <label className="grid gap-1 text-xs"><span>{english ? 'Search all results' : 'Rechercher dans tous les résultats'}</span><input type="search" name="q" defaultValue={criteria.q} maxLength={120} className="h-10 rounded-lg border bg-card px-3 text-sm" /></label>
      {statuses && <label className="grid gap-1 text-xs"><span>{english ? 'Status filter' : 'Filtrer par statut'}</span><select name="status" defaultValue={criteria.status ?? ''} className="h-10 rounded-lg border bg-card px-3 text-sm"><option value="">{english ? 'All statuses' : 'Tous les statuts'}</option>{statuses.map((status) => <option key={status} value={status}>{labels[status]?.[english ? 1 : 0] ?? status}</option>)}</select></label>}
      {Object.entries(criteria).filter(([key]) => !['q', 'status'].includes(key)).map(([key, value]) => <input key={key} type="hidden" name={key} value={value} />)}
      <button type="submit" className="h-10 rounded-lg bg-card px-4 text-sm text-foreground">{english ? 'Apply filters' : 'Appliquer les filtres'}</button>
      <Link href={path} className="py-2 text-sm underline">{english ? 'Reset' : 'Réinitialiser'}</Link>
    </form>
    {page.invalidCursor ? <p role="alert" className="rounded-lg border border-amber-300 y-status-warning p-3 text-sm">{english ? 'This page link is invalid or expired. Return to the latest results.' : 'Ce lien de page est invalide ou expiré. Revenez aux résultats les plus récents.'} <Link href={first} className="underline">{english ? 'Latest results' : 'Résultats récents'}</Link></p> : <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
      <p className="text-muted-foreground">{page.items.length.toLocaleString(locale)} {english ? 'shown' : 'affichés'} · {page.total.toLocaleString(locale)} {english ? 'matching results · newest first' : 'résultats correspondants · plus récents en premier'}</p>
      <nav aria-label={english ? 'Results pages' : 'Pages de résultats'} className="flex gap-4">{page.started && <Link href={first} className="underline">{english ? 'Back to latest' : 'Revenir aux plus récents'}</Link>}{next && <Link href={next} className="underline">{english ? 'Older results' : 'Résultats plus anciens'}</Link>}</nav>
    </div>}
  </div>
}

export function DiscussionLink({ kind, id, more, locale }: { kind: 'tasks' | 'support' | 'approvals' | 'alerts'; id: string; more?: boolean; locale: 'fr' | 'en' }) {
  return <Link href={`/discussions/${kind}/${id}`} className="my-3 inline-block text-xs underline">{locale === 'en' ? more ? 'Latest 5 messages · read full discussion' : 'Read discussion history' : more ? '5 derniers messages · lire toute la discussion' : 'Lire l’historique de discussion'}</Link>
}
