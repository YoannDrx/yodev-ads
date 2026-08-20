import { formatDistanceToNow } from 'date-fns'
import { enGB, fr } from 'date-fns/locale'
import { Check, Layers3, ListTodo, MessageCircle, ShieldCheck, X } from 'lucide-react'
import { addApprovalComment, approveGoogleAdsChange, createWorkspaceTask, rejectGoogleAdsChange, requestAtomicGoogleAdsBatch } from '@/app/actions'
import { FlashMessage } from '@/components/flash-message'
import { PageHeading } from '@/components/page-heading'
import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import { listApprovals } from '@/lib/data'
import { formatCustomerId } from '@/lib/ids'
import { permissionsForRole } from '@/lib/permissions'
import { requireWorkspacePermission } from '@/lib/workspace'

export default async function ApprovalsPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; error?: string }>
}) {
  const query = await searchParams
  const { workspace, isAdmin, role } = await requireWorkspacePermission('portfolio:read')
  const english = workspace.locale === 'en'
  const locale = english ? 'en' : 'fr'
  const permissions = permissionsForRole(role)
  const canManageTasks = permissions.has('tasks:manage')
  const canPropose = permissions.has('google:propose')
  const approvals = await listApprovals(workspace.id)
  const pending = approvals.filter(({ request }) => request.status === 'pending')
  const batchKinds = new Set(['campaign_status', 'campaign_budget', 'keyword_status', 'ad_status'])
  const batchGroups = new Map<string, typeof approvals>()
  if (canPropose && (workspace.plan === 'agency' || workspace.plan === 'internal')) {
    for (const approval of pending.filter(({ request }) => batchKinds.has(request.kind))) {
      batchGroups.set(approval.client.id, [...(batchGroups.get(approval.client.id) ?? []), approval])
    }
  }
  return (
    <>
      <PageHeading
        eyebrow={english ? 'Safeguards' : 'Garde-fous'}
        title={english ? 'Approvals' : 'Approbations'}
        description={english ? 'An exact trail from intent and discussion through Google Ads validation and final execution.' : 'Une trace exacte entre l’intention, les échanges, la validation Google Ads et l’exécution finale.'}
      />
      <FlashMessage notice={query.notice} error={query.error} locale={locale} />
      <div className="mb-5 flex items-center gap-2 text-sm text-muted-foreground">
        <ShieldCheck className="size-4 text-emerald-600" />
        <span>{pending.length} {english ? `pending request${pending.length === 1 ? '' : 's'}` : `demande${pending.length > 1 ? 's' : ''} en attente`}</span>
      </div>
      {[...batchGroups.values()].filter((group) => group.length >= 2).map((group) => (
        <Card key={`batch-${group[0].client.id}`} className="mb-5 border-indigo-200 bg-indigo-50/50 shadow-sm">
          <CardContent className="p-5">
            <div className="flex items-start gap-3">
              <Layers3 className="mt-0.5 size-5 text-indigo-700" />
              <div><h2 className="font-semibold text-indigo-950">{english ? 'Atomic batch' : 'Batch atomique'} · {group[0].client.name}</h2><p className="mt-1 text-xs text-indigo-800">{english ? 'Select 2 to 20 reversible updates. Google will validate and execute them in one request with' : 'Sélectionnez 2 à 20 mises à jour réversibles. Google les validera et les exécutera dans une seule requête avec'} <code>partialFailure=false</code>.</p></div>
            </div>
            <form action={requestAtomicGoogleAdsBatch} className="mt-4 space-y-2">
              {group.map(({ request }) => (
                <label key={`batch-source-${request.id}`} className="flex cursor-pointer items-start gap-3 rounded-xl border bg-white px-4 py-3 text-sm">
                  <input type="checkbox" name="approvalId" value={request.id} className="mt-1 size-4" />
                  <span><span className="font-medium">{request.title}</span><span className="mt-0.5 block text-xs text-muted-foreground">{approvalKindLabel(request.kind, locale)}</span></span>
                </label>
              ))}
              <Button type="submit" size="sm" className="bg-indigo-700 text-white"><Layers3 className="mr-1 size-4" />{english ? 'Create atomic batch' : 'Créer le batch atomique'}</Button>
            </form>
          </CardContent>
        </Card>
      ))}
      <div className="space-y-4">
        {approvals.map(({ request, client, comments, clientFeedback, observation }) => (
          <Card key={request.id} className="border-[#e8e5ef] shadow-sm">
            <CardContent className="p-5">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge status={request.status} locale={locale} />
                    <span className="text-xs text-muted-foreground">{approvalKindLabel(request.kind, locale)}</span>
                  </div>
                  <h2 className="mt-3 font-semibold tracking-tight">{request.title}</h2>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {client.name} · {formatCustomerId(client.googleCustomerId)} · {english ? 'requested' : 'demandée'}{' '}
                    {formatDistanceToNow(request.createdAt, { addSuffix: true, locale: english ? enGB : fr })}
                  </p>
                  {request.validationRequestId && <p className="mt-2 font-mono text-[10px] text-muted-foreground">{english ? 'Google validation' : 'Validation Google'} : {request.validationRequestId}</p>}
                  {request.expectedState && request.proposedState && (
                    <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
                      <div className="rounded-lg bg-slate-50 px-3 py-2">
                        <span className="font-semibold text-slate-700">{english ? 'Before' : 'Avant'}</span>
                        <pre className="mt-1 overflow-x-auto whitespace-pre-wrap text-[10px] text-slate-600">{JSON.stringify(request.expectedState, null, 2)}</pre>
                      </div>
                      <div className="rounded-lg bg-emerald-50 px-3 py-2">
                        <span className="font-semibold text-emerald-800">{english ? 'Proposed' : 'Proposé'}</span>
                        <pre className="mt-1 overflow-x-auto whitespace-pre-wrap text-[10px] text-emerald-700">{JSON.stringify(request.proposedState, null, 2)}</pre>
                      </div>
                    </div>
                  )}
                  {request.kind === 'campaign_budget' && request.expectedState?.explicitlyShared === true && (
                    <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
                      {english ? `Budget shared by ${String(request.expectedState.referenceCount ?? 'several')} campaigns: this change will affect every use.` : `Budget partagé entre ${String(request.expectedState.referenceCount ?? 'plusieurs')} campagnes : le changement affectera toutes ses utilisations.`}
                    </p>
                  )}
                  {request.impactPreview && (
                    <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs">
                      <div className="flex flex-wrap items-center gap-2 font-semibold text-slate-800">
                        <span>{request.impactPreview.atomic ? (english ? 'All or nothing' : 'Tout ou rien') : (english ? 'Single operation' : 'Opération unique')}</span>
                        <span>· {request.impactPreview.operationCount} {english ? `operation${request.impactPreview.operationCount === 1 ? '' : 's'}` : `opération${request.impactPreview.operationCount > 1 ? 's' : ''}`}</span>
                        <span>· {english ? `${request.impactPreview.observationWindowDays}-day observation` : `observation ${request.impactPreview.observationWindowDays} jours`}</span>
                      </div>
                      {request.impactPreview.conflicts.length > 0 && (
                        <div className="mt-2 space-y-1">
                          {request.impactPreview.conflicts.map((conflict) => (
                            <p key={`${request.id}-${conflict.code}-${conflict.resourceName ?? 'global'}`} className={conflict.severity === 'warning' ? 'text-amber-800' : conflict.severity === 'blocking' ? 'text-red-700' : 'text-slate-600'}>
                              {conflict.severity === 'warning' ? (english ? 'Warning: ' : 'Attention : ') : ''}{conflict.message}
                            </p>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                  {observation && (
                    <div className="mt-3 rounded-xl border border-cyan-200 bg-cyan-50 px-4 py-3 text-xs text-cyan-950">
                      <div className="flex flex-wrap items-center gap-2"><span className="font-semibold">{english ? 'Before/after observation' : 'Observation avant/après'}</span><StatusBadge status={observation.status} locale={locale} /></div>
                      <p className="mt-1">{english ? 'Baseline' : 'Référence'} {observation.baselineFrom} → {observation.baselineThrough} · {english ? 'observation' : 'observation'} {observation.observationFrom} → {observation.observationThrough}</p>
                      {observation.outcome && <p className="mt-1 font-medium">{english ? 'Cost' : 'Coût'} {formatObservationDelta(observation.outcome, 'cost', locale)} · {english ? 'conversions' : 'conversions'} {formatObservationDelta(observation.outcome, 'conversions', locale)} · {english ? 'value' : 'valeur'} {formatObservationDelta(observation.outcome, 'conversionValue', locale)}</p>}
                    </div>
                  )}
                  <p className="mt-2 text-xs text-muted-foreground">
                    {english ? `${request.requiredApprovals} approval${request.requiredApprovals === 1 ? '' : 's'} required.` : `${request.requiredApprovals} approbation${request.requiredApprovals > 1 ? 's' : ''} requise${request.requiredApprovals > 1 ? 's' : ''}.`}
                  </p>
                  {request.errorMessage && <p className="mt-2 text-sm text-red-700">{request.errorMessage}</p>}
                  {clientFeedback && (
                    <p className={`mt-3 rounded-lg px-3 py-2 text-sm ${clientFeedback.decision === 'approved' ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-800'}`}>
                      {english ? 'Client feedback' : 'Retour client'} : {clientFeedback.decision === 'approved' ? (english ? 'approved' : 'approuvé') : (english ? 'changes requested' : 'modifications demandées')} {english ? 'by' : 'par'} {clientFeedback.authorName}
                      {clientFeedback.comment ? ` - ${clientFeedback.comment}` : ''}
                    </p>
                  )}
                </div>
                {request.status === 'pending' && (isAdmin || canManageTasks) && (
                  <div className="flex shrink-0 gap-2">
                    {canManageTasks && (
                      <form action={createWorkspaceTask}>
                        <input type="hidden" name="sourceType" value="approval" />
                        <input type="hidden" name="sourceEntityId" value={request.id} />
                        <input type="hidden" name="priority" value="high" />
                        <input type="hidden" name="slaHours" value="72" />
                        <input type="hidden" name="assignSelf" value="on" />
                        <input type="hidden" name="returnTo" value="approvals" />
                        <Button type="submit" variant="outline" size="sm"><ListTodo className="mr-1 size-4" />{english ? 'Create task' : 'Créer une tâche'}</Button>
                      </form>
                    )}
                    {isAdmin && (
                      <>
                        <form action={rejectGoogleAdsChange}>
                          <input type="hidden" name="approvalId" value={request.id} />
                          <Button variant="outline" size="sm"><X className="mr-1 size-4" />{english ? 'Reject' : 'Rejeter'}</Button>
                        </form>
                        <form action={approveGoogleAdsChange}>
                          <input type="hidden" name="approvalId" value={request.id} />
                          <Button size="sm" className="bg-[var(--brand-accent)] text-white"><Check className="mr-1 size-4" />{english ? 'Approve' : 'Approuver'}</Button>
                        </form>
                      </>
                    )}
                  </div>
                )}
              </div>
              <div className="mt-5 border-t pt-4">
                <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground"><MessageCircle className="size-4" />{english ? 'Discussion' : 'Discussion'} · {comments.length}</p>
                {comments.length > 0 && <div className="mt-3 space-y-2">{comments.map((comment) => <div key={comment.id} className="rounded-xl bg-[#f7f9fa] px-4 py-3"><p className="text-sm leading-6">{comment.body}</p><p className="mt-1 text-[10px] text-muted-foreground">{comment.authorUserId} · {comment.createdAt.toLocaleString(english ? 'en-GB' : 'fr-FR')}</p></div>)}</div>}
                <form action={addApprovalComment} className="mt-3 flex flex-col gap-2 sm:flex-row">
                  <input type="hidden" name="approvalId" value={request.id} />
                  <Textarea name="body" aria-label={english ? 'Comment' : 'Commentaire'} minLength={2} maxLength={2000} placeholder={english ? 'Add context, a question or a rationale…' : 'Ajouter un contexte, une question ou une justification…'} required className="min-h-10" />
                  <Button type="submit" variant="outline" className="shrink-0">{english ? 'Comment' : 'Commenter'}</Button>
                </form>
              </div>
            </CardContent>
          </Card>
        ))}
        {approvals.length === 0 && <div className="rounded-3xl border border-dashed bg-white p-14 text-center text-muted-foreground">{english ? 'No request. Changes prepared from the cockpit will appear here.' : 'Aucune demande. Les changements préparés depuis le cockpit apparaîtront ici.'}</div>}
      </div>
    </>
  )
}

function approvalKindLabel(kind: string, locale: 'fr' | 'en') {
  const labels: Record<'fr' | 'en', Record<string, string>> = {
    fr: { campaign_budget: 'Budget de campagne', campaign_status: 'Statut de campagne', budget_reallocation: 'Réallocation atomique', atomic_change_batch: 'Batch multi-opérations atomique', keyword_create_negative: 'Mot-clé négatif', keyword_create_positive: 'Promotion de requête', keyword_status: 'Statut de mot-clé', ad_status: 'Statut d’annonce', rsa_create_draft: 'Draft RSA' },
    en: { campaign_budget: 'Campaign budget', campaign_status: 'Campaign status', budget_reallocation: 'Atomic reallocation', atomic_change_batch: 'Atomic multi-operation batch', keyword_create_negative: 'Negative keyword', keyword_create_positive: 'Search term promotion', keyword_status: 'Keyword status', ad_status: 'Ad status', rsa_create_draft: 'RSA draft' },
  }
  return labels[locale][kind] ?? kind
}

function formatObservationDelta(outcome: Record<string, unknown>, metric: string, locale: 'fr' | 'en') {
  const deltas = outcome.deltasPercent
  const value = deltas && typeof deltas === 'object' ? (deltas as Record<string, unknown>)[metric] : null
  return typeof value === 'number' ? `${value > 0 ? '+' : ''}${value.toLocaleString(locale === 'en' ? 'en-GB' : 'fr-FR')} %` : locale === 'en' ? 'not computable' : 'non calculable'
}
