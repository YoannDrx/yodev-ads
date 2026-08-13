import { Activity, CalendarDays, CircleAlert, History, MousePointerClick, ReceiptText, ShieldCheck, Target } from 'lucide-react'
import { PageHeading } from '@/components/page-heading'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import {
  getWorkspaceClient,
  listClientTimeline,
  listDailyAccountHistory,
  listLatestConversionActionSnapshots,
  listLatestOfflineConversionDiagnostics,
  listWorkspaceClients,
} from '@/lib/data'
import { formatInteger, formatMoneyFromMicros, formatPercent } from '@/lib/format'
import { analyzePerformanceChanges, type PerformanceComparison } from '@/lib/performance-diagnostics'
import { diagnoseConversionActions, diagnoseOfflineConversionImports } from '@/lib/tracking-diagnostics'
import { requireWorkspace } from '@/lib/workspace'

export default async function HistoryPage({ searchParams }: { searchParams: Promise<{ client?: string }> }) {
  const query = await searchParams
  const { workspace, entitlements } = await requireWorkspace()
  const english = workspace.locale === 'en'
  const locale = english ? 'en' : 'fr'
  const [clients, client] = await Promise.all([
    listWorkspaceClients(workspace.id),
    getWorkspaceClient(workspace.id, query.client),
  ])
  const historyDays = ({ trial: 30, solo: 90, studio: 365, agency: 730, internal: 730 } as const)[entitlements.plan]
  const [history, conversions, offlineDiagnostics, timeline] = client
    ? await Promise.all([
        listDailyAccountHistory(workspace.id, client.id, historyDays),
        listLatestConversionActionSnapshots(workspace.id, client.id),
        listLatestOfflineConversionDiagnostics(workspace.id, client.id),
        listClientTimeline(workspace.id, client.id),
      ])
    : [[], [], [], { changes: [], internal: [] }]
  const totals = history.reduce((sum, point) => ({
    costMicros: sum.costMicros + Number(point.costMicros),
    clicks: sum.clicks + Number(point.clicks),
    conversions: sum.conversions + Number(point.conversions),
    conversionValueMicros: sum.conversionValueMicros + Number(point.conversionValueMicros),
  }), { costMicros: 0, clicks: 0, conversions: 0, conversionValueMicros: 0 })
  const diagnostics = [
    ...diagnoseConversionActions(conversions, new Date(), locale),
    ...diagnoseOfflineConversionImports(conversions, offlineDiagnostics, new Date(), locale),
  ].sort((left, right) => ({ critical: 0, warning: 1, info: 2 })[left.severity] - ({ critical: 0, warning: 1, info: 2 })[right.severity])
  const performanceDiagnostics = analyzePerformanceChanges(history, locale)
  const unifiedTimeline = [
    ...timeline.changes.map((change) => ({
      id: `google:${change.id}`,
      occurredAt: change.changedAt,
      source: 'Google Ads',
      title: `${change.operation} · ${change.resourceType}`,
      description: `${change.changedFields.length ? change.changedFields.join(', ') : (english ? 'Fields not detailed' : 'Champs non détaillés')}${change.changedBy ? ` · ${change.changedBy}` : ''}`,
      linked: Boolean(change.internalAuditEventId),
    })),
    ...timeline.internal.map(({ audit, approval }) => ({
      id: `internal:${audit.id}`,
      occurredAt: audit.createdAt,
      source: 'Ads by Yodev',
      title: approval.title,
      description: audit.action,
      linked: true,
    })),
  ].sort((left, right) => right.occurredAt.getTime() - left.occurredAt.getTime()).slice(0, 100)

  return (
    <>
      <PageHeading
        eyebrow={english ? 'Actual history' : 'Historique réel'}
        title={english ? 'Performance, tracking and changes' : 'Performance, tracking et changements'}
        description={english ? `Daily metrics, conversion configuration and factual timeline. Display retention: ${historyDays} days.` : `Métriques journalières, configuration des conversions et timeline factuelle. Rétention affichable : ${historyDays} jours.`}
        actions={clients.length ? (
          <form>
            <select name="client" defaultValue={client?.id} aria-label={english ? 'Client account' : 'Compte client'} className="h-10 rounded-lg border bg-white px-3 text-sm">
              {clients.filter((item) => !item.isManager).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
            <button className="ml-2 h-10 rounded-lg border bg-white px-4 text-sm">{english ? 'Show' : 'Afficher'}</button>
          </form>
        ) : undefined}
      />

      {history.length > 0 && client ? (
        <>
          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <HistoryMetric icon={ReceiptText} label={english ? `Spend · ${history.length} observed days` : `Investissement · ${history.length} j observés`} value={formatMoneyFromMicros(totals.costMicros, client.currencyCode)} />
            <HistoryMetric icon={Target} label="Conversions" value={totals.conversions.toLocaleString(english ? 'en-GB' : 'fr-FR', { maximumFractionDigits: 1 })} />
            <HistoryMetric icon={MousePointerClick} label={english ? 'Clicks' : 'Clics'} value={formatInteger(totals.clicks)} />
            <HistoryMetric icon={Activity} label={english ? 'Conversion value' : 'Valeur de conversion'} value={formatMoneyFromMicros(totals.conversionValueMicros, client.currencyCode)} />
          </section>
          <Card className="mt-6 border-[#dde4e7] shadow-none"><CardContent className="p-0"><div className="overflow-x-auto"><table className="w-full text-sm">
            <thead className="bg-[#f7f9fa] text-left text-xs uppercase tracking-wider text-muted-foreground"><tr><th className="px-5 py-3">Date</th><th className="px-4 py-3 text-right">{english ? 'Daily cost' : 'Coût du jour'}</th><th className="px-4 py-3 text-right">Impressions</th><th className="px-4 py-3 text-right">{english ? 'Clicks' : 'Clics'}</th><th className="px-5 py-3 text-right">Conversions</th></tr></thead>
            <tbody className="divide-y">{[...history].reverse().map((point) => <tr key={point.id} className="bg-white"><td className="px-5 py-3 font-medium">{new Date(`${point.metricDate}T12:00:00Z`).toLocaleDateString(english ? 'en-GB' : 'fr-FR')}</td><td className="px-4 py-3 text-right">{formatMoneyFromMicros(point.costMicros, point.currencyCode)}</td><td className="px-4 py-3 text-right">{formatInteger(point.impressions)}</td><td className="px-4 py-3 text-right">{formatInteger(point.clicks)}</td><td className="px-5 py-3 text-right">{Number(point.conversions).toLocaleString(english ? 'en-GB' : 'fr-FR', { maximumFractionDigits: 1 })}</td></tr>)}</tbody>
          </table></div></CardContent></Card>
        </>
      ) : (
        <div className="rounded-3xl border border-dashed bg-white p-14 text-center text-muted-foreground"><CalendarDays className="mx-auto mb-4 size-8" />{english ? 'Daily metrics will be available after the next synchronization job. Legacy rolling 30-day snapshots are no longer presented as daily data.' : 'Les métriques journalières seront disponibles après le prochain job de synchronisation. Les anciens snapshots glissants de 30 jours ne sont plus présentés comme des données quotidiennes.'}</div>
      )}

      <Card className="mt-6 border-[#dde4e7] shadow-none"><CardContent className="p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><h2 className="font-semibold">{english ? 'Significant changes' : 'Variations significatives'}</h2><p className="mt-1 text-sm text-muted-foreground">{english ? 'Deterministic windows and comparable days. Temporal correlation is never presented as causation.' : 'Fenêtres déterministes et jours comparables. Une corrélation temporelle n’est jamais présentée comme une cause.'}</p></div>
          {performanceDiagnostics.asOf && <Badge variant="outline">{english ? 'Data through' : 'Données au'} {new Date(`${performanceDiagnostics.asOf}T12:00:00Z`).toLocaleDateString(english ? 'en-GB' : 'fr-FR')}</Badge>}
        </div>
        {performanceDiagnostics.comparisons.length === 0 ? (
          <p className="mt-5 rounded-xl border border-dashed p-4 text-sm text-muted-foreground">{english ? 'No daily series available.' : 'Aucune série journalière disponible.'}</p>
        ) : (
          <div className="mt-5 grid gap-3 lg:grid-cols-3">
            {performanceDiagnostics.comparisons.map((comparison) => <ComparisonCard key={comparison.kind} comparison={comparison} currency={client?.currencyCode ?? 'EUR'} locale={locale} />)}
          </div>
        )}
        {performanceDiagnostics.findings.length > 0 && (
          <div className="mt-5 space-y-2">
            {performanceDiagnostics.findings.map((finding) => (
              <article key={finding.id} className="rounded-xl border p-4">
                <div className="flex flex-wrap items-center gap-2"><h3 className="text-sm font-semibold">{finding.title}</h3><Badge variant="outline">{english ? 'confidence' : 'confiance'} {finding.confidence}</Badge></div>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">{finding.description}</p>
              </article>
            ))}
          </div>
        )}
      </CardContent></Card>

      <section className="mt-6 grid gap-6 xl:grid-cols-2">
        <Card className="border-[#dde4e7] shadow-none"><CardContent className="p-6">
          <div className="flex items-center gap-3"><ShieldCheck className="size-5 text-[var(--brand-accent)]" /><div><h2 className="font-semibold">{english ? 'Conversion diagnostics' : 'Diagnostic des conversions'}</h2><p className="text-sm text-muted-foreground">{english ? 'API configuration and activity received by Google, distinct from a real on-site test.' : 'Configuration API et activité reçue par Google, distinctes d’un test réel sur le site.'}</p></div></div>
          {diagnostics.length === 0 ? <p className="mt-5 rounded-xl border border-dashed p-4 text-sm text-muted-foreground">{conversions.length ? (english ? 'No deterministic signal in the latest snapshot.' : 'Aucun signal déterministe sur le dernier snapshot.') : (english ? 'The conversion-action snapshot will be collected by the scheduler.' : 'Le snapshot des actions de conversion sera collecté par le scheduler.')}</p> : <div className="mt-5 space-y-3">{diagnostics.map((finding) => <article key={finding.id} className="rounded-xl border p-4"><div className="flex flex-wrap items-center gap-2"><CircleAlert className="size-4" /><h3 className="text-sm font-semibold">{finding.title}</h3><Badge variant={finding.severity === 'critical' ? 'destructive' : 'outline'}>{finding.confidence === 'high' ? (english ? 'API evidence' : 'preuve API') : (english ? 'probable' : 'probable')}</Badge></div><p className="mt-2 text-sm leading-6 text-muted-foreground">{finding.description}</p></article>)}</div>}
          <div className="mt-5 rounded-xl bg-[#f7f9fa] p-4 text-xs leading-5 text-muted-foreground"><strong>{english ? 'On-site checklist' : 'Checklist terrain'} :</strong> {english ? 'open Tag Assistant, trigger a test conversion, verify consent/cookies, duplicate tags and receipt in Google Ads/GA4. The API alone cannot certify browser firing.' : 'ouvrir Tag Assistant, déclencher une conversion de test, vérifier consentement/cookies, doublons de balise et réception dans Google Ads/GA4. L’API seule ne certifie pas le déclenchement navigateur.'}</div>
        </CardContent></Card>

        <Card className="border-[#dde4e7] shadow-none"><CardContent className="p-6">
          <div className="flex items-center gap-3"><History className="size-5 text-[var(--brand-accent)]" /><div><h2 className="font-semibold">{english ? 'Unified timeline' : 'Timeline unifiée'}</h2><p className="text-sm text-muted-foreground">{english ? 'Google changes and internal actions, without automatic claims of causation.' : 'Changements Google et actions internes, sans affirmation automatique de causalité.'}</p></div></div>
          {unifiedTimeline.length === 0 ? <p className="mt-5 rounded-xl border border-dashed p-4 text-sm text-muted-foreground">{english ? 'No synchronized event over the last 30 days.' : 'Aucun événement synchronisé sur les 30 derniers jours.'}</p> : <ol className="mt-5 space-y-3">{unifiedTimeline.map((event) => <li key={event.id} className="rounded-xl border p-4"><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-semibold">{event.title}</p><time className="text-xs text-muted-foreground">{event.occurredAt.toLocaleString(english ? 'en-GB' : 'fr-FR')}</time></div><p className="mt-1 text-xs text-muted-foreground">{event.source} · {event.description}{event.linked && event.source === 'Google Ads' ? (english ? ' · linked to an internal action' : ' · rapproché d’une action interne') : ''}</p></li>)}</ol>}
        </CardContent></Card>
      </section>
    </>
  )
}

function HistoryMetric({ icon: Icon, label, value }: { icon: typeof Activity; label: string; value: string }) {
  return <Card className="border-[#dde4e7] shadow-none"><CardContent className="p-5"><div className="flex items-center justify-between"><div><p className="text-sm text-muted-foreground">{label}</p><p className="mt-2 text-2xl font-semibold">{value}</p></div><Icon className="size-5 text-[var(--brand-accent)]" /></div></CardContent></Card>
}

function ComparisonCard({ comparison, currency, locale }: { comparison: PerformanceComparison; currency: string; locale: 'fr' | 'en' }) {
  const english = locale === 'en'
  const change = (value: number | null) => value === null ? (english ? 'zero baseline' : 'base nulle') : formatPercent(value)
  return <div className="rounded-xl border bg-[#f8fafb] p-4">
    <div className="flex items-start justify-between gap-2"><h3 className="text-sm font-semibold">{comparison.label}</h3><Badge variant={comparison.available ? 'secondary' : 'outline'}>{comparison.available ? 'comparable' : (english ? 'incomplete' : 'incomplet')}</Badge></div>
    <p className="mt-2 text-xs text-muted-foreground">{english ? 'Coverage' : 'Couverture'} : {formatPercent(comparison.currentCoverage)} / {formatPercent(comparison.previousCoverage)}</p>
    <dl className="mt-4 grid grid-cols-2 gap-2 text-xs">
      <div><dt className="text-muted-foreground">{english ? 'Spend' : 'Dépense'}</dt><dd className="font-medium">{formatMoneyFromMicros(comparison.current.costMicros, currency)} · {change(comparison.changes.costMicros)}</dd></div>
      <div><dt className="text-muted-foreground">Conversions</dt><dd className="font-medium">{comparison.current.conversions.toLocaleString(english ? 'en-GB' : 'fr-FR', { maximumFractionDigits: 1 })} · {change(comparison.changes.conversions)}</dd></div>
      <div><dt className="text-muted-foreground">{english ? 'Clicks' : 'Clics'}</dt><dd className="font-medium">{formatInteger(comparison.current.clicks)} · {change(comparison.changes.clicks)}</dd></div>
      <div><dt className="text-muted-foreground">{english ? 'Value' : 'Valeur'}</dt><dd className="font-medium">{formatMoneyFromMicros(comparison.current.conversionValueMicros, currency)} · {change(comparison.changes.conversionValueMicros)}</dd></div>
    </dl>
  </div>
}
