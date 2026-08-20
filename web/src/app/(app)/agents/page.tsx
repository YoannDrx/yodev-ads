import { Bot, Clock3, Gauge, Play, Plus, ShieldCheck } from 'lucide-react'
import { createMonitoringAgent, runMonitoringScan, toggleMonitoringAgent } from '@/app/actions'
import { FlashMessage } from '@/components/flash-message'
import { PageHeading } from '@/components/page-heading'
import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { listMonitoringAgents, listWorkspaceClients } from '@/lib/data'
import { agentTemplatesForLocale } from '@/lib/monitoring'
import { requireWorkspacePermission } from '@/lib/workspace'

export default async function AgentsPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; error?: string }>
}) {
  const query = await searchParams
  const { workspace, isAdmin } = await requireWorkspacePermission('portfolio:read')
  const english = workspace.locale === 'en'
  const locale = english ? 'en' : 'fr'
  const agentTemplates = agentTemplatesForLocale(locale)
  const [agents, clients] = await Promise.all([listMonitoringAgents(workspace.id), listWorkspaceClients(workspace.id)])
  return (
    <>
      <PageHeading
        eyebrow={english ? 'Safe automation' : 'Automatisation sûre'}
        title={english ? 'Autonomous monitors' : 'Vigies autonomes'}
        description={english ? 'Specialized agents monitor your accounts every morning. They detect and explain; every Google Ads change still requires approval.' : 'Des agents spécialisés surveillent vos comptes chaque matin. Ils détectent et expliquent ; toute modification Google Ads reste soumise à approbation.'}
        actions={
          <form action={runMonitoringScan}>
            <Button type="submit">
              <Play className="mr-2 size-4" />
              {english ? 'Analyze now' : 'Analyser maintenant'}
            </Button>
          </form>
        }
      />
      <FlashMessage notice={query.notice} error={query.error} locale={locale} />
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {agentTemplates.map((template) => (
          <Card key={template.kind} className="group overflow-hidden border-[#dde4e7] shadow-none">
            <div className="h-1.5 bg-gradient-to-r from-[#19A58F] to-[#315EFB]" />
            <CardContent className="p-5">
              <span className="grid size-10 place-items-center rounded-xl bg-[#e9fbf3] text-[#176646]">
                <Bot className="size-5" />
              </span>
              <h2 className="mt-5 font-semibold tracking-tight">{template.name}</h2>
              <p className="mt-2 min-h-16 text-sm leading-6 text-muted-foreground">{template.description}</p>
              {isAdmin && (
                <form action={createMonitoringAgent} className="mt-5 space-y-3 border-t pt-4">
                  <input type="hidden" name="kind" value={template.kind} />
                  <select
                    name="clientId"
                    className="h-9 w-full rounded-lg border bg-white px-2 text-xs"
                    aria-label={english ? 'Scope' : 'Périmètre'}
                  >
                    <option value="all">{english ? 'All accounts' : 'Tous les comptes'}</option>
                    {clients
                      .filter((client) => !client.isManager)
                      .map((client) => (
                        <option key={client.id} value={client.id}>
                          {client.name}
                        </option>
                      ))}
                  </select>
                  <div className="flex gap-2">
                    <Input
                      name="threshold"
                      type="number"
                      min="0"
                      step="0.01"
                      defaultValue={template.threshold}
                      className="h-9"
                      aria-label={`${english ? 'Threshold in' : 'Seuil en'} ${template.unit}`}
                    />
                    <Button type="submit" size="sm" variant="outline">
                      <Plus className="mr-1 size-3.5" />
                      {english ? 'Enable' : 'Activer'}
                    </Button>
                  </div>
                  <select name="reminderIntervalHours" defaultValue="" className="h-9 w-full rounded-lg border bg-white px-2 text-xs" aria-label={english ? 'Unresolved alert reminders' : 'Rappel des alertes non traitées'}>
                    <option value="">{english ? 'No reminder' : 'Aucun rappel'}</option>
                    <option value="4">{english ? 'Every 4 hours' : 'Rappel toutes les 4 h'}</option>
                    <option value="12">{english ? 'Every 12 hours' : 'Rappel toutes les 12 h'}</option>
                    <option value="24">{english ? 'Every day' : 'Rappel chaque jour'}</option>
                    <option value="168">{english ? 'Every week' : 'Rappel chaque semaine'}</option>
                  </select>
                  <p className="text-[11px] text-muted-foreground">{english ? 'Threshold' : 'Seuil'} · {template.unit}</p>
                </form>
              )}
            </CardContent>
          </Card>
        ))}
      </section>

      <div className="mt-9 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">{english ? 'Installed monitors' : 'Vigies installées'}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {english ? `${agents.length} configuration${agents.length === 1 ? '' : 's'} in this workspace.` : `${agents.length} configuration${agents.length > 1 ? 's' : ''} dans cet espace.`}
          </p>
        </div>
        <span className="flex items-center gap-2 text-xs text-emerald-700">
          <ShieldCheck className="size-4" /> {english ? 'Approval required' : 'Approbation obligatoire'}
        </span>
      </div>
      <div className="mt-4 space-y-3">
        {agents.map(({ agent, client }) => (
          <Card key={agent.id} className="border-[#dde4e7] shadow-none">
            <CardContent className="flex flex-col gap-4 p-5 md:flex-row md:items-center md:justify-between">
              <div className="flex min-w-0 gap-4">
                <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-[#111e2b] text-[#19A58F]">
                  <Gauge className="size-5" />
                </span>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-semibold">{agent.name}</h3>
                    <StatusBadge status={agent.enabled ? 'active' : 'paused'} locale={locale} />
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {client?.name ?? (english ? 'All accounts' : 'Tous les comptes')} · {english ? 'threshold' : 'seuil'} {Number(agent.threshold).toLocaleString(english ? 'en-GB' : 'fr-FR')}
                    {agent.reminderIntervalHours ? ` · ${english ? 'reminder' : 'rappel'} ${agent.reminderIntervalHours < 24 ? `${agent.reminderIntervalHours} h` : `${agent.reminderIntervalHours / 24} ${english ? 'd' : 'j'}`}` : english ? ' · no reminder' : ' · sans rappel'}
                  </p>
                  <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Clock3 className="size-3.5" />
                    {agent.lastRunAt
                      ? `${english ? 'Last analysis' : 'Dernière analyse'} ${agent.lastRunAt.toLocaleString(english ? 'en-GB' : 'fr-FR')}`
                      : english ? 'First analysis pending' : 'Première analyse en attente'}
                  </p>
                </div>
              </div>
              {isAdmin && (
                <div className="flex gap-2">
                  <form action={runMonitoringScan}>
                    <input type="hidden" name="agentId" value={agent.id} />
                    <Button type="submit" size="sm" variant="outline">
                      {english ? 'Run' : 'Exécuter'}
                    </Button>
                  </form>
                  <form action={toggleMonitoringAgent}>
                    <input type="hidden" name="agentId" value={agent.id} />
                    <input type="hidden" name="enabled" value={String(!agent.enabled)} />
                    <Button type="submit" size="sm" variant="ghost">
                      {agent.enabled ? english ? 'Pause' : 'Mettre en pause' : english ? 'Reactivate' : 'Réactiver'}
                    </Button>
                  </form>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
        {agents.length === 0 && (
          <div className="rounded-3xl border border-dashed bg-white p-12 text-center text-muted-foreground">
            {english ? 'Enable your first monitor from the catalog above.' : 'Activez une première vigie depuis le catalogue ci-dessus.'}
          </div>
        )}
      </div>
    </>
  )
}
