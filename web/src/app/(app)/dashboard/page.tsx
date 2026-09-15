import { featureEnabled, googleMutationKindEnabled } from '@/lib/feature-flags'
import { dashboardHealth, dashboardScoreCampaigns } from '@/lib/dashboard-health'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Activity, ArrowDownUp, BellRing, Gauge, MousePointerClick, ReceiptText, Target } from 'lucide-react'
import { requestGoogleAdsChange, updateClientGoal } from '@/app/actions'
import { FlashMessage } from '@/components/flash-message'
import { PageHeading } from '@/components/page-heading'
import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { getClientGoalAndPacing, getQualifiedAccountPerformance, getWorkspaceClient, getWorkspaceConnection, getClientAlertSummary, listWorkspaceClients } from '@/lib/data'
import { formatInteger, formatMoneyFromMicros, formatPercent } from '@/lib/format'
import { getAnalyticalCollections } from '@/lib/analytical-collections'
import { analyticalSnapshotData } from '@/lib/analytical-model'
import { CollectionStatus } from '@/components/collection-status'
import { workspaceDecision } from '@/lib/workspace-decision'
import { buildPacingBudgetRecommendations, type PacingGoal } from '@/lib/pacing'
import { permissionsForRole } from '@/lib/permissions'
import { requireWorkspacePagePermission } from '@/lib/workspace'

type DashboardProps = { searchParams: Promise<{ client?: string; notice?: string; error?: string; sync?: string }> }

