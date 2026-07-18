import { AlertTriangle, CheckCircle2, Play, Siren } from 'lucide-react'
import { resolveAlertIncident, runMonitoringScan } from '@/app/actions'
import { FlashMessage } from '@/components/flash-message'
import { PageHeading } from '@/components/page-heading'
import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { listAlertIncidents } from '@/lib/data'
import { requireWorkspace } from '@/lib/workspace'

export default async function AlertsPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; error?: string }>
}) {
  const query = await searchParams
  const { workspace } = await requireWorkspace()
  const incidents = await listAlertIncidents(workspace.id)
  const open = incidents.filter(({ incident }) => incident.status === 'open')
  return (
    <>
      <PageHeading
        eyebrow="Centre de vigilance"
        title="Alertes et anomalies"
        description="Une file de travail explicable, priorisée et reliée à la vigie qui a détecté chaque anomalie."
        actions={
          <form action={runMonitoringScan}>
            <Button type="submit" variant="outline">
              <Play className="mr-2 size-4" />
              Relancer l’analyse
            </Button>
          </form>
        }
      />
      <FlashMessage notice={query.notice} error={query.error} />
      <section className="mb-7 grid gap-4 sm:grid-cols-3">
        <Summary label="À traiter" value={open.length} icon={Siren} tone="critical" />
        <Summary
          label="Critiques"
          value={open.filter(({ incident }) => incident.severity === 'critical').length}
          icon={AlertTriangle}
          tone="warning"
        />
        <Summary
          label="Résolues"
          value={incidents.filter(({ incident }) => incident.status !== 'open').length}
          icon={CheckCircle2}
          tone="positive"
        />
      </section>
      <div className="space-y-3">
        {incidents.map(({ incident, client, agent }) => (
          <Card
            key={incident.id}
            className={`border-l-4 shadow-none ${incident.status === 'open' ? (incident.severity === 'critical' ? 'border-l-red-500' : 'border-l-amber-400') : 'border-l-emerald-400 opacity-70'}`}
          >
            <CardContent className="flex flex-col gap-4 p-5 lg:flex-row lg:items-center lg:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge status={incident.status} />
                  <span className="text-xs font-medium text-muted-foreground">{agent.name}</span>
                </div>
                <h2 className="mt-3 font-semibold tracking-tight">{incident.title}</h2>
                <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">{incident.description}</p>
                <p className="mt-2 text-xs text-muted-foreground">
                  {client.name}
                  {incident.campaignName ? ` · ${incident.campaignName}` : ''} · détectée le{' '}
                  {incident.detectedAt.toLocaleString('fr-FR')}
                </p>
              </div>
              {incident.status === 'open' && (
                <form action={resolveAlertIncident}>
                  <input type="hidden" name="incidentId" value={incident.id} />
                  <Button type="submit" size="sm" variant="outline">
                    <CheckCircle2 className="mr-2 size-4" />
                    Acquitter
                  </Button>
                </form>
              )}
            </CardContent>
          </Card>
        ))}
        {incidents.length === 0 && (
          <div className="rounded-3xl border border-dashed bg-white p-14 text-center">
            <CheckCircle2 className="mx-auto size-8 text-emerald-500" />
            <h2 className="mt-4 font-semibold">Aucune anomalie détectée</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Activez une vigie, puis lancez une analyse pour commencer la surveillance.
            </p>
          </div>
        )}
      </div>
    </>
  )
}

function Summary({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string
  value: number
  icon: typeof Siren
  tone: 'critical' | 'warning' | 'positive'
}) {
  const styles = {
    critical: 'bg-red-50 text-red-700',
    warning: 'bg-amber-50 text-amber-700',
    positive: 'bg-emerald-50 text-emerald-700',
  }
  return (
    <Card className="border-[#dde4e7] shadow-none">
      <CardContent className="flex items-center justify-between p-5">
        <div>
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="mt-2 text-3xl font-semibold tracking-tight">{value}</p>
        </div>
        <span className={`grid size-11 place-items-center rounded-2xl ${styles[tone]}`}>
          <Icon className="size-5" />
        </span>
      </CardContent>
    </Card>
  )
}
