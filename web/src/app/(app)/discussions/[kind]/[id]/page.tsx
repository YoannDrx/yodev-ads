import Link from 'next/link'
import { notFound } from 'next/navigation'
import { CollectionControls } from '@/components/collection-controls'
import { PageHeading } from '@/components/page-heading'
import { requireWorkspacePagePermission } from '@/lib/workspace'
import { listDiscussionPage, type DiscussionKind } from '@/lib/workspace-collections'
import type { CollectionQuery } from '@/lib/collection-pagination'

export default async function DiscussionPage({ params, searchParams }: { params: Promise<{ kind: string; id: string }>; searchParams: Promise<CollectionQuery> }) {
  const { kind, id } = await params
  if (!['tasks', 'approvals', 'support', 'alerts'].includes(kind)) notFound()
  const { workspace, role, session } = await requireWorkspacePagePermission(kind === 'support' ? 'support:read' : 'portfolio:read', '/discussions/[kind]/[id]')
  const query = await searchParams
  const page = await listDiscussionPage(workspace.id, kind as DiscussionKind, id, kind === 'support' && role === 'client' ? session.userId : undefined, query)
  if (!page) notFound()
  const locale = workspace.locale === 'en' ? 'en' : 'fr', english = locale === 'en'
  return <>
    <PageHeading eyebrow={english ? 'Discussion history' : 'Historique de discussion'} title={page.record.title} description={english ? 'All visible messages, starting with the latest. Apply a search or browse older pages.' : 'Tous les messages visibles, à partir des plus récents. Recherchez un texte ou remontez les pages.'} />
    <Link href={`/${kind}?id=${id}`} className="text-sm underline">{english ? 'Back to the list' : 'Revenir à la liste'}</Link>
    <CollectionControls path={`/discussions/${kind}/${id}`} query={query} page={page} locale={locale} />
    <div className="space-y-3">{page.items.map((comment) => <article key={comment.id} className="rounded-xl border bg-white p-5"><p className="break-words whitespace-pre-wrap text-sm leading-7">{comment.body}</p><p className="mt-3 text-xs text-muted-foreground">{comment.authorKind === 'support' ? 'Yodev Support' : comment.authorUserId === session.userId ? english ? 'You' : 'Vous' : english ? 'Workspace member' : 'Membre du workspace'} · {comment.createdAt.toLocaleString(locale)}</p></article>)}</div>
    {!page.invalidCursor && page.items.length === 0 && <p className="rounded-xl border border-dashed p-8 text-center text-sm">{english ? 'No matching message.' : 'Aucun message correspondant.'}</p>}
  </>
}
