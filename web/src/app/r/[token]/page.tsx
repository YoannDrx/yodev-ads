import { getPublicReportEdition } from '@/lib/report-editions'
import Image from 'next/image'
import { BrandStyles } from '@/components/brand-styles'
import { reportAccent } from '@/lib/report-branding'
import { reportMoney, reportInteger, reportDecimal, reportCampaignStatus } from '@/lib/report-format'
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
import { formatPercent } from '@/lib/format'
import { consumePublicReportRateLimits, requestIp } from '@/lib/rate-limit'

export const metadata: Metadata = { title: 'Rapport client', robots: { index: false, follow: false } }

export default async function PublicReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>
  searchParams: Promise<{ notice?: string; error?: string; otp?: string; edition?: string }>
}) {
  const { token } = await params
  const query = await searchParams
  const requestHeaders = await headers()
  const requestHost = requestHeaders.get('x-forwarded-host') ?? requestHeaders.get('host')
  const result = await getPublicShare(token, requestHost)
  if (!result) notFound()
  const errorEnglish = result.share.locale === 'en'
  const rate = await consumePublicReportRateLimits({
    workspaceId: result.share.workspaceId,
    token,
    ip: requestIp(requestHeaders),
  })
  if (!rate.allowed) {
    return <main className="grid min-h-screen place-items-center p-8"><p>{errorEnglish ? 'Too many requests. Try again in a few minutes.' : 'Trop de requêtes. Réessayez dans quelques minutes.'}</p></main>
  }
  let issued: Awaited<ReturnType<typeof getPublicReportEdition>>
  try {
    issued = await getPublicReportEdition({ workspaceId: result.share.workspaceId, shareId: result.share.id, editionId: query.edition })
  } catch {
    return <main className="grid min-h-screen place-items-center p-8"><p role="status">{errorEnglish ? 'This edition is unavailable or its period is not fully collected. Ask your agency to check the report.' : 'Cette édition n’est pas disponible ou sa période n’est pas entièrement collectée. Demandez à votre agence de vérifier le rapport.'}</p></main>
  }
  const report = issued.model
  const english = report.locale === 'en'
  const campaigns = report.campaigns
  const brandName = report.brandName
  const accent = reportAccent(report.branding?.accentColor)
  const logo = report.branding?.logo
  const poweredByYodev = report.poweredByYodev
  const [proposals, verifiedRecipient] = await Promise.all([
    result.share.allowFeedback ? listPublicClientApprovals(result.share.workspaceId, result.client.id, result.share.id) : Promise.resolve([]),
    result.share.allowFeedback ? getVerifiedReportRecipient(result.share.workspaceId, result.share.id) : Promise.resolve(undefined),
  ])

  return (
    <main className="min-h-screen bg-card text-muted-foreground">
      <BrandStyles accentColor={accent} nonce={requestHeaders.get('x-nonce') ?? undefined} scope="report" />
      <header className="public-report-brand border-b border-border">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-5 py-5 sm:px-8">
          <div className="flex min-w-0 items-center gap-3">
            {logo ? <Image src={`data:image/png;base64,${logo.base64}`} alt={brandName} width={48} height={48} unoptimized className="size-12 shrink-0 rounded-lg bg-card object-contain p-1" /> : brandName === 'Yodev Ads' ? <YodevAdsMark /> : <span className="grid size-12 shrink-0 place-items-center rounded-lg border border-current text-xl font-bold" aria-hidden="true">{brandName.slice(0, 1)}</span>}
            <div className="min-w-0">
              <p className="font-semibold break-words">{brandName}</p>
              <p className="text-xs">{english ? 'Secure report' : 'Rapport sécurisé'}</p>
            </div>
          </div>
          <span className="flex shrink-0 items-center gap-2 rounded-md bg-card px-3 py-1.5 text-xs">
            <Eye className="size-3.5" /> {english ? 'Read only' : 'Lecture seule'}
          </span>
        </div>
      </header>
      <div className="mx-auto max-w-6xl px-5 py-10 sm:px-8 sm:py-14">
        <FlashMessage notice={query.notice} error={query.error} locale={english ? 'en' : 'fr'} />
        <div className="flex flex-col gap-4 border-b border-border pb-8 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-[.18em] text-muted-foreground">Performance · {report.periodDays} {english ? 'days' : 'jours'}</p>
            <h1 className="mt-3 text-4xl font-semibold tracking-[-.045em] break-words">{report.clientName}</h1>
            <p className="mt-2 text-sm text-muted-foreground">{report.window?.from} → {report.window?.through} · {report.window?.timezone}</p>
            <p className="mt-2 text-xs text-muted-foreground">{!query.edition && result.share.mode === 'dynamic' ? (english ? 'Dynamic link · current stored data' : 'Lien dynamique · données enregistrées actuelles') : (english ? 'Immutable edition' : 'Édition figée')} · {english ? 'Edition' : 'Édition'} {issued.edition.editionNumber} · {report.generatedAt.toLocaleString(english ? 'en-GB' : 'fr-FR', { timeZone: report.window?.timezone })}</p>
            <p className="mt-1 text-xs text-muted-foreground">{english ? 'Data version' : 'Version des données'} : {report.sourceVersion?.slice(0, 12)}</p>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <ShieldCheck className="size-4" /> {english ? 'The reader is granted no account access.' : 'Aucun accès au compte n’est accordé au lecteur.'}
          </div>
        </div>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <a href={`/r/${token}/csv?edition=${issued.edition.id}`} className="inline-flex h-10 items-center rounded-lg border border-border px-4 text-sm font-medium text-foreground">
            <Download className="mr-2 size-4" /> {english ? 'Download CSV' : 'Télécharger le CSV'}
          </a>
          <a href={`/r/${token}/pdf?edition=${issued.edition.id}`} className="inline-flex h-10 items-center rounded-lg bg-card px-4 text-sm font-medium text-foreground">
            <Download className="mr-2 size-4" /> {english ? 'Download PDF' : 'Télécharger le PDF'}
          </a>
        </div>
        <section className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <ReportMetric
            label={english ? 'Spend' : 'Investissement'}
            value={reportMoney(report.totals.costMicros, report.currencyCode, report.locale)}
            icon={ReceiptText}
          />
          <ReportMetric label="Conversions" value={reportDecimal(report.totals.conversions, report.locale)} icon={Target} />
          <ReportMetric label={english ? 'Clicks' : 'Clics'} value={reportInteger(report.totals.clicks, report.locale)} icon={MousePointerClick} />
          <ReportMetric
            label="CTR"
            value={report.totals.ctr === null ? '—' : formatPercent(report.totals.ctr, english ? 'en-GB' : 'fr-FR')}
            icon={Activity}
          />
        </section>
        {(report.editorialComment || report.actionPlan) && (
          <section className="mt-6 grid gap-4 md:grid-cols-2">
            {report.editorialComment && <Card className="min-w-0 border-border shadow-none"><CardContent className="p-6"><p className="text-xs font-bold uppercase tracking-[.18em] text-muted-foreground">{english ? 'Period commentary' : 'Commentaire de la période'}</p><p className="mt-3 break-words whitespace-pre-wrap text-sm leading-7 text-muted-foreground">{report.editorialComment}</p></CardContent></Card>}
            {report.actionPlan && <Card className="min-w-0 border-border shadow-none"><CardContent className="p-6"><p className="text-xs font-bold uppercase tracking-[.18em] text-muted-foreground">{english ? 'Action plan' : 'Plan d’action'}</p><p className="mt-3 break-words whitespace-pre-wrap text-sm leading-7 text-muted-foreground">{report.actionPlan}</p></CardContent></Card>}
          </section>
        )}
        {proposals.length > 0 && (
          <section className="mt-6 rounded-md border border-border bg-card p-6">
            <div className="mb-5"><p className="text-xs font-bold uppercase tracking-[.18em] text-muted-foreground">{english ? 'Current decisions · outside the frozen report' : 'Décisions actuelles · hors du bilan figé'}</p><h2 className="mt-2 text-xl font-semibold">{english ? 'Proposals from your agency' : 'Propositions de votre agence'}</h2><p className="mt-1 text-sm text-muted-foreground">{english ? 'Your feedback is advisory: only the agency can execute the change in Google Ads.' : 'Votre retour est consultatif : seule l’agence peut exécuter le changement dans Google Ads.'}</p></div>
            {!verifiedRecipient && (
              <div className="mb-5 rounded-md bg-card p-4">
                <p className="text-sm font-semibold">{english ? 'Email verification required' : 'Vérification email requise'}</p>
                <p className="mt-1 text-xs text-muted-foreground">{english ? 'Reading remains available with this link. An email code is required only to submit a decision.' : 'La lecture reste libre avec ce lien. Un code email est exigé uniquement pour transmettre une décision.'}</p>
                <form action={requestReportFeedbackOtp} className="mt-3 flex flex-col gap-2 sm:flex-row">
                  <input type="hidden" name="token" value={token} />
                  <input type="hidden" name="edition" value={issued.edition.id} />
                  <input type="email" name="email" aria-label={english ? 'Your email' : 'Votre email'} placeholder={english ? 'you@company.com' : 'vous@entreprise.fr'} required maxLength={254} className="h-10 flex-1 rounded-lg border bg-card px-3 text-sm" />
                  <Button type="submit" variant="outline">{english ? 'Receive a code' : 'Recevoir un code'}</Button>
                </form>
                {query.otp === '1' && (
                  <form action={verifyReportFeedbackOtp} className="mt-3 flex flex-col gap-2 sm:flex-row">
                    <input type="hidden" name="token" value={token} />
                  <input type="hidden" name="edition" value={issued.edition.id} />
                    <input name="otp" aria-label={english ? 'Six-digit code' : 'Code à six chiffres'} inputMode="numeric" pattern="[0-9]{6}" maxLength={6} placeholder="000000" required className="h-10 flex-1 rounded-lg border bg-card px-3 font-mono text-sm tracking-[.2em]" />
                    <Button type="submit">{english ? 'Verify' : 'Vérifier'}</Button>
                  </form>
                )}
              </div>
            )}
            <div className="space-y-4">
              {proposals.map(({ request, feedback }) => (
                <div key={request.id} className="rounded-md border p-4">
                  <h3 className="font-semibold">{request.title}</h3>
                  {feedback ? (
                    <p className="mt-2 text-sm text-muted-foreground">{english ? 'Feedback recorded' : 'Retour enregistré'} : {feedback.decision === 'approved' ? (english ? 'approved' : 'approuvé') : (english ? 'changes requested' : 'modifications demandées')} {english ? 'by' : 'par'} {feedback.authorName}.</p>
                  ) : verifiedRecipient ? (
                    <form action={submitClientApprovalFeedback} className="mt-4 grid gap-3 sm:grid-cols-2">
                      <input type="hidden" name="token" value={token} />
                  <input type="hidden" name="edition" value={issued.edition.id} />
                      <input type="hidden" name="approvalId" value={request.id} />
                      <input name="authorName" aria-label={english ? 'Your name' : 'Votre nom'} placeholder={english ? 'Your name' : 'Votre nom'} required minLength={2} maxLength={120} className="h-10 rounded-lg border px-3 text-sm" />
                      <select name="decision" aria-label={english ? 'Decision' : 'Décision'} className="h-10 rounded-lg border bg-card px-3 text-sm"><option value="approved">{english ? 'I approve' : 'J’approuve'}</option><option value="changes_requested">{english ? 'I request changes' : 'Je demande des modifications'}</option></select>
                      <Textarea name="comment" aria-label={english ? 'Optional comment' : 'Commentaire facultatif'} maxLength={2000} placeholder={english ? 'Optional comment' : 'Commentaire facultatif'} className="sm:col-span-2" />
                      <Button type="submit" className="sm:col-span-2">{english ? 'Submit my feedback' : 'Transmettre mon retour'}</Button>
                    </form>
                  ) : (
                    <p className="mt-2 text-sm text-muted-foreground">{english ? 'Verify your email above to respond.' : 'Vérifiez votre email ci-dessus pour répondre.'}</p>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}
        <Card className="mt-6 overflow-hidden border-border shadow-none">
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-card text-left text-xs uppercase tracking-wider text-muted-foreground">
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
                      <td className="px-4 py-4 text-xs text-muted-foreground">
                        {reportCampaignStatus(campaign.status, report.locale)}
                      </td>
                      <td className="px-4 py-4 text-right">
                        {reportMoney(campaign.costMicros, report.currencyCode, report.locale)}
                      </td>
                      <td className="px-4 py-4 text-right">{reportInteger(campaign.clicks, report.locale)}</td>
                      <td className="px-5 py-4 text-right">
                        {reportDecimal(campaign.conversions, report.locale)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
        {poweredByYodev && <p className="mt-6 text-center text-xs text-muted-foreground">Powered by Yodev Ads</p>}
      </div>
    </main>
  )
}

function ReportMetric({ label, value, icon: Icon }: { label: string; value: string; icon: typeof Activity }) {
  return (
    <Card className="min-w-0 border-border shadow-none">
      <CardContent className="p-5">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="mt-2 break-words text-2xl font-semibold tracking-tight">{value}</p>
          </div>
          <span className="grid size-10 shrink-0 place-items-center rounded-md bg-card text-muted-foreground">
            <Icon className="size-5" />
          </span>
        </div>
      </CardContent>
    </Card>
  )
}

function YodevAdsMark() {
  return (
    <span className="relative grid size-10 shrink-0 place-items-center overflow-hidden rounded-md bg-primary text-primary-foreground">
      <span className="absolute -top-2 h-5 w-7 rounded-md border-2 border-current" />
      <span className="mt-2 text-sm font-black">A</span>
    </span>
  )
}
