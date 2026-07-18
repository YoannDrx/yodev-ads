import { Bot, Clock3, Gauge, Play, Plus, ShieldCheck } from 'lucide-react'
import { createMonitoringAgent, runMonitoringScan, toggleMonitoringAgent } from '@/app/actions'
import { FlashMessage } from '@/components/flash-message'
import { PageHeading } from '@/components/page-heading'
import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { listMonitoringAgents, listWorkspaceClients } from '@/lib/data'
import { agentTemplates } from '@/lib/monitoring'
import { requireWorkspace } from '@/lib/workspace'

export default async function AgentsPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; error?: string }>
}) {
  const query = await searchParams
  const { workspace, isAdmin } = await requireWorkspace()
  const [agents, clients] = await Promise.all([listMonitoringAgents(workspace.id), listWorkspaceClients(workspace.id)])
  return (
    <>
      <PageHeading
        eyebrow="Automatisation sûre"
        title="Vigies autonomes"
        description="Des agents spécialisés surveillent vos comptes chaque matin. Ils détectent et expliquent ; toute modification Google Ads reste soumise à approbation."
        actions={
          <form action={runMonitoringScan}>
            <Button type="submit">
              <Play className="mr-2 size-4" />
              Analyser maintenant
            </Button>
          </form>
        }
      />
      <FlashMessage notice={query.notice} error={query.error} />
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {agentTemplates.map((template) => (
          <Card key={template.kind} className="group overflow-hidden border-[#dde4e7] shadow-none">
            <div className="h-1.5 bg-gradient-to-r from-[#6af0b1] to-[#65b8ff]" />
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
                    aria-label="Périmètre"
                  >
                    <option value="all">Tous les comptes</option>
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
                      aria-label={`Seuil en ${template.unit}`}
                    />
                    <Button type="submit" size="sm" variant="outline">
                      <Plus className="mr-1 size-3.5" />
                      Activer
                    </Button>
                  </div>
                  <p className="text-[11px] text-muted-foreground">Seuil · {template.unit}</p>
                </form>
              )}
            </CardContent>
          </Card>
        ))}
      </section>

      <div className="mt-9 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Vigies installées</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {agents.length} configuration{agents.length > 1 ? 's' : ''} dans cet espace.
          </p>
        </div>
        <span className="flex items-center gap-2 text-xs text-emerald-700">
          <ShieldCheck className="size-4" /> Approbation obligatoire
        </span>
      </div>
      <div className="mt-4 space-y-3">
        {agents.map(({ agent, client }) => (
          <Card key={agent.id} className="border-[#dde4e7] shadow-none">
            <CardContent className="flex flex-col gap-4 p-5 md:flex-row md:items-center md:justify-between">
              <div className="flex min-w-0 gap-4">
                <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-[#111e2b] text-[#6af0b1]">
                  <Gauge className="size-5" />
                </span>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-semibold">{agent.name}</h3>
                    <StatusBadge status={agent.enabled ? 'active' : 'paused'} />
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {client?.name ?? 'Tous les comptes'} · seuil {Number(agent.threshold).toLocaleString('fr-FR')}
                  </p>
                  <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Clock3 className="size-3.5" />
                    {agent.lastRunAt
                      ? `Dernière analyse ${agent.lastRunAt.toLocaleString('fr-FR')}`
                      : 'Première analyse en attente'}
                  </p>
                </div>
              </div>
              {isAdmin && (
                <div className="flex gap-2">
                  <form action={runMonitoringScan}>
                    <input type="hidden" name="agentId" value={agent.id} />
                    <Button type="submit" size="sm" variant="outline">
                      Exécuter
                    </Button>
                  </form>
                  <form action={toggleMonitoringAgent}>
                    <input type="hidden" name="agentId" value={agent.id} />
                    <input type="hidden" name="enabled" value={String(!agent.enabled)} />
                    <Button type="submit" size="sm" variant="ghost">
                      {agent.enabled ? 'Mettre en pause' : 'Réactiver'}
                    </Button>
                  </form>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
        {agents.length === 0 && (
          <div className="rounded-3xl border border-dashed bg-white p-12 text-center text-muted-foreground">
            Activez une première vigie depuis le catalogue ci-dessus.
          </div>
        )}
      </div>
    </>
  )
}
