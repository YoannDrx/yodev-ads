import { featureEnabled } from '@/lib/feature-flags'
import { AlertTriangle, CheckCircle2, Clock3, Play, Siren, UserRoundCheck, Workflow } from 'lucide-react'
import { createWorkspaceTask, runMonitoringScan, updateAlertWorkflow } from '@/app/actions'
import { AlertQualityPanel, AlertQualitySummary } from '@/components/alert-quality-panel'
import { FlashMessage } from '@/components/flash-message'
import { PageHeading } from '@/components/page-heading'
import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { listAlertPage, COLLECTION_STATUSES } from '@/lib/workspace-collections'
import { CollectionControls, DiscussionLink } from '@/components/collection-controls'
import type { CollectionQuery } from '@/lib/collection-pagination'
import { workspacePermissions } from '@/lib/workspace-decision'
import { requireWorkspacePagePermission } from '@/lib/workspace'

export default async function AlertsPage({
  searchParams,
}: {
  searchParams: Promise<CollectionQuery & { notice?: string; error?: string }>
}) {
  const query = await searchParams
  const { workspace, role } = await requireWorkspacePagePermission('portfolio:read', '/alerts')
  const english = workspace.locale === 'en'
  const locale = english ? 'en' : 'fr'
  const canManageAlerts = workspacePermissions(role, workspace.accessState).has('alerts:manage')
  const canRun = workspacePermissions(role, workspace.accessState).has('monitoring:run') && featureEnabled('googleReads') && featureEnabled('scheduler')
  const canManageTasks = workspacePermissions(role, workspace.accessState).has('tasks:manage')
  const collection = await listAlertPage(workspace.id, query)
  const incidents = collection.items
  return (
    <>
      <PageHeading
        eyebrow={english ? 'Monitoring center' : 'Centre de vigilance'}
        title={english ? 'Alerts and anomalies' : 'Alertes et anomalies'}
        description={english ? 'An explainable, prioritized work queue linked to the monitor that detected each anomaly.' : 'Une file de travail explicable, priorisée et reliée à la vigie qui a détecté chaque anomalie.'}
        actions={canRun ?
          <form action={runMonitoringScan}>
            <Button type="submit" variant="outline">
              <Play className="mr-2 size-4" />
              {english ? 'Run analysis again' : 'Relancer l’analyse'}
            </Button>
          </form> : undefined
        }
      />
      <FlashMessage notice={query.notice} error={query.error} locale={locale} />
      <section className="mb-7 grid gap-4 sm:grid-cols-3">
        <Summary label={english ? 'Open' : 'À traiter'} value={collection.summary.open} icon={Siren} tone="critical" />
        <Summary
          label={english ? 'Critical' : 'Critiques'}
          value={collection.summary.critical}
          icon={AlertTriangle}
          tone="warning"
        />
        <Summary
          label={english ? 'Resolved' : 'Résolues'}
          value={collection.summary.resolved}
          icon={CheckCircle2}
          tone="positive"
        />
      </section>
      {!collection.invalidCursor && <AlertQualitySummary counts={collection.summary} total={collection.total} english={english} />}
      <CollectionControls path="/alerts" query={query} page={collection} locale={locale} statuses={COLLECTION_STATUSES.alerts} />
      <div className="space-y-3">
        {incidents.map(({ incident, client, agent }) => (
          <Card
            key={incident.id}
            className={`border-l-4 shadow-none ${['open', 'reopened'].includes(incident.status) ? (incident.severity === 'critical' ? 'border-l-red-500' : 'border-l-amber-400') : 'border-l-emerald-400 opacity-70'}`}
          >
            <CardContent className="flex flex-col gap-4 p-5 lg:flex-row lg:flex-wrap lg:items-center lg:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge status={incident.status} locale={locale} />
                  <span className="text-xs font-medium text-muted-foreground">{agent.name}</span>
                </div>
                <h2 className="mt-3 font-semibold tracking-tight">{incident.title}</h2>
                <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">{incident.description}</p>
                <p className="mt-2 text-xs text-muted-foreground">
                  {client.name}
                  {incident.campaignName ? ` · ${incident.campaignName}` : ''} · {english ? 'detected on' : 'détectée le'}{' '}
                  {incident.detectedAt.toLocaleString(english ? 'en-GB' : 'fr-FR')}
                </p>
                {(incident.assignedTo || incident.dueAt) && (
                  <div className="mt-3 flex flex-wrap gap-2 text-xs">
                    {incident.assignedTo && <span className="inline-flex items-center gap-1 rounded-md bg-blue-50 px-2.5 py-1 font-medium text-blue-700"><UserRoundCheck className="size-3" />{english ? 'Assigned' : 'Assignée'}</span>}
                    {incident.dueAt && <span className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 font-medium ${incident.dueAt < new Date() && incident.status !== 'resolved' ? 'y-status-danger text-[var(--y-danger)]' : 'bg-muted text-muted-foreground'}`}><Clock3 className="size-3" />{english ? 'Due' : 'Échéance'} {incident.dueAt.toLocaleDateString(english ? 'en-GB' : 'fr-FR')}</span>}
                  </div>
                )}
              </div>
              <DiscussionLink kind="alerts" id={incident.id} locale={locale} />
              {canManageAlerts && incident.status !== 'resolved' && (
                <form action={updateAlertWorkflow} className="grid min-w-64 gap-2">
                  <input type="hidden" name="incidentId" value={incident.id} />
                  <select name="operation" aria-label={english ? 'Alert action' : 'Action sur l’alerte'} className="h-9 rounded-lg border bg-card px-3 text-xs"><option value="acknowledge">{english ? 'Acknowledge' : 'Acquitter'}</option><option value="assign_self">{english ? 'Assign to me' : 'Me l’assigner'}</option>{incident.assignedTo && <option value="unassign">{english ? 'Remove assignment' : 'Retirer l’assignation'}</option>}<option value="snooze_24h">{english ? 'Snooze for 24h' : 'Masquer 24 h'}</option><option value="resolve">{english ? 'Resolve' : 'Résoudre'}</option></select>
                  <input name="dueDate" type="date" aria-label={english ? 'Due date' : 'Échéance'} defaultValue={incident.dueAt?.toISOString().slice(0, 10)} className="h-9 rounded-lg border px-3 text-xs" />
                  <input name="comment" aria-label={english ? 'Comment' : 'Commentaire'} maxLength={2000} placeholder={english ? 'Optional comment' : 'Commentaire facultatif'} className="h-9 rounded-lg border px-3 text-xs" />
                  <Button type="submit" size="sm" variant="outline"><CheckCircle2 className="mr-2 size-4" />{english ? 'Update' : 'Mettre à jour'}</Button>
                </form>
              )}
              {canManageAlerts && incident.status === 'resolved' && <form action={updateAlertWorkflow}><input type="hidden" name="incidentId" value={incident.id} /><input type="hidden" name="operation" value="reopen" /><Button type="submit" size="sm" variant="outline">{english ? 'Reopen' : 'Rouvrir'}</Button></form>}
              {canManageTasks && <form action={createWorkspaceTask} className="grid shrink-0 gap-2"><input type="hidden" name="sourceType" value="alert" /><input type="hidden" name="sourceEntityId" value={incident.id} /><input type="hidden" name="returnTo" value="alerts" /><input type="hidden" name="priority" value={incident.severity === 'critical' ? 'urgent' : 'high'} /><input type="hidden" name="slaHours" value={incident.severity === 'critical' ? '4' : '24'} /><input type="hidden" name="assignSelf" value="true" /><Button type="submit" size="sm" variant="outline"><Workflow className="mr-2 size-4" />{english ? 'Create task' : 'Créer une tâche'}</Button></form>}
              <AlertQualityPanel incident={incident} english={english} canManage={canManageAlerts} />
            </CardContent>
          </Card>
        ))}
        {!collection.invalidCursor && incidents.length === 0 && (
          <div className="rounded-md border border-dashed bg-card p-14 text-center">
            <CheckCircle2 className="mx-auto size-8 text-[var(--y-success)]" />
            <h2 className="mt-4 font-semibold">{english ? 'No matching alert' : 'Aucune alerte correspondante'}</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {english ? 'Enable a monitor, then run an analysis to begin monitoring.' : 'Activez une vigie, puis lancez une analyse pour commencer la surveillance.'}
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
    critical: 'y-status-danger text-[var(--y-danger)]',
    warning: 'y-status-warning text-[var(--y-warning)]',
    positive: 'y-status-success text-[var(--y-success)]',
  }
  return (
    <Card className="border-border shadow-none">
      <CardContent className="flex items-center justify-between p-5">
        <div>
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="mt-2 text-3xl font-semibold tracking-tight">{value}</p>
        </div>
        <span className={`grid size-11 place-items-center rounded-md ${styles[tone]}`}>
          <Icon className="size-5" />
        </span>
      </CardContent>
    </Card>
  )
}
