import Link from 'next/link'
import { notFound } from 'next/navigation'
import { z } from 'zod'
import { PageHeading } from '@/components/page-heading'
import { AnalyticalRecord } from '@/components/analytical-record'
import { requireWorkspacePagePermission } from '@/lib/workspace'
import { getWorkspaceClient } from '@/lib/data'
import { getAnalyticalPage } from '@/lib/analytical-pages'
import { ANALYTICAL_FAMILIES, analyticalFamilies, analyticalSnapshotState, type AnalyticalFamily } from '@/lib/analytical-model'
import { googleCoverageLabel } from '@/lib/google-collection-coverage'

export default async function AnalyticalCollectionPage({ params, searchParams }: { params: Promise<{ family: string }>; searchParams: Promise<{ client?: string; q?: string; cursor?: string }> }) {
  const { family } = await params
  if (!analyticalFamilies.includes(family as AnalyticalFamily)) notFound()
  const { workspace } = await requireWorkspacePagePermission('portfolio:read', '/insights/[family]')
  const query = await searchParams
  if (query.client !== undefined && !z.string().uuid().safeParse(query.client).success) notFound()
  const client = await getWorkspaceClient(workspace.id, query.client)
  if (!client) notFound()
  const page = await getAnalyticalPage(workspace.id, client.id, family as AnalyticalFamily, query)
  if (!page) notFound()
  const locale = workspace.locale === 'en' ? 'en' : 'fr', english = locale === 'en'
  const path = `/insights/${family}`, criteria = { client: client.id, ...(page.query ? { q: page.query } : {}) }
  const first = `${path}?${new URLSearchParams(criteria)}`
  const next = page.nextCursor ? `${path}?${new URLSearchParams({ ...criteria, cursor: page.nextCursor })}` : null
  const snapshot = page.snapshot
  const state = snapshot ? analyticalSnapshotState({ ...snapshot, payload: null }, client) : 'unavailable'
  return <>
    <PageHeading eyebrow={client.name} title={ANALYTICAL_FAMILIES[family as AnalyticalFamily][locale]} description={english ? 'Browse and search every row in this stored collection. Its source limits and date remain visible.' : 'Parcourez et recherchez toutes les lignes de cette collecte enregistrée. Ses limites de source et sa date restent visibles.'} />
    <Link prefetch={false} href={`/insights?client=${client.id}`} className="text-sm underline">{english ? 'Back to insights' : 'Revenir aux insights'}</Link>
    <details className="my-4"><summary className="cursor-pointer text-sm">{english ? 'Other collections' : 'Autres collectes'}</summary><nav aria-label={english ? 'Analytical collections' : 'Collectes analytiques'} className="mt-3 flex flex-wrap gap-3">{analyticalFamilies.map((key) => <Link prefetch={false} key={key} aria-current={key === family ? 'page' : undefined} className="rounded-lg border bg-card px-3 py-2 text-sm underline" href={`/insights/${key}?client=${client.id}`}>{ANALYTICAL_FAMILIES[key][locale]}</Link>)}</nav></details>
    {snapshot && <section className="my-5 space-y-2 rounded-md border bg-card p-4" aria-label={english ? 'Collection coverage' : 'Couverture de la collecte'}>
      <p className="text-sm font-medium">{googleCoverageLabel(snapshot.coverage, locale)}</p>
      <p className="text-sm">{snapshot.periodFrom} → {snapshot.periodThrough} · {client.timezone} · {snapshot.collectedAt.toLocaleString(locale === 'en' ? 'en-GB' : 'fr-FR', { timeZone: client.timezone })}{state === 'stale' ? ` · ${english ? 'Older data' : 'Données anciennes'}` : ''}</p>
      <p className="text-xs text-muted-foreground">{english ? 'Google reporting thresholds and resource filters can exclude activity. Export covers this stored collection, including rows outside your current search.' : 'Les seuils des rapports Google et les filtres de ressource peuvent exclure de l’activité. L’export couvre cette collecte enregistrée, y compris les lignes hors de votre recherche.'}</p>
      <a href={`${path}/export?${new URLSearchParams({ client: client.id, version: snapshot.sourceVersion })}`} className="inline-block text-sm underline">{english ? 'Export complete collection (JSON)' : 'Exporter toute la collecte (JSON)'}</a>
    </section>}
    <form action={path} className="my-5 flex flex-wrap items-end gap-3">
      <input type="hidden" name="client" value={client.id} />
      <label className="grid min-w-0 gap-1 text-xs"><span>{english ? 'Search all stored results' : 'Rechercher dans tous les résultats enregistrés'}</span><input type="search" name="q" maxLength={120} defaultValue={page.query} className="h-10 min-w-0 rounded-lg border bg-card px-3 text-sm" /></label>
      <button type="submit" className="h-10 rounded-lg bg-card px-4 text-sm text-foreground">{english ? 'Search' : 'Rechercher'}</button>
      <Link prefetch={false} href={`${path}?client=${client.id}`} className="py-2 text-sm underline">{english ? 'Reset' : 'Réinitialiser'}</Link>
    </form>
    {page.invalidCursor || page.changed ? <p role="alert" className="my-4 rounded-lg border border-amber-300 y-status-warning p-4 text-sm">{page.changed ? (english ? 'The collection changed during browsing. Restart with the latest collection.' : 'La collecte a changé pendant votre consultation. Reprenez avec la dernière collecte.') : (english ? 'This page link is invalid or expired.' : 'Ce lien de page est invalide ou expiré.')} <Link prefetch={false} href={first} className="underline">{english ? 'First page' : 'Première page'}</Link></p>
      : !snapshot ? <p className="my-5 rounded-md border border-dashed p-6 text-sm">{english ? 'No usable collection is available for this section. This does not mean there is no activity.' : 'Aucune collecte exploitable n’est disponible pour cette section. Cela ne signifie pas une absence d’activité.'}</p>
        : <p className="my-4 text-sm text-muted-foreground">{page.items.length} {english ? 'shown' : 'affichés'} · {page.total.toLocaleString(locale)} {english ? 'matching' : 'correspondants'} · {page.storedCount.toLocaleString(locale)} {english ? 'stored · collection order' : 'enregistrés · ordre de la collecte'}</p>}
    <div className="space-y-4">{page.items.map((item) => <AnalyticalRecord key={item.position} item={item} currency={client.currencyCode} locale={locale} />)}</div>
    <nav aria-label={english ? 'Results pages' : 'Pages de résultats'} className="my-6 flex flex-wrap gap-4 text-sm">{page.started && <Link prefetch={false} href={first} className="underline">{english ? 'First page' : 'Première page'}</Link>}{next && <Link prefetch={false} href={next} className="underline">{english ? 'Next page' : 'Page suivante'}</Link>}</nav>
  </>
}
