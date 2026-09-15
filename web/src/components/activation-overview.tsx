import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { activationCohorts } from '@/lib/activation-analytics'
import { ACTIVATION_STAGES } from '@/lib/activation-stages'

type Props = {
  totalCommercial: number
  funnel: Record<string, number>
  cohorts: ReturnType<typeof activationCohorts>
}

function rate(value: number, total: number) { return total > 0 ? `${Math.round(value / total * 100)} %` : '—' }
function median(value: number | null) { return value === null ? 'non disponible' : `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(value)} j` }

export function ActivationOverview({ totalCommercial, funnel, cohorts }: Props) {
  return <>
    <Card className="mb-6 shadow-none">
      <CardHeader><CardTitle>Funnel d’activation commercial</CardTitle><p className="text-xs text-muted-foreground">Jalons atteints parmi les {totalCommercial} espaces commerciaux actuels, toutes dates d’inscription. Les espaces internes et supprimés sont exclus.</p></CardHeader>
      <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">{ACTIVATION_STAGES.map(({ milestone, label }) => {
        const value = Number(funnel[milestone] ?? 0)
        return <div key={milestone} className="rounded-md border p-4"><p className="text-xs text-muted-foreground">{label}</p><div className="mt-2 flex items-end justify-between"><span className="text-2xl font-semibold">{value}</span><Badge variant="outline">{rate(value, totalCommercial)}</Badge></div><progress aria-label={label} value={value} max={Math.max(1, totalCommercial)} className="mt-3 h-1.5 w-full accent-emerald-500" /></div>
      })}</CardContent>
    </Card>
    <Card className="mb-6 shadow-none">
      <CardHeader><CardTitle>Cohortes d’activation · 12 semaines</CardTitle>
        <p className="text-xs text-muted-foreground">Semaines d’inscription UTC, observées au {new Date(cohorts.asOf).toLocaleString('fr-FR', { timeZone: 'UTC' })} UTC. Chaque taux utilise tous les espaces de sa cohorte, indépendamment des autres jalons. Les semaines récentes ont moins de recul ; la semaine courante est incomplète.</p>
        <p className="text-xs text-muted-foreground">Une analyse qualifiée exige cinq sources récentes et vérifiées. Un rapport publié correspond à une édition disponible ; une planification ou une réception email non prouvée ne compte pas comme publication.</p>
      </CardHeader>
      <CardContent>
        <div role="region" aria-label="Cohortes d’activation par semaine" tabIndex={0} className="overflow-x-auto rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2">
          <table className="w-full min-w-[1200px] text-left text-sm">
            <caption className="sr-only">Espaces ayant atteint chaque jalon, par semaine d’inscription</caption>
            <thead><tr className="border-b text-xs text-muted-foreground"><th scope="col" className="py-2 pr-4 font-medium">Semaine UTC</th><th scope="col" className="px-3 py-2 text-right font-medium">Espaces inscrits</th>{ACTIVATION_STAGES.map(({ field, label }) => <th key={field} scope="col" className="px-3 py-2 text-right font-medium">{label}</th>)}</tr></thead>
            <tbody>{cohorts.cohorts.toReversed().map((cohort) => <tr key={cohort.weekStart} data-cohort={cohort.weekStart} className="border-b last:border-0"><th scope="row" className="whitespace-nowrap py-2.5 pr-4 font-medium">{cohort.weekStart}</th><td data-stage="workspaces" className="px-3 py-2.5 text-right">{cohort.workspaces}</td>{ACTIVATION_STAGES.map(({ field }) => <td key={field} data-stage={field} className="whitespace-nowrap px-3 py-2.5 text-right">{cohort[field]} <span className="text-xs text-muted-foreground">({rate(cohort[field], cohort.workspaces)})</span></td>)}</tr>)}</tbody>
          </table>
        </div>
        <p className="mb-3 mt-5 text-xs text-muted-foreground">Délai médian depuis l’inscription, uniquement parmi les espaces des 12 semaines ayant atteint le jalon. Les autres ne sont pas des conversions à zéro jour. Une absence de jalon ne suffit pas à conclure à un abandon.</p>
        <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{ACTIVATION_STAGES.map(({ field, label }) => <div key={field} className="rounded-md border p-3"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 text-sm font-medium">{median(cohorts.medianDaysByStage[field])}</dd></div>)}</dl>
      </CardContent>
    </Card>
  </>
}
