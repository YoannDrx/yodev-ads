import Link from 'next/link'
import { refreshAnalyticalData } from '@/app/analytical-actions'
import { Button } from '@/components/ui/button'
import { ANALYTICAL_FAMILIES, analyticalFamilies, analyticalSnapshotState, type AnalyticalAttempt, type AnalyticalSnapshot } from '@/lib/analytical-model'
import { googleCoverageLabel, googleCoverageState } from '@/lib/google-collection-coverage'

export function CollectionStatus({ client, snapshots, attempts, locale, canRefresh, canConnect, destination, feedback }: {
  client: { id: string; timezone: string; currencyCode: string }; snapshots: AnalyticalSnapshot[]; attempts: AnalyticalAttempt[];
  locale: 'fr' | 'en'; canRefresh: boolean; canConnect: boolean; destination: '/dashboard' | '/analysis' | '/insights'; feedback?: string;
}) {
  const english = locale === 'en'
  const pending = attempts.filter((attempt) => ['queued', 'running', 'retrying'].includes(attempt.status)).length
  const failed = attempts.filter((attempt) => ['dead_letter', 'failed'].includes(attempt.status)).length
  const available = snapshots.filter((row) => analyticalSnapshotState(row, client) === 'available').length
  const formatDate = (date: Date) => date.toLocaleString(english ? 'en-GB' : 'fr-FR', { timeZone: client.timezone })
  const notices: Record<string, string> = {
    queued: english ? 'Collection queued. Reload after processing to see the results.' : 'Collecte planifiée. Rechargez après son traitement pour consulter les résultats.',
    pending: english ? 'A collection is already pending.' : 'Une collecte est déjà en cours ou planifiée.',
    recent: english ? 'A refresh was requested recently. Please wait 15 minutes between collections.' : 'Une actualisation a été demandée récemment. Patientez 15 minutes entre deux collectes.',
    unavailable: english ? 'Collection unavailable. Check the connection and your access in settings.' : 'Collecte indisponible. Vérifiez la connexion et vos accès dans les réglages.',
  }
  return <section aria-label={english ? 'Data synchronization' : 'Synchronisation des données'} className="mb-6 rounded-xl border bg-white p-5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="font-semibold">{english ? 'Stored Google Ads data' : 'Données Google Ads enregistrées'}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{available}/{analyticalFamilies.length} {english ? 'up-to-date sections' : 'sections à jour'} · {pending} {english ? 'pending' : 'en attente'} · {failed} {english ? 'failed' : 'en échec'} · {client.timezone}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {canRefresh && <form action={refreshAnalyticalData}><input type="hidden" name="clientId" value={client.id} /><input type="hidden" name="destination" value={destination} /><Button type="submit" variant="outline" disabled={pending > 0}>{english ? 'Refresh data' : 'Actualiser les données'}</Button></form>}
        {canConnect && <Button asChild variant="ghost"><Link href="/settings">{english ? 'Connection' : 'Connexion'}</Link></Button>}
      </div>
    </div>
    {feedback && notices[feedback] && <p role="status" className="mt-3 text-sm">{notices[feedback]}</p>}
    <p className="mt-3 text-xs text-muted-foreground">{english ? 'Each section keeps its last successful collection. Older data remains dated; lists may be limited by Google reporting thresholds and collection limits.' : 'Chaque section conserve sa dernière collecte réussie. Les données anciennes restent datées ; les listes peuvent être limitées par les seuils des rapports Google et les plafonds de collecte.'}</p>
    <details className="mt-3"><summary className="cursor-pointer text-sm font-medium">{english ? 'Collection details' : 'Détail des collectes'}</summary>
      <ul className="mt-3 divide-y text-xs">{analyticalFamilies.map((family) => {
        const row = snapshots.find((item) => item.family === family)
        const attempt = attempts.find((item) => item.family === family)
        const state = analyticalSnapshotState(row, client)
        const label = state === 'available' ? (english ? 'Up to date' : 'À jour') : state === 'stale' ? (english ? 'Older data' : 'Données anciennes') : (english ? 'Not collected' : 'Non disponible')
        return <li key={family} className="flex flex-wrap justify-between gap-2 py-2"><span className="font-medium">{ANALYTICAL_FAMILIES[family][locale]} · {label}</span><span>
          {row && state !== 'unavailable' && <>{row.periodFrom} → {row.periodThrough} · {formatDate(row.collectedAt)}<span className={googleCoverageState(row.coverage) === 'limited' ? 'ml-2 font-medium text-amber-800' : 'ml-2'}>{googleCoverageLabel(row.coverage, locale)}</span></>}
          {attempt && <span className="ml-2">{attempt.startedAt ? (english ? 'Last attempt' : 'Dernière tentative') : (english ? 'Requested' : 'Demandée')} : {formatDate(attempt.startedAt ?? attempt.createdAt)}{['queued', 'retrying'].includes(attempt.status) ? ` · ${english ? 'Scheduled after' : 'Planifiée après'} ${formatDate(attempt.availableAt)}` : ['dead_letter', 'failed'].includes(attempt.status) ? ` · ${english ? 'Collection failed; previous data preserved' : 'Collecte échouée ; données précédentes conservées'}` : ''}</span>}
        </span></li>
      })}</ul>
    </details>
  </section>
}
