import { formatDistanceToNow } from 'date-fns'
import { fr } from 'date-fns/locale'
import { Check, MessageCircle, ShieldCheck, X } from 'lucide-react'
import { addApprovalComment, approveGoogleAdsChange, rejectGoogleAdsChange } from '@/app/actions'
import { FlashMessage } from '@/components/flash-message'
import { PageHeading } from '@/components/page-heading'
import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import { listApprovals } from '@/lib/data'
import { formatCustomerId } from '@/lib/ids'
import { requireWorkspace } from '@/lib/workspace'

export default async function ApprovalsPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; error?: string }>
}) {
  const query = await searchParams
  const { workspace, isAdmin } = await requireWorkspace()
  const approvals = await listApprovals(workspace.id)
  const pending = approvals.filter(({ request }) => request.status === 'pending')
  return (
    <>
      <PageHeading
        eyebrow="Garde-fous"
        title="Approbations"
        description="Une trace exacte entre l’intention, les échanges, la validation Google Ads et l’exécution finale."
      />
      <FlashMessage notice={query.notice} error={query.error} />
      <div className="mb-5 flex items-center gap-2 text-sm text-muted-foreground">
        <ShieldCheck className="size-4 text-emerald-600" />
        <span>{pending.length} demande{pending.length > 1 ? 's' : ''} en attente</span>
      </div>
      <div className="space-y-4">
        {approvals.map(({ request, client, comments, clientFeedback }) => (
          <Card key={request.id} className="border-[#e8e5ef] shadow-sm">
            <CardContent className="p-5">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge status={request.status} />
                    <span className="text-xs text-muted-foreground">{request.kind === 'campaign_budget' ? 'Budget' : 'Statut'}</span>
                  </div>
                  <h2 className="mt-3 font-semibold tracking-tight">{request.title}</h2>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {client.name} · {formatCustomerId(client.googleCustomerId)} · demandée{' '}
                    {formatDistanceToNow(request.createdAt, { addSuffix: true, locale: fr })}
                  </p>
                  {request.validationRequestId && <p className="mt-2 font-mono text-[10px] text-muted-foreground">Validation Google : {request.validationRequestId}</p>}
                  {request.errorMessage && <p className="mt-2 text-sm text-red-700">{request.errorMessage}</p>}
                  {clientFeedback && (
                    <p className={`mt-3 rounded-lg px-3 py-2 text-sm ${clientFeedback.decision === 'approved' ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-800'}`}>
                      Retour client : {clientFeedback.decision === 'approved' ? 'approuvé' : 'modifications demandées'} par {clientFeedback.authorName}
                      {clientFeedback.comment ? ` - ${clientFeedback.comment}` : ''}
                    </p>
                  )}
                </div>
                {request.status === 'pending' && isAdmin && (
                  <div className="flex shrink-0 gap-2">
                    <form action={rejectGoogleAdsChange}>
                      <input type="hidden" name="approvalId" value={request.id} />
                      <Button variant="outline" size="sm"><X className="mr-1 size-4" />Rejeter</Button>
                    </form>
                    <form action={approveGoogleAdsChange}>
                      <input type="hidden" name="approvalId" value={request.id} />
                      <Button size="sm" className="bg-[var(--brand-accent)] text-white"><Check className="mr-1 size-4" />Approuver et exécuter</Button>
                    </form>
                  </div>
                )}
              </div>
              <div className="mt-5 border-t pt-4">
                <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground"><MessageCircle className="size-4" />Discussion · {comments.length}</p>
                {comments.length > 0 && <div className="mt-3 space-y-2">{comments.map((comment) => <div key={comment.id} className="rounded-xl bg-[#f7f9fa] px-4 py-3"><p className="text-sm leading-6">{comment.body}</p><p className="mt-1 text-[10px] text-muted-foreground">{comment.authorUserId} · {comment.createdAt.toLocaleString('fr-FR')}</p></div>)}</div>}
                <form action={addApprovalComment} className="mt-3 flex flex-col gap-2 sm:flex-row">
                  <input type="hidden" name="approvalId" value={request.id} />
                  <Textarea name="body" aria-label="Commentaire" minLength={2} maxLength={2000} placeholder="Ajouter un contexte, une question ou une justification…" required className="min-h-10" />
                  <Button type="submit" variant="outline" className="shrink-0">Commenter</Button>
                </form>
              </div>
            </CardContent>
          </Card>
        ))}
        {approvals.length === 0 && <div className="rounded-3xl border border-dashed bg-white p-14 text-center text-muted-foreground">Aucune demande. Les changements préparés depuis le cockpit apparaîtront ici.</div>}
      </div>
    </>
  )
}