export default async function DashboardPage({ searchParams }: DashboardProps) {
  const query = await searchParams
  const { workspace, isAdmin, role, entitlements } = await requireWorkspacePagePermission('portfolio:read', '/dashboard')
  const english = workspace.locale === 'en'
  const locale = english ? 'en' : 'fr'
  const [connection, workspaceClients] = await Promise.all([
    getWorkspaceConnection(workspace.id),
    listWorkspaceClients(workspace.id),
  ])
  const client = await getWorkspaceClient(workspace.id, query.client)
  if (query.client !== undefined && !client) notFound()
  const [collection, goalContext, accountPerformance, alertSummary] = await Promise.all([
    client ? getAnalyticalCollections(workspace.id, client.id, ['campaigns']) : { snapshots: [], attempts: [] },
    client ? getClientGoalAndPacing(workspace.id, client.id, client.timezone) : undefined,
    client ? getQualifiedAccountPerformance(workspace.id, client.id) : undefined,
    client ? getClientAlertSummary(workspace.id, client.id) : undefined,
  ])
  const campaignSnapshot = client ? analyticalSnapshotData(collection.snapshots, 'campaigns', client) : undefined
  const campaigns = campaignSnapshot ?? []
  const canConnect = workspaceDecision({ role, state: workspace.accessState, permission: 'google:connect' }).allowed
  const canRefresh = connection?.status === 'active' && workspaceDecision({ role, state: workspace.accessState, permission: 'monitoring:run', entitlements, capability: 'google.read', features: ['googleReads', 'scheduler'] }).allowed
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
  const canProposeBasic = permissionsForRole(role).has('google:propose') && entitlements.capabilities.has('google.mutate.basic') && featureEnabled('googleReads')
  const canProposeBudget = canProposeBasic && googleMutationKindEnabled('campaign_budget')
  const canProposeStatus = canProposeBasic && googleMutationKindEnabled('campaign_status')
  const canProposeAtomicBatch = canProposeBasic && googleMutationKindEnabled('budget_reallocation') &&
    entitlements.capabilities.has('google.mutate.advanced') &&
    (entitlements.plan === 'agency' || entitlements.plan === 'internal')

  const totals = accountPerformance?.totals
  const coverageNote = accountPerformance ? `${accountPerformance.coverage.completeDays}/30 ${english ? 'covered days' : 'jours couverts'}` : (english ? 'No collection' : 'Aucune collecte')
  const currency = client?.currencyCode ?? 'EUR'
  const { score: healthScore, openCount: openAlerts } = dashboardHealth({
    clientId: client?.id, campaigns: client ? dashboardScoreCampaigns(collection.snapshots, client) : null,
    alerts: alertSummary,
  })
  const collectedAt = collection.snapshots.find((row) => row.family === 'campaigns')?.collectedAt
  const pacingStatusLabel = {
    missing_data: english ? 'Incomplete coverage' : 'Couverture incomplète',
    under: english ? 'Below pace' : 'Sous le rythme prévu',
    on_track: english ? 'On track' : 'Dans le rythme prévu',
    over: english ? 'Above pace' : 'Au-dessus du rythme prévu',
  }[goalContext?.pacing?.status ?? 'missing_data']


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
                className="h-10 min-w-60 rounded-lg border bg-card px-3 text-sm"
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
      <FlashMessage notice={query.notice} error={query.error} locale={locale} />
      {client && <CollectionStatus client={client} {...collection} locale={locale} canRefresh={canRefresh} canConnect={canConnect} destination="/dashboard" feedback={query.sync} />}
      {!client || (!campaignSnapshot && !totals) ? (
        <div role="status" className="rounded-md border bg-card p-6">
          <h2 className="font-semibold">{client ? (english ? 'Collection pending' : 'Collecte en attente') : connection ? (english ? 'Choose your managed accounts' : 'Choisissez les comptes à gérer') : (english ? 'Connect Google Ads' : 'Connectez Google Ads')}</h2>
          <p className="mt-2 text-sm text-muted-foreground">{client
            ? (english ? 'Account data will appear after a successful collection. See the collection status above.' : 'Les données du compte apparaîtront après une collecte réussie. Consultez l’état de la collecte ci-dessus.')
            : connection ? (english ? 'Choose the accounts to manage from your MCC inventory. Refresh the inventory from connection settings when needed.' : 'Choisissez les comptes à gérer dans l’inventaire du MCC. Actualisez cet inventaire depuis les réglages de connexion si nécessaire.')
            : (english ? 'Connect your account to collect new data. Stored budget history remains available below.' : 'Connectez votre compte pour collecter de nouvelles données. L’historique budgétaire enregistré reste disponible ci-dessous.')}</p>
          {canConnect && <Button asChild variant="outline" className="mt-4"><Link href={connection ? "/accounts" : "/settings"}>{connection ? (english ? 'Choose accounts' : 'Choisir les comptes') : (english ? 'Connection settings' : 'Réglages de connexion')}</Link></Button>}
        </div>
      ) : (
        <>
          {collectedAt && <p className="mb-4 text-xs text-muted-foreground">{english ? 'Campaign data retrieved at' : 'Données des campagnes récupérées le'} {collectedAt?.toLocaleString(english ? 'en-GB' : 'fr-FR', { timeZone: client.timezone })} · {client.timezone}</p>}
          <p className="mb-4 text-xs text-muted-foreground">{english ? 'Account totals from complete daily history' : 'Totaux du compte issus de l’historique journalier complet'} · {accountPerformance?.window.from} → {accountPerformance?.window.through}</p>
          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard
              label={english ? 'Spend' : 'Investissement'}
              value={totals ? formatMoneyFromMicros(totals.cost, currency) : '—'}
              icon={ReceiptText}
              note={coverageNote}
            />
            <MetricCard
              label={english ? 'Conversions' : 'Conversions'}
              value={totals ? formatInteger(totals.conversions) : '—'}
              icon={Target}
              note={
                totals?.conversions
                  ? `${formatMoneyFromMicros(Number(totals.cost) / totals.conversions, currency)} / conv.`
                  : totals ? (english ? 'No conversion' : 'Aucune conversion') : coverageNote
              }
            />
            <MetricCard
              label={english ? 'Clicks' : 'Clics'}
              value={totals ? formatInteger(totals.clicks) : '—'}
              icon={MousePointerClick}
              note={
                totals && Number(totals.impressions) ? `${formatPercent(Number(totals.clicks) / Number(totals.impressions))} ${english ? 'CTR' : 'de CTR'}` : (english ? 'CTR unavailable' : 'CTR indisponible')
              }
            />
            <MetricCard
              label={english ? 'Campaigns' : 'Campagnes'}
              value={campaignSnapshot ? formatInteger(campaigns.length) : '—'}
              icon={Activity}
              note={campaignSnapshot ? `${campaigns.filter((item) => item.status === 'ENABLED').length} ${english ? 'active' : 'actives'}` : (english ? 'Collection unavailable' : 'Collecte indisponible')}
            />
          </section>



        </>
      )}
      {client && (
          <section className="mt-6 grid gap-4 lg:grid-cols-[1.3fr_.7fr]">
            <Card className="overflow-hidden border-border bg-card text-foreground shadow-none">
              <CardContent className="flex flex-col gap-6 p-6 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p id="dashboard-score-label" className="text-xs font-semibold uppercase tracking-[.16em] text-primary">{english ? 'Monitoring score' : 'Score de vigilance'}</p>
                  <p aria-labelledby="dashboard-score-label" data-dashboard-score className="mt-3 text-4xl font-semibold tracking-tight">
                    {healthScore ?? '—'}
                    <span className="text-lg text-muted-foreground"> / 100</span>
                  </p>
                  <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">
                    {english ? 'Client score based on delivery, spend without conversions, and open or reopened incidents. Requires fresh campaign data with all available query pages received. Acknowledged and snoozed incidents are excluded.' : 'Score du client fondé sur la diffusion, les dépenses sans conversion et les incidents ouverts ou rouverts. Le score exige des campagnes récentes et toutes les pages disponibles de la collecte. Les incidents acquittés et reportés sont exclus.'}
                  </p>
                </div>
                <div aria-hidden="true" className="relative grid size-28 shrink-0 place-items-center">
                  <svg viewBox="0 0 112 112" className="absolute inset-0 size-full -rotate-90" focusable="false">
                    <circle cx="56" cy="56" r="46" fill="none" stroke="currentColor" strokeWidth="10" className="text-muted-foreground" />
                    {healthScore !== null && <circle cx="56" cy="56" r="46" fill="none" stroke="currentColor" strokeWidth="10" pathLength="100" strokeDasharray={`${healthScore} 100`} className="text-primary" />}
                  </svg>
                  <Gauge className={`size-9 ${healthScore === null ? 'text-muted-foreground' : 'text-primary'}`} />
                </div>
              </CardContent>
            </Card>
            <Card className="border-border shadow-none">
              <CardContent className="p-6">
                <div className="flex items-start justify-between">
                  <div>
                    <p id="dashboard-alert-label" className="text-sm text-muted-foreground">{english ? 'Open incidents' : 'Incidents ouverts'}</p>
                    <p aria-labelledby="dashboard-alert-label" data-dashboard-alerts className="mt-2 text-4xl font-semibold tracking-tight">{openAlerts ?? '—'}</p>
                  </div>
                  <span className="grid size-11 place-items-center rounded-md y-status-warning text-[var(--y-warning)]">
                    <BellRing className="size-5" />
                  </span>
                </div>
                <Button asChild variant="outline" className="mt-6 w-full">
                  <Link href={`/alerts?client=${client.id}`}>{english ? 'Open alert center' : 'Ouvrir le centre d’alertes'}</Link>
                </Button>
              </CardContent>
            </Card>
          </section>
      )}
      {client && (
          <Card className="mt-6 border-border shadow-none">
            <CardHeader><CardTitle>{english ? 'Goal and monthly pacing' : 'Objectif et pacing du mois'}</CardTitle><p className="mt-1 text-sm text-muted-foreground">{english ? `Calculated through the last completed day in ${client.timezone}, without currency conversion.` : `Calculé jusqu’au dernier jour terminé dans le fuseau ${client.timezone}, sans conversion entre devises.`}</p></CardHeader>
            <CardContent>
              {goalContext?.goal ? (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
                  <MetricCard label={english ? 'Monthly budget' : 'Budget mensuel'} value={formatMoneyFromMicros(goalContext.goal.monthlyBudgetMicros, currency)} icon={Gauge} note={`KPI : ${goalContext.goal.primaryKpi.toUpperCase()}`} />
                  <MetricCard label={english ? 'MTD spend' : 'Dépense MTD'} value={goalContext.pacing && goalContext.pacing.status !== 'missing_data' ? formatMoneyFromMicros(goalContext.pacing.actualSpendMicros, currency) : '—'} icon={ReceiptText} note={english ? `${goalContext.observedDays}/${goalContext.calendar?.elapsedDays ?? 0} covered day(s)` : `${goalContext.observedDays}/${goalContext.calendar?.elapsedDays ?? 0} jour(s) couverts`} />
                  <MetricCard label={english ? 'Expected to date' : 'Attendu à date'} value={goalContext.pacing && goalContext.pacing.status !== 'missing_data' ? formatMoneyFromMicros(goalContext.pacing.expectedSpendMicros, currency) : '—'} icon={Target} note={pacingStatusLabel} />
                  <MetricCard label={english ? 'Variance' : 'Écart'} value={goalContext.pacing?.variancePercent === null || goalContext.pacing?.variancePercent === undefined ? '—' : formatPercent(goalContext.pacing.variancePercent)} icon={ArrowDownUp} note={english ? '± 10% = on track' : '± 10 % = dans le rythme'} />
                  <MetricCard label={english ? 'End-of-month forecast' : 'Forecast fin de mois'} value={goalContext.pacing?.forecastMicros === null || goalContext.pacing?.forecastMicros === undefined ? '—' : formatMoneyFromMicros(goalContext.pacing.forecastMicros, currency)} icon={Activity} note={goalContext.pacing?.status === 'missing_data' ? (english ? 'Daily collection required' : 'Collecte journalière requise') : (english ? 'Indicative projection' : 'Projection indicative')} />
                </div>
              ) : <p className="text-sm text-muted-foreground">{english ? 'No goal defined: no pacing recommendation will be generated.' : 'Aucun objectif défini : aucune recommandation de pacing ne sera générée.'}</p>}
              {isAdmin && (
                <details className="mt-5 rounded-md border p-4">
                  <summary className="cursor-pointer text-sm font-medium">{english ? 'Configure goal' : 'Configurer l’objectif'}</summary>
                  <form action={updateClientGoal} className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <input type="hidden" name="clientId" value={client.id} />
                    <select name="primaryKpi" defaultValue={goalContext?.goal?.primaryKpi ?? 'cpa'} className="h-10 rounded-lg border bg-card px-3 text-sm"><option value="cpa">CPA</option><option value="roas">ROAS</option><option value="conversions">Conversions</option><option value="conversion_value">{english ? 'Conversion value' : 'Valeur de conversion'}</option></select>
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
              <div className="mt-5 rounded-md border border-border bg-card p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="font-semibold">{english ? 'Guarded budget recommendations' : 'Recommandations budgétaires gardées'}</h3>
                    <p className="mt-1 text-sm text-muted-foreground">{pacingRecommendations.message}</p>
                  </div>
                  <span className="rounded-md border bg-card px-3 py-1 text-xs font-medium">30 {english ? 'days' : 'jours'} · {currency}</span>
                </div>
                {pacingRecommendations.recommendations.length > 0 && (
                  <div className="mt-4 space-y-3">
                    {pacingRecommendations.recommendations.map((recommendation) => recommendation.kind === 'reallocate' ? (
                      <div key={`reallocate-${recommendation.fromCampaign.id}-${recommendation.toCampaign.id}`} className="rounded-md border bg-card p-4">
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
                          <p className="mt-3 text-xs font-medium text-[var(--y-warning)]">{english ? 'Advisory only: atomic batches are reserved for the Agency plan.' : 'Consultatif uniquement : le batch atomique est réservé au plan Agency.'}</p>
                        )}
                      </div>
                    ) : (
                      <div key={`${recommendation.kind}-${recommendation.campaign.id}`} className="flex flex-col gap-4 rounded-md border bg-card p-4 lg:flex-row lg:items-center lg:justify-between">
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

      )}
      {client && campaignSnapshot && (
          <Card className="mt-6 overflow-hidden border-border ">
            <CardHeader className="flex flex-row items-center justify-between border-b bg-card">
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
                  <thead className="bg-card text-left text-xs uppercase tracking-wider text-muted-foreground">
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
                      <tr key={campaign.id} className="bg-card align-top hover:bg-card">
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
                          {(canProposeStatus || canProposeBudget) && <details className="relative inline-block text-left">
                            <summary className="cursor-pointer list-none rounded-lg border px-3 py-2 text-xs font-medium hover:bg-muted">
                              {english ? 'Prepare' : 'Préparer'}
                            </summary>
                            <div className="absolute right-0 z-10 mt-2 w-72 rounded-md border bg-card p-4 text-left ">
                              {canProposeStatus && <form action={requestGoogleAdsChange} className="space-y-3">
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
                              </form>}
                              <div className="my-4 border-t" />
                              {canProposeBudget && <form action={requestGoogleAdsChange} className="space-y-3">
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
                              </form>}
                            </div>
                          </details>}
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
    <Card className="border-border bg-card ">
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm text-muted-foreground">{label}</p>
            <p className="mt-2 text-2xl font-semibold tracking-tight">{value}</p>
          </div>
          <span className="grid size-10 place-items-center rounded-md bg-card text-[var(--brand-accent)]">
            <Icon className="size-5" />
          </span>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">{note}</p>
      </CardContent>
    </Card>
  )
}
