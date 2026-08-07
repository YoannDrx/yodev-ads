import Link from 'next/link'
import { Activity, ArrowDownUp, BellRing, Gauge, MousePointerClick, ReceiptText, Target } from 'lucide-react'
import { requestGoogleAdsChange } from '@/app/actions'
import { EmptyState } from '@/components/empty-state'
import { FlashMessage } from '@/components/flash-message'
import { PageHeading } from '@/components/page-heading'
import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { getWorkspaceClient, getWorkspaceConnection, listAlertIncidents, listWorkspaceClients } from '@/lib/data'
import { formatInteger, formatMoneyFromMicros, formatPercent } from '@/lib/format'
import { GoogleAdsGateway, type CampaignPerformance } from '@/lib/google-ads'
import { requireWorkspace } from '@/lib/workspace'

type DashboardProps = { searchParams: Promise<{ client?: string; notice?: string; error?: string }> }

export default async function DashboardPage({ searchParams }: DashboardProps) {
  const query = await searchParams
  const { workspace } = await requireWorkspace()
  const [connection, workspaceClients, alertRows] = await Promise.all([
    getWorkspaceConnection(workspace.id),
    listWorkspaceClients(workspace.id),
    listAlertIncidents(workspace.id),
  ])
  const client = await getWorkspaceClient(workspace.id, query.client)
  let campaigns: CampaignPerformance[] = []
  let apiError: string | undefined
  if (connection && client) {
    try {
      campaigns = await new GoogleAdsGateway(connection).campaignPerformance(client.googleCustomerId)
    } catch (error) {
      apiError = error instanceof Error ? error.message : 'Impossible de charger les campagnes.'
    }
  }

  const totals = campaigns.reduce(
    (sum, campaign) => ({
      cost: sum.cost + Number(campaign.costMicros),
      clicks: sum.clicks + Number(campaign.clicks),
      impressions: sum.impressions + Number(campaign.impressions),
      conversions: sum.conversions + campaign.conversions,
    }),
    { cost: 0, clicks: 0, impressions: 0, conversions: 0 },
  )
  const currency = client?.currencyCode ?? 'EUR'
  const openAlerts = alertRows.filter(({ incident }) => incident.status === 'open')
  const healthPenalty = campaigns.reduce(
    (penalty, campaign) => {
      if (campaign.status === 'ENABLED' && Number(campaign.impressions) === 0) return penalty + 20
      if (Number(campaign.costMicros) > 100_000_000 && campaign.conversions === 0) return penalty + 12
      return penalty
    },
    openAlerts.filter(({ incident }) => incident.severity === 'critical').length * 8,
  )
  const healthScore = Math.max(0, Math.min(100, 100 - healthPenalty))

  return (
    <>
      <PageHeading
        eyebrow="Vue 30 jours"
        title="Cockpit de performance"
        description="Gardez le cap sur vos campagnes et préparez les changements sensibles sans quitter votre vigie."
        actions={
          workspaceClients.length > 0 ? (
            <form className="flex gap-2">
              <select
                name="client"
                defaultValue={client?.id}
                className="h-10 min-w-60 rounded-lg border bg-white px-3 text-sm"
                aria-label="Compte client"
              >
                {workspaceClients
                  .filter((item) => !item.isManager)
                  .map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
              </select>
              <Button type="submit" variant="outline">
                Afficher
              </Button>
            </form>
          ) : undefined
        }
      />
      <FlashMessage notice={query.notice} error={query.error ?? apiError} />
      {!connection || !client ? (
        <EmptyState
          title={connection ? 'Synchronisez vos comptes clients' : undefined}
          description={
            connection
              ? 'La connexion est active. Lancez une synchronisation depuis les réglages pour importer les comptes du MCC.'
              : undefined
          }
        />
      ) : (
        <>
          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard
              label="Investissement"
              value={formatMoneyFromMicros(totals.cost, currency)}
              icon={ReceiptText}
              note="30 derniers jours"
            />
            <MetricCard
              label="Conversions"
              value={formatInteger(totals.conversions)}
              icon={Target}
              note={
                totals.conversions
                  ? `${formatMoneyFromMicros(totals.cost / totals.conversions, currency)} / conv.`
                  : 'Aucune conversion'
              }
            />
            <MetricCard
              label="Clics"
              value={formatInteger(totals.clicks)}
              icon={MousePointerClick}
              note={
                totals.impressions ? `${formatPercent(totals.clicks / totals.impressions)} de CTR` : 'CTR indisponible'
              }
            />
            <MetricCard
              label="Campagnes"
              value={formatInteger(campaigns.length)}
              icon={Activity}
              note={`${campaigns.filter((item) => item.status === 'ENABLED').length} actives`}
            />
          </section>

          <section className="mt-6 grid gap-4 lg:grid-cols-[1.3fr_.7fr]">
            <Card className="overflow-hidden border-[#dce5e7] bg-[#0d1722] text-white shadow-none">
              <CardContent className="flex flex-col gap-6 p-6 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[.16em] text-[#19A58F]">Score de vigilance</p>
                  <p className="mt-3 text-4xl font-semibold tracking-tight">
                    {healthScore}
                    <span className="text-lg text-white/35"> / 100</span>
                  </p>
                  <p className="mt-2 max-w-md text-sm leading-6 text-white/55">
                    Synthèse calculée à partir de la diffusion, des dépenses sans conversion et des incidents ouverts.
                  </p>
                </div>
                <div className="relative grid size-28 shrink-0 place-items-center rounded-full border-[10px] border-white/8">
                  <Gauge className="size-9 text-[#19A58F]" />
                  <span className="absolute inset-[-10px] rounded-full border-[10px] border-[#19A58F] border-l-transparent border-b-transparent" />
                </div>
              </CardContent>
            </Card>
            <Card className="border-[#dce5e7] shadow-none">
              <CardContent className="p-6">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">Incidents ouverts</p>
                    <p className="mt-2 text-4xl font-semibold tracking-tight">{openAlerts.length}</p>
                  </div>
                  <span className="grid size-11 place-items-center rounded-2xl bg-amber-50 text-amber-700">
                    <BellRing className="size-5" />
                  </span>
                </div>
                <Button asChild variant="outline" className="mt-6 w-full">
                  <Link href="/alerts">Ouvrir le centre d’alertes</Link>
                </Button>
              </CardContent>
            </Card>
          </section>

          <Card className="mt-6 overflow-hidden border-[#e8e5ef] shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between border-b bg-white">
              <div>
                <CardTitle>Campagnes · {client.name}</CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">
                  Les demandes sont validées par Google avant d’entrer en approbation.
                </p>
              </div>
              <ArrowDownUp className="size-5 text-muted-foreground" />
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-[#faf9fc] text-left text-xs uppercase tracking-wider text-muted-foreground">
                    <tr>
                      <th className="px-5 py-3">Campagne</th>
                      <th className="px-4 py-3">Statut</th>
                      <th className="px-4 py-3 text-right">Budget/j</th>
                      <th className="px-4 py-3 text-right">Coût</th>
                      <th className="px-4 py-3 text-right">Clics</th>
                      <th className="px-4 py-3 text-right">Conv.</th>
                      <th className="px-5 py-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {campaigns.map((campaign) => (
                      <tr key={campaign.id} className="bg-white align-top hover:bg-[#fcfbff]">
                        <td className="px-5 py-4">
                          <p className="max-w-sm font-medium">{campaign.name}</p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {campaign.channelType} · {campaign.id}
                          </p>
                        </td>
                        <td className="px-4 py-4">
                          <StatusBadge status={campaign.status} />
                        </td>
                        <td className="px-4 py-4 text-right font-medium">
                          {formatMoneyFromMicros(campaign.budgetMicros, currency)}
                        </td>
                        <td className="px-4 py-4 text-right">{formatMoneyFromMicros(campaign.costMicros, currency)}</td>
                        <td className="px-4 py-4 text-right">{formatInteger(campaign.clicks)}</td>
                        <td className="px-4 py-4 text-right">
                          {campaign.conversions.toLocaleString('fr-FR', { maximumFractionDigits: 1 })}
                        </td>
                        <td className="px-5 py-4 text-right">
                          <details className="relative inline-block text-left">
                            <summary className="cursor-pointer list-none rounded-lg border px-3 py-2 text-xs font-medium hover:bg-muted">
                              Préparer
                            </summary>
                            <div className="absolute right-0 z-10 mt-2 w-72 rounded-2xl border bg-white p-4 text-left shadow-xl">
                              <form action={requestGoogleAdsChange} className="space-y-3">
                                <input type="hidden" name="kind" value="campaign_status" />
                                <input type="hidden" name="clientId" value={client.id} />
                                <input type="hidden" name="campaignId" value={campaign.id} />
                                <input type="hidden" name="campaignName" value={campaign.name} />
                                <input
                                  type="hidden"
                                  name="status"
                                  value={campaign.status === 'ENABLED' ? 'PAUSED' : 'ENABLED'}
                                />
                                <p className="text-sm font-medium">
                                  {campaign.status === 'ENABLED' ? 'Suspendre' : 'Activer'} cette campagne
                                </p>
                                <Button type="submit" variant="outline" size="sm" className="w-full">
                                  Valider puis demander
                                </Button>
                              </form>
                              <div className="my-4 border-t" />
                              <form action={requestGoogleAdsChange} className="space-y-3">
                                <input type="hidden" name="kind" value="campaign_budget" />
                                <input type="hidden" name="clientId" value={client.id} />
                                <input type="hidden" name="campaignId" value={campaign.id} />
                                <input type="hidden" name="campaignName" value={campaign.name} />
                                <input type="hidden" name="budgetResourceName" value={campaign.budgetResourceName} />
                                <label className="text-sm font-medium" htmlFor={`budget-${campaign.id}`}>
                                  Nouveau budget quotidien
                                </label>
                                <div className="flex gap-2">
                                  <Input
                                    id={`budget-${campaign.id}`}
                                    name="dailyBudget"
                                    type="number"
                                    min="0.01"
                                    step="0.01"
                                    defaultValue={(Number(campaign.budgetMicros) / 1_000_000).toFixed(2)}
                                    required
                                  />
                                  <Button type="submit" size="sm">
                                    Demander
                                  </Button>
                                </div>
                              </form>
                            </div>
                          </details>
                        </td>
                      </tr>
                    ))}
                    {campaigns.length === 0 && (
                      <tr>
                        <td colSpan={7} className="px-5 py-14 text-center text-muted-foreground">
                          Aucune campagne avec activité sur les 30 derniers jours.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </>
  )
}

function MetricCard({
  label,
  value,
  note,
  icon: Icon,
}: {
  label: string
  value: string
  note: string
  icon: typeof Activity
}) {
  return (
    <Card className="border-[#e8e5ef] bg-white shadow-sm">
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm text-muted-foreground">{label}</p>
            <p className="mt-2 text-2xl font-semibold tracking-tight">{value}</p>
          </div>
          <span className="grid size-10 place-items-center rounded-xl bg-[#f2effd] text-[var(--brand-accent)]">
            <Icon className="size-5" />
          </span>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">{note}</p>
      </CardContent>
    </Card>
  )
}
