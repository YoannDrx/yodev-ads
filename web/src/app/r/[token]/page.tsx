import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { headers } from 'next/headers'
import { Activity, Download, Eye, MousePointerClick, ReceiptText, ShieldCheck, Target } from 'lucide-react'
import { requestReportFeedbackOtp, submitClientApprovalFeedback, verifyReportFeedbackOtp } from '@/app/actions'
import { FlashMessage } from '@/components/flash-message'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import { getPublicShare, getVerifiedReportRecipient, listPublicClientApprovals } from '@/lib/data'
import { buildClientReportModel } from '@/lib/client-report-model'
import { formatInteger, formatMoneyFromMicros, formatPercent } from '@/lib/format'
import { GoogleAdsGateway } from '@/lib/google-ads'
import { consumePublicReportRateLimits, requestIp } from '@/lib/rate-limit'

export const metadata: Metadata = { title: 'Rapport client', robots: { index: false, follow: false } }

export default async function PublicReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>
  searchParams: Promise<{ notice?: string; error?: string; otp?: string }>
}) {
  const { token } = await params
  const query = await searchParams
  const requestHeaders = await headers()
  const requestHost = requestHeaders.get('x-forwarded-host') ?? requestHeaders.get('host')
  const result = await getPublicShare(token, requestHost)
  if (!result) notFound()
  const english = result.share.locale === 'en'
  const rate = await consumePublicReportRateLimits({
    workspaceId: result.share.workspaceId,
    token,
    ip: requestIp(requestHeaders),
  })
  if (!rate.allowed) {
    return <main className="grid min-h-screen place-items-center p-8"><p>{english ? 'Too many requests. Try again in a few minutes.' : 'Trop de requêtes. Réessayez dans quelques minutes.'}</p></main>
  }
  const [campaigns, proposals, verifiedRecipient] = await Promise.all([
    new GoogleAdsGateway(result.connection).campaignPerformance(result.client.googleCustomerId),
    result.share.allowFeedback
      ? listPublicClientApprovals(result.share.workspaceId, result.client.id, result.share.id)
      : Promise.resolve([]),
    result.share.allowFeedback
      ? getVerifiedReportRecipient(result.share.workspaceId, result.share.id)
      : Promise.resolve(undefined),
  ])
  const whiteLabel = result.workspace.plan === 'studio' || result.workspace.plan === 'agency' || result.workspace.plan === 'internal'
  const brandName = whiteLabel ? result.workspace.brandName : 'Ads by Yodev'
  const poweredByYodev = result.workspace.plan === 'studio'
  const report = buildClientReportModel({
    brandName,
    poweredByYodev,
    clientName: result.client.name,
    currencyCode: result.client.currencyCode,
    campaigns,
    periodDays: result.share.periodDays,
    locale: result.share.locale,
    editorialComment: result.share.editorialComment,
    actionPlan: result.share.actionPlan,
  })

  return (
    <main className="min-h-screen bg-[#f3f6f8] text-[#121b24]">
      <header className="border-b border-black/5 bg-[#0d1722] text-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5 sm:px-8">
          <div className="flex items-center gap-3">
            <YodevAdsMark />
            <div>
              <p className="font-semibold">{brandName}</p>
              <p className="text-xs text-white/55">{english ? 'Secure report' : 'Rapport sécurisé'}</p>
            </div>
          </div>
          <span className="flex items-center gap-2 rounded-full bg-white/8 px-3 py-1.5 text-xs text-white/70">
            <Eye className="size-3.5" /> {english ? 'Read only' : 'Lecture seule'}
          </span>
        </div>
      </header>
      <div className="mx-auto max-w-6xl px-5 py-10 sm:px-8 sm:py-14">
        <FlashMessage notice={query.notice} error={query.error} locale={english ? 'en' : 'fr'} />
        <div className="flex flex-col gap-4 border-b border-black/8 pb-8 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[.18em] text-[#2f6b56]">Performance · {report.periodDays} {english ? 'days' : 'jours'}</p>
            <h1 className="mt-3 text-4xl font-semibold tracking-[-.045em]">{result.client.name}</h1>
            <p className="mt-2 text-sm text-[#63717d]">{english ? 'Google Ads data refreshed when this report was opened.' : 'Données Google Ads actualisées à l’ouverture de ce rapport.'}</p>
          </div>
          <div className="flex items-center gap-2 text-xs text-[#517163]">
            <ShieldCheck className="size-4" /> {english ? 'The reader is granted no account access.' : 'Aucun accès au compte n’est accordé au lecteur.'}
          </div>
        </div>
        <div className="mt-5 flex justify-end">
          <a href={`/r/${token}/csv`} className="mr-2 inline-flex h-10 items-center rounded-lg border border-[#0d1722] px-4 text-sm font-medium text-[#0d1722]">
            <Download className="mr-2 size-4" /> {english ? 'Download CSV' : 'Télécharger le CSV'}
          </a>
          <a href={`/r/${token}/pdf`} className="inline-flex h-10 items-center rounded-lg bg-[#0d1722] px-4 text-sm font-medium text-white">
            <Download className="mr-2 size-4" /> {english ? 'Download PDF' : 'Télécharger le PDF'}
          </a>
        </div>
        <section className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <ReportMetric
            label={english ? 'Spend' : 'Investissement'}
            value={formatMoneyFromMicros(report.totals.costMicros, result.client.currencyCode)}
            icon={ReceiptText}
          />
          <ReportMetric label="Conversions" value={formatInteger(report.totals.conversions)} icon={Target} />
          <ReportMetric label={english ? 'Clicks' : 'Clics'} value={formatInteger(report.totals.clicks)} icon={MousePointerClick} />
          <ReportMetric
            label="CTR"
            value={report.totals.ctr === null ? '—' : formatPercent(report.totals.ctr)}
            icon={Activity}
          />
        </section>
        {(report.editorialComment || report.actionPlan) && (
          <section className="mt-6 grid gap-4 md:grid-cols-2">
            {report.editorialComment && <Card className="border-black/8 shadow-none"><CardContent className="p-6"><p className="text-xs font-bold uppercase tracking-[.18em] text-[#2f6b56]">{english ? 'Period commentary' : 'Commentaire de la période'}</p><p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-[#374650]">{report.editorialComment}</p></CardContent></Card>}
            {report.actionPlan && <Card className="border-black/8 shadow-none"><CardContent className="p-6"><p className="text-xs font-bold uppercase tracking-[.18em] text-[#2f6b56]">{english ? 'Action plan' : 'Plan d’action'}</p><p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-[#374650]">{report.actionPlan}</p></CardContent></Card>}
          </section>
        )}
        {proposals.length > 0 && (
          <section className="mt-6 rounded-3xl border border-[#d7e3de] bg-white p-6">
            <div className="mb-5"><p className="text-xs font-bold uppercase tracking-[.18em] text-[#2f6b56]">{english ? 'Decisions to review' : 'Décisions à valider'}</p><h2 className="mt-2 text-xl font-semibold">{english ? 'Proposals from your agency' : 'Propositions de votre agence'}</h2><p className="mt-1 text-sm text-[#63717d]">{english ? 'Your feedback is advisory: only the agency can execute the change in Google Ads.' : 'Votre retour est consultatif : seule l’agence peut exécuter le changement dans Google Ads.'}</p></div>
            {!verifiedRecipient && (
              <div className="mb-5 rounded-2xl bg-[#f3f6f8] p-4">
                <p className="text-sm font-semibold">{english ? 'Email verification required' : 'Vérification email requise'}</p>
                <p className="mt-1 text-xs text-[#63717d]">{english ? 'Reading remains available with this link. An email code is required only to submit a decision.' : 'La lecture reste libre avec ce lien. Un code email est exigé uniquement pour transmettre une décision.'}</p>
                <form action={requestReportFeedbackOtp} className="mt-3 flex flex-col gap-2 sm:flex-row">
                  <input type="hidden" name="token" value={token} />
                  <input type="email" name="email" aria-label={english ? 'Your email' : 'Votre email'} placeholder={english ? 'you@company.com' : 'vous@entreprise.fr'} required maxLength={254} className="h-10 flex-1 rounded-lg border bg-white px-3 text-sm" />
                  <Button type="submit" variant="outline">{english ? 'Receive a code' : 'Recevoir un code'}</Button>
                </form>
                {query.otp === '1' && (
                  <form action={verifyReportFeedbackOtp} className="mt-3 flex flex-col gap-2 sm:flex-row">
                    <input type="hidden" name="token" value={token} />
                    <input name="otp" aria-label={english ? 'Six-digit code' : 'Code à six chiffres'} inputMode="numeric" pattern="[0-9]{6}" maxLength={6} placeholder="000000" required className="h-10 flex-1 rounded-lg border bg-white px-3 font-mono text-sm tracking-[.2em]" />
                    <Button type="submit">{english ? 'Verify' : 'Vérifier'}</Button>
                  </form>
                )}
              </div>
            )}
            <div className="space-y-4">
              {proposals.map(({ request, feedback }) => (
                <div key={request.id} className="rounded-2xl border p-4">
                  <h3 className="font-semibold">{request.title}</h3>
                  {feedback ? (
                    <p className="mt-2 text-sm text-[#517163]">{english ? 'Feedback recorded' : 'Retour enregistré'} : {feedback.decision === 'approved' ? (english ? 'approved' : 'approuvé') : (english ? 'changes requested' : 'modifications demandées')} {english ? 'by' : 'par'} {feedback.authorName}.</p>
                  ) : verifiedRecipient ? (
                    <form action={submitClientApprovalFeedback} className="mt-4 grid gap-3 sm:grid-cols-2">
                      <input type="hidden" name="token" value={token} />
                      <input type="hidden" name="approvalId" value={request.id} />
                      <input name="authorName" aria-label={english ? 'Your name' : 'Votre nom'} placeholder={english ? 'Your name' : 'Votre nom'} required minLength={2} maxLength={120} className="h-10 rounded-lg border px-3 text-sm" />
                      <select name="decision" aria-label={english ? 'Decision' : 'Décision'} className="h-10 rounded-lg border bg-white px-3 text-sm"><option value="approved">{english ? 'I approve' : 'J’approuve'}</option><option value="changes_requested">{english ? 'I request changes' : 'Je demande des modifications'}</option></select>
                      <Textarea name="comment" aria-label={english ? 'Optional comment' : 'Commentaire facultatif'} maxLength={2000} placeholder={english ? 'Optional comment' : 'Commentaire facultatif'} className="sm:col-span-2" />
                      <Button type="submit" className="sm:col-span-2">{english ? 'Submit my feedback' : 'Transmettre mon retour'}</Button>
                    </form>
                  ) : (
                    <p className="mt-2 text-sm text-[#63717d]">{english ? 'Verify your email above to respond.' : 'Vérifiez votre email ci-dessus pour répondre.'}</p>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}
        <Card className="mt-6 overflow-hidden border-black/8 shadow-none">
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-[#f7f9fa] text-left text-xs uppercase tracking-wider text-[#74808a]">
                  <tr>
                    <th className="px-5 py-3">{english ? 'Campaign' : 'Campagne'}</th>
                    <th className="px-4 py-3">{english ? 'Status' : 'Statut'}</th>
                    <th className="px-4 py-3 text-right">{english ? 'Cost' : 'Coût'}</th>
                    <th className="px-4 py-3 text-right">{english ? 'Clicks' : 'Clics'}</th>
                    <th className="px-5 py-3 text-right">Conversions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-black/6">
                  {campaigns.map((campaign) => (
                    <tr key={campaign.id}>
                      <td className="px-5 py-4 font-medium">{campaign.name}</td>
                      <td className="px-4 py-4 text-xs text-[#63717d]">
                        {campaign.status === 'ENABLED' ? (english ? 'Active' : 'Active') : (english ? 'Paused' : 'En pause')}
                      </td>
                      <td className="px-4 py-4 text-right">
                        {formatMoneyFromMicros(campaign.costMicros, result.client.currencyCode)}
                      </td>
                      <td className="px-4 py-4 text-right">{formatInteger(campaign.clicks)}</td>
                      <td className="px-5 py-4 text-right">
                        {campaign.conversions.toLocaleString(english ? 'en-GB' : 'fr-FR', { maximumFractionDigits: 1 })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
        {poweredByYodev && <p className="mt-6 text-center text-xs text-[#8a959e]">Powered by Ads by Yodev</p>}
      </div>
    </main>
  )
}

function ReportMetric({ label, value, icon: Icon }: { label: string; value: string; icon: typeof Activity }) {
  return (
    <Card className="border-black/8 shadow-none">
      <CardContent className="p-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-[#71808c]">{label}</p>
            <p className="mt-2 text-2xl font-semibold tracking-tight">{value}</p>
          </div>
          <span className="grid size-10 place-items-center rounded-xl bg-[#e6f8ef] text-[#1f7554]">
            <Icon className="size-5" />
          </span>
        </div>
      </CardContent>
    </Card>
  )
}

function YodevAdsMark() {
  return (
    <span className="relative grid size-10 place-items-center overflow-hidden rounded-xl bg-[#19A58F] text-[#0d1722]">
      <span className="absolute -top-2 h-5 w-7 rounded-full border-2 border-current" />
      <span className="mt-2 text-sm font-black">A</span>
    </span>
  )
}
