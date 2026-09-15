import { reviewWorkspaceAlertQuality } from '@/app/actions'
import { Button } from '@/components/ui/button'
import type { alertIncidents } from '@/db/schema'
import { ALERT_QUALITY_LABELS, alertQualityLabel, alertQualityState } from '@/lib/alert-quality-model'

type QualityIncident = Pick<typeof alertIncidents.$inferSelect, 'id' | 'qualityLabel' | 'qualityVersion' | 'qualityOccurrence' | 'qualityReviewedAt' | 'occurrenceCount'>

export function AlertQualitySummary({ counts, total, english }: { counts: { useful: number; noise: number; falsePositive: number; staleReviews: number; unreviewed: number }; total: number; english: boolean }) {
  const reviewed = counts.useful + counts.noise + counts.falsePositive
  const usefulRate = reviewed ? `${Math.round(counts.useful / reviewed * 100)} %` : '—'
  return <section aria-label={english ? 'Alert quality summary' : 'Synthèse de qualité des alertes'} className="mb-5 rounded-md border bg-card p-4">
    <h2 className="text-sm font-semibold">{english ? 'Alert quality' : 'Qualité des alertes'} · {total} {english ? 'matching alerts' : 'alertes correspondantes'}</h2>
    <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-3">{[
      [english ? 'Useful' : 'Utiles', counts.useful], [english ? 'Noise' : 'Bruit', counts.noise], [english ? 'False positives' : 'Faux positifs', counts.falsePositive],
      [english ? 'Older reviews' : 'Avis anciens', counts.staleReviews], [english ? 'Not reviewed' : 'Non évaluées', counts.unreviewed],
    ].map(([label, value]) => <div key={label}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="text-lg font-medium">{value}</dd></div>)}</dl>
    <p className="mt-3 text-xs text-muted-foreground">{english ? `Useful among ${reviewed} reviews of the current observation: ${usefulRate}. Older and unreviewed observations are excluded from this rate. This summary covers all matching alerts across pages.` : `Utiles parmi les ${reviewed} avis portant sur l’observation actuelle : ${usefulRate}. Les observations anciennes et non évaluées sont exclues de ce taux. La synthèse porte sur toutes les alertes correspondant aux filtres, au-delà de la page affichée.`}</p>
  </section>
}

export function AlertQualityPanel({ incident, english, canManage }: { incident: QualityIncident; english: boolean; canManage: boolean }) {
  const state = alertQualityState(incident)
  return <section aria-label={english ? 'Alert quality review' : 'Qualité de l’alerte'} data-alert-quality-state={state} className="w-full border-t pt-4">
    <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-medium">{english ? 'Quality' : 'Pertinence'} : {alertQualityLabel(incident.qualityLabel, english)}</p>{incident.qualityReviewedAt && <p className="text-xs text-muted-foreground">{english ? 'Reviewed on' : 'Avis du'} {incident.qualityReviewedAt.toLocaleDateString(english ? 'en-GB' : 'fr-FR')}</p>}</div>
    {state === 'stale' && <p className="mt-2 text-sm text-[var(--y-warning)]">{english ? `The review covers observation ${incident.qualityOccurrence}. A new observation needs review.` : `L’avis porte sur l’observation ${incident.qualityOccurrence}. Une nouvelle observation reste à évaluer.`}</p>}
    <details className="mt-2 text-xs text-muted-foreground"><summary className="cursor-pointer">{english ? 'How to classify this alert' : 'Comment qualifier cette alerte'}</summary><p className="mt-2 leading-5">{english ? 'Useful: a relevant signal for a decision or action. Noise: a real signal that is redundant or not actionable here. False positive: the reported anomaly is incorrect after verification. Reviewing never resolves the alert or changes its monitor; the review applies to the displayed observation.' : 'Utile : signal pertinent pour une décision ou une action. Bruit : signal réel mais redondant ou sans action utile ici. Faux positif : anomalie signalée incorrecte après vérification. Cet avis ne résout pas l’alerte et ne modifie pas la vigie ; il porte sur l’observation affichée.'}</p></details>
    {canManage && <form action={reviewWorkspaceAlertQuality} className="mt-3 flex flex-wrap items-end gap-2">
      <input type="hidden" name="incidentId" value={incident.id} /><input type="hidden" name="expectedOccurrence" value={incident.occurrenceCount} /><input type="hidden" name="expectedVersion" value={incident.qualityVersion} />
      <label className="grid gap-1 text-xs" htmlFor={`quality-${incident.id}`}>{english ? 'Your assessment' : 'Votre évaluation'}<select id={`quality-${incident.id}`} name="label" defaultValue={incident.qualityLabel ?? 'unreviewed'} className="h-9 min-w-44 rounded-lg border bg-card px-3 text-sm"><option value="unreviewed">{alertQualityLabel(null, english)}</option>{ALERT_QUALITY_LABELS.map((label) => <option key={label} value={label}>{alertQualityLabel(label, english)}</option>)}</select></label>
      <Button type="submit" size="sm" variant="outline">{english ? 'Save assessment' : 'Enregistrer l’avis'}</Button>
    </form>}
  </section>
}
