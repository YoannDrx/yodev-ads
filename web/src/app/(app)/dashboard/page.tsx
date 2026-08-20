import Link from 'next/link'
import { Activity, ArrowDownUp, BellRing, Gauge, MousePointerClick, ReceiptText, Target } from 'lucide-react'
import { requestGoogleAdsChange, updateClientGoal } from '@/app/actions'
import { EmptyState } from '@/components/empty-state'
import { FlashMessage } from '@/components/flash-message'
import { PageHeading } from '@/components/page-heading'
import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { getClientGoalAndPacing, getWorkspaceClient, getWorkspaceConnection, listAlertIncidents, listWorkspaceClients } from '@/lib/data'
import { formatInteger, formatMoneyFromMicros, formatPercent } from '@/lib/format'
import { GoogleAdsGateway, type CampaignPerformance } from '@/lib/google-ads'
import { buildPacingBudgetRecommendations, type PacingGoal } from '@/lib/pacing'
import { permissionsForRole } from '@/lib/permissions'
import { requireWorkspacePermission } from '@/lib/workspace'

type DashboardProps = { searchParams: Promise<{ client?: string; notice?: string; error?: string }> }

export default async function DashboardPage({ searchParams }: DashboardProps) {
  const query = await searchParams
  const { workspace, isAdmin, role, entitlements } = await requireWorkspacePermission('portfolio:read')
  const english = workspace.locale === 'en'
  const locale = english ? 'en' : 'fr'
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
      apiError = error instanceof Error ? error.message : english ? 'Unable to load campaigns.' : 'Impossible de charger les campagnes.'
    }
  }
  const goalContext = client ? await getClientGoalAndPacing(workspace.id, client.id, client.timezone) : undefined
  const supportedKpis = new Set<PacingGoal['primaryKpi']>(['cpa', 'roas', 'conversions', 'conversion_value'])
  const storedGoal = goalContext?.goal
  const pacingGoal: PacingGoal | null = storedGoal && supportedKpis.has(storedGoal.primaryKpi as PacingGoal['primaryKpi'])
    ? {
        primaryKpi: storedGoal.primaryKpi as PacingGoal['primaryKpi'],
        monthlyBudgetMicros: Number(storedGoal.monthlyBudgetMicros),
        targetCpaMicros: storedGoal.targetCpaMicros ? Number(storedGoal.targetCpaMicros) : null,
        targetRoas: storedGoal.targetRoas ? Number(storedGoal.targetRoas) : null,
        targetConversions: storedGoal.targetConversions ? Number(storedGoal.targetConversions) : null,
        targetConversionValueMicros: storedGoal.targetConversionValueMicros ? Number(storedGoal.targetConversionValueMicros) : null,
      }
    : null
  const pacingRecommendations = buildPacingBudgetRecommendations({
    goal: pacingGoal,
    pacing: goalContext?.pacing ?? null,
    campaigns,
    observedDays: goalContext?.observedDays ?? 0,
    remainingDays: goalContext?.calendar ? goalContext.calendar.daysInMonth - goalContext.calendar.elapsedDays : 0,
    locale,
  })
  const canProposeBudget = permissionsForRole(role).has('google:propose') && entitlements.capabilities.has('google.mutate.basic')
  const canProposeAtomicBatch = permissionsForRole(role).has('google:propose') &&
    entitlements.capabilities.has('google.mutate.advanced') &&
    (entitlements.plan === 'agency' || entitlements.plan === 'internal')

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
        eyebrow={english ? '30-day view' : 'Vue 30 jours'}
        title={english ? 'Performance cockpit' : 'Cockpit de performance'}
        description={english ? 'Keep campaigns on course and prepare sensitive changes without leaving your monitoring cockpit.' : 'Gardez le cap sur vos campagnes et préparez les changements sensibles sans quitter votre vigie.'}
        actions={
          workspaceClients.length > 0 ? (
            <form className="flex gap-2">
              <select
                name="client"
                defaultValue={client?.id}
                className="h-10 min-w-60 rounded-lg border bg-white px-3 text-sm"
                aria-label={english ? 'Client account' : 'Compte client'}
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
                {english ? 'Show' : 'Afficher'}
              </Button>
            </form>
          ) : undefined
        }
      />
      <FlashMessage notice={query.notice} error={query.error ?? apiError} locale={locale} />
      {!connection || !client ? (
        <EmptyState
          title={connection ? (english ? 'Sync your client accounts' : 'Synchronisez vos comptes clients') : undefined}
          description={
            connection
              ? (english ? 'The connection is active. Start a sync from settings to import MCC accounts.' : 'La connexion est active. Lancez une synchronisation depuis les réglages pour importer les comptes du MCC.')
              : undefined
          }
        />
      ) : (
        <>
          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard
              label={english ? 'Spend' : 'Investissement'}
              value={formatMoneyFromMicros(totals.cost, currency)}
              icon={ReceiptText}
              note={english ? 'Last 30 days' : '30 derniers jours'}
            />
            <MetricCard
              label={english ? 'Conversions' : 'Conversions'}
              value={formatInteger(totals.conversions)}
              icon={Target}
              note={
                totals.conversions
                  ? `${formatMoneyFromMicros(totals.cost / totals.conversions, currency)} / conv.`
                  : (english ? 'No conversion' : 'Aucune conversion')
              }
            />
            <MetricCard
              label={english ? 'Clicks' : 'Clics'}
              value={formatInteger(totals.clicks)}
              icon={MousePointerClick}
              note={
                totals.impressions ? `${formatPercent(totals.clicks / totals.impressions)} ${english ? 'CTR' : 'de CTR'}` : (english ? 'CTR unavailable' : 'CTR indisponible')
              }
            />
            <MetricCard
              label={english ? 'Campaigns' : 'Campagnes'}
              value={formatInteger(campaigns.length)}
              icon={Activity}
              note={`${campaigns.filter((item) => item.status === 'ENABLED').length} ${english ? 'active' : 'actives'}`}
            />
          </section>

          <section className="mt-6 grid gap-4 lg:grid-cols-[1.3fr_.7fr]">
            <Card className="overflow-hidden border-[#dce5e7] bg-[#0d1722] text-white shadow-none">
              <CardContent className="flex flex-col gap-6 p-6 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[.16em] text-[#19A58F]">{english ? 'Monitoring score' : 'Score de vigilance'}</p>
                  <p className="mt-3 text-4xl font-semibold tracking-tight">
                    {healthScore}
                    <span className="text-lg text-white/35"> / 100</span>
                  </p>
                  <p className="mt-2 max-w-md text-sm leading-6 text-white/55">
                    {english ? 'Summary calculated from delivery, spend without conversions and open incidents.' : 'Synthèse calculée à partir de la diffusion, des dépenses sans conversion et des incidents ouverts.'}
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
                    <p className="text-sm text-muted-foreground">{english ? 'Open incidents' : 'Incidents ouverts'}</p>
                    <p className="mt-2 text-4xl font-semibold tracking-tight">{openAlerts.length}</p>
                  </div>
                  <span className="grid size-11 place-items-center rounded-2xl bg-amber-50 text-amber-700">
                    <BellRing className="size-5" />
                  </span>
                </div>
                <Button asChild variant="outline" className="mt-6 w-full">
                  <Link href="/alerts">{english ? 'Open alert center' : 'Ouvrir le centre d’alertes'}</Link>
                </Button>
              </CardContent>
            </Card>
          </section>

          <Card className="mt-6 border-[#dce5e7] shadow-none">
            <CardHeader><CardTitle>{english ? 'Goal and monthly pacing' : 'Objectif et pacing du mois'}</CardTitle><p className="mt-1 text-sm text-muted-foreground">{english ? `Calculated over the calendar month in ${client.timezone}, without currency conversion.` : `Calculé sur le mois calendaire dans le fuseau ${client.timezone}, sans conversion entre devises.`}</p></CardHeader>
            <CardContent>
              {goalContext?.goal ? (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
                  <MetricCard label={english ? 'Monthly budget' : 'Budget mensuel'} value={formatMoneyFromMicros(goalContext.goal.monthlyBudgetMicros, currency)} icon={Gauge} note={`KPI : ${goalContext.goal.primaryKpi.toUpperCase()}`} />
                  <MetricCard label={english ? 'MTD spend' : 'Dépense MTD'} value={goalContext.pacing ? formatMoneyFromMicros(goalContext.pacing.actualSpendMicros, currency) : '—'} icon={ReceiptText} note={english ? `${goalContext.observedDays} collected day(s)` : `${goalContext.observedDays} jour(s) collecté(s)`} />
                  <MetricCard label={english ? 'Expected to date' : 'Attendu à date'} value={goalContext.pacing ? formatMoneyFromMicros(goalContext.pacing.expectedSpendMicros, currency) : '—'} icon={Target} note={goalContext.pacing?.status ?? (english ? 'Missing data' : 'Données manquantes')} />
                  <MetricCard label={english ? 'Variance' : 'Écart'} value={goalContext.pacing?.variancePercent === null || goalContext.pacing?.variancePercent === undefined ? '—' : formatPercent(goalContext.pacing.variancePercent)} icon={ArrowDownUp} note={english ? '± 10% = on track' : '± 10 % = dans le rythme'} />
                  <MetricCard label={english ? 'End-of-month forecast' : 'Forecast fin de mois'} value={goalContext.pacing?.forecastMicros === null || goalContext.pacing?.forecastMicros === undefined ? '—' : formatMoneyFromMicros(goalContext.pacing.forecastMicros, currency)} icon={Activity} note={goalContext.pacing?.status === 'missing_data' ? (english ? 'Daily collection required' : 'Collecte journalière requise') : (english ? 'Indicative projection' : 'Projection indicative')} />
                </div>
              ) : <p className="text-sm text-muted-foreground">{english ? 'No goal defined: no pacing recommendation will be generated.' : 'Aucun objectif défini : aucune recommandation de pacing ne sera générée.'}</p>}
              {isAdmin && (
                <details className="mt-5 rounded-xl border p-4">
                  <summary className="cursor-pointer text-sm font-medium">{english ? 'Configure goal' : 'Configurer l’objectif'}</summary>
                  <form action={updateClientGoal} className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <input type="hidden" name="clientId" value={client.id} />
                    <select name="primaryKpi" defaultValue={goalContext?.goal?.primaryKpi ?? 'cpa'} className="h-10 rounded-lg border bg-white px-3 text-sm"><option value="cpa">CPA</option><option value="roas">ROAS</option><option value="conversions">Conversions</option><option value="conversion_value">{english ? 'Conversion value' : 'Valeur de conversion'}</option></select>
                    <Input name="monthlyBudget" type="number" min="0.01" step="0.01" placeholder={`${english ? 'Monthly budget' : 'Budget mensuel'} ${currency}`} defaultValue={goalContext?.goal ? Number(goalContext.goal.monthlyBudgetMicros) / 1_000_000 : ''} required />
                    <Input name="targetCpa" type="number" min="0.01" step="0.01" placeholder={english ? 'Target CPA (optional)' : 'CPA cible (facultatif)'} defaultValue={goalContext?.goal?.targetCpaMicros ? Number(goalContext.goal.targetCpaMicros) / 1_000_000 : ''} />
                    <Input name="targetRoas" type="number" min="0.01" step="0.01" placeholder={english ? 'Target ROAS (optional)' : 'ROAS cible (facultatif)'} defaultValue={goalContext?.goal?.targetRoas ?? ''} />
                    <Input name="targetConversions" type="number" min="0.01" step="0.01" placeholder={english ? 'Target conversions / month' : 'Conversions cibles / mois'} defaultValue={goalContext?.goal?.targetConversions ?? ''} />
                    <Input name="targetConversionValue" type="number" min="0.01" step="0.01" placeholder={`${english ? 'Target conversion value / month' : 'Valeur de conversion cible / mois'} (${currency})`} defaultValue={goalContext?.goal?.targetConversionValueMicros ? Number(goalContext.goal.targetConversionValueMicros) / 1_000_000 : ''} />
                    <Input name="conversionValue" type="number" min="0.01" step="0.01" placeholder={english ? 'Value per conversion' : 'Valeur d’une conversion'} defaultValue={goalContext?.goal?.conversionValueMicros ? Number(goalContext.goal.conversionValueMicros) / 1_000_000 : ''} />
                    <Input name="marginPercent" type="number" min="0" max="100" step="0.01" placeholder={english ? 'Margin %' : 'Marge %'} defaultValue={goalContext?.goal?.marginPercent ?? ''} />
                    <Button type="submit">{english ? 'Save' : 'Enregistrer'}</Button>
                  </form>
                </details>
              )}
              <div className="mt-5 rounded-2xl border border-[#dce5e7] bg-[#f8fbfb] p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="font-semibold">{english ? 'Guarded budget recommendations' : 'Recommandations budgétaires gardées'}</h3>
                    <p className="mt-1 text-sm text-muted-foreground">{pacingRecommendations.message}</p>
                  </div>
                  <span className="rounded-full border bg-white px-3 py-1 text-xs font-medium">30 {english ? 'days' : 'jours'} · {currency}</span>
                </div>
                {pacingRecommendations.recommendations.length > 0 && (
                  <div className="mt-4 space-y-3">
                    {pacingRecommendations.recommendations.map((recommendation) => recommendation.kind === 'reallocate' ? (
                      <div key={`reallocate-${recommendation.fromCampaign.id}-${recommendation.toCampaign.id}`} className="rounded-xl border bg-white p-4">
                        <p className="font-medium">{english ? 'Reallocate' : 'Réallouer'} {formatMoneyFromMicros(recommendation.transferMicros, currency)} / {english ? 'day' : 'jour'}</p>
                        <p className="mt-1 text-sm text-muted-foreground">{recommendation.fromCampaign.name} → {recommendation.toCampaign.name}</p>
                        <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
                          {recommendation.reasons.map((reason) => <li key={reason}>• {reason}</li>)}
                        </ul>
                        {canProposeAtomicBatch ? (
                          <form action={requestGoogleAdsChange} className="mt-3">
                            <input type="hidden" name="kind" value="budget_reallocation" />
                            <input type="hidden" name="clientId" value={client.id} />
                            <input type="hidden" name="campaignId" value={recommendation.fromCampaign.id} />
                            <input type="hidden" name="campaignName" value={recommendation.fromCampaign.name} />
                            <input type="hidden" name="budgetResourceName" value={recommendation.fromCampaign.budgetResourceName} />
                            <input type="hidden" name="targetCampaignId" value={recommendation.toCampaign.id} />
                            <input type="hidden" name="targetCampaignName" value={recommendation.toCampaign.name} />
                            <input type="hidden" name="targetBudgetResourceName" value={recommendation.toCampaign.budgetResourceName} />
                            <input type="hidden" name="transferDaily" value={recommendation.transferMicros / 1_000_000} />
                            <Button type="submit" size="sm" variant="outline">{english ? 'Validate and propose atomic batch' : 'Valider et proposer le batch atomique'}</Button>
                          </form>
                        ) : (
                          <p className="mt-3 text-xs font-medium text-amber-700">{english ? 'Advisory only: atomic batches are reserved for the Agency plan.' : 'Consultatif uniquement : le batch atomique est réservé au plan Agency.'}</p>
                        )}
                      </div>
                    ) : (
                      <div key={`${recommendation.kind}-${recommendation.campaign.id}`} className="flex flex-col gap-4 rounded-xl border bg-white p-4 lg:flex-row lg:items-center lg:justify-between">
                        <div>
                          <p className="font-medium">{recommendation.kind === 'increase' ? (english ? 'Incremental increase' : 'Hausse incrémentale') : (english ? 'Incremental decrease' : 'Baisse incrémentale')} · {recommendation.campaign.name}</p>
                          <p className="mt-1 text-sm text-muted-foreground">
                            {formatMoneyFromMicros(recommendation.currentBudgetMicros, currency)} → {formatMoneyFromMicros(recommendation.proposedBudgetMicros, currency)} / {english ? 'day' : 'jour'} · {english ? 'confidence' : 'confiance'} {recommendation.confidence}
                          </p>
                          <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
                            {recommendation.reasons.map((reason) => <li key={reason}>• {reason}</li>)}
                          </ul>
                        </div>
                        {canProposeBudget && (
                          <form action={requestGoogleAdsChange}>
                            <input type="hidden" name="kind" value="campaign_budget" />
                            <input type="hidden" name="clientId" value={client.id} />
                            <input type="hidden" name="campaignId" value={recommendation.campaign.id} />
                            <input type="hidden" name="campaignName" value={recommendation.campaign.name} />
                            <input type="hidden" name="budgetResourceName" value={recommendation.campaign.budgetResourceName} />
                            <input type="hidden" name="dailyBudget" value={recommendation.proposedBudgetMicros / 1_000_000} />
                            <Button type="submit" size="sm" variant="outline">{english ? 'Review, validate and propose' : 'Relire, valider et proposer'}</Button>
                          </form>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          <Card className="mt-6 overflow-hidden border-[#e8e5ef] shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between border-b bg-white">
              <div>
                <CardTitle>{english ? 'Campaigns' : 'Campagnes'} · {client.name}</CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">
                  {english ? 'Requests are validated by Google before entering approval.' : 'Les demandes sont validées par Google avant d’entrer en approbation.'}
                </p>
              </div>
              <ArrowDownUp className="size-5 text-muted-foreground" />
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-[#faf9fc] text-left text-xs uppercase tracking-wider text-muted-foreground">
                    <tr>
                      <th className="px-5 py-3">{english ? 'Campaign' : 'Campagne'}</th>
                      <th className="px-4 py-3">{english ? 'Status' : 'Statut'}</th>
                      <th className="px-4 py-3 text-right">{english ? 'Budget/day' : 'Budget/j'}</th>
                      <th className="px-4 py-3 text-right">{english ? 'Cost' : 'Coût'}</th>
                      <th className="px-4 py-3 text-right">{english ? 'Clicks' : 'Clics'}</th>
                      <th className="px-4 py-3 text-right">Conv.</th>
                      <th className="px-4 py-3 text-right">{english ? 'Lost IS budget / rank' : 'Perte IS budget / rank'}</th>
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
                          <StatusBadge status={campaign.status} locale={locale} />
                        </td>
                        <td className="px-4 py-4 text-right font-medium">
                          {formatMoneyFromMicros(campaign.budgetMicros, currency)}
                        </td>
                        <td className="px-4 py-4 text-right">{formatMoneyFromMicros(campaign.costMicros, currency)}</td>
                        <td className="px-4 py-4 text-right">{formatInteger(campaign.clicks)}</td>
                        <td className="px-4 py-4 text-right">
                          {campaign.conversions.toLocaleString(english ? 'en-GB' : 'fr-FR', { maximumFractionDigits: 1 })}
                        </td>
                        <td className="px-4 py-4 text-right text-xs text-muted-foreground">
                          {campaign.searchBudgetLostImpressionShare === null
                            ? '—'
                            : `${formatPercent(campaign.searchBudgetLostImpressionShare)} / ${campaign.searchRankLostImpressionShare === null ? '—' : formatPercent(campaign.searchRankLostImpressionShare)}`}
                        </td>
                        <td className="px-5 py-4 text-right">
                          <details className="relative inline-block text-left">
                            <summary className="cursor-pointer list-none rounded-lg border px-3 py-2 text-xs font-medium hover:bg-muted">
                              {english ? 'Prepare' : 'Préparer'}
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
                                  {campaign.status === 'ENABLED' ? (english ? 'Pause' : 'Suspendre') : (english ? 'Enable' : 'Activer')} {english ? 'this campaign' : 'cette campagne'}
                                </p>
                                <Button type="submit" variant="outline" size="sm" className="w-full">
                                  {english ? 'Validate then request' : 'Valider puis demander'}
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
                                  {english ? 'New daily budget' : 'Nouveau budget quotidien'}
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
                                    {english ? 'Request' : 'Demander'}
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
                          {english ? 'No campaign with activity over the last 30 days.' : 'Aucune campagne avec activité sur les 30 derniers jours.'}
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
