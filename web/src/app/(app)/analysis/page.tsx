import Link from 'next/link'
import {
  BadgeAlert,
  ChartNoAxesCombined,
  CircleGauge,
  FileSearch,
  Lightbulb,
  MousePointerClick,
  SearchCheck,
  ShieldCheck,
  Sparkles,
  Target,
} from 'lucide-react'
import { EmptyState } from '@/components/empty-state'
import { requestGoogleAdsChange } from '@/app/actions'
import { FlashMessage } from '@/components/flash-message'
import { PageHeading } from '@/components/page-heading'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { analyzeAccount, type AnalysisCategory, type AnalysisFinding } from '@/lib/analysis'
import { getWorkspaceClient, getWorkspaceConnection, listWorkspaceClients } from '@/lib/data'
import { formatInteger, formatMoneyFromMicros } from '@/lib/format'
import { GoogleAdsGateway, type AccountAnalysisData } from '@/lib/google-ads'
import { requireWorkspacePermission } from '@/lib/workspace'
import { recordActivationMilestone } from '@/lib/activation'

type AnalysisPageProps = { searchParams: Promise<{ client?: string; notice?: string; error?: string }> }

export default async function AnalysisPage({ searchParams }: AnalysisPageProps) {
  const query = await searchParams
  const { workspace, entitlements, session } = await requireWorkspacePermission('portfolio:read')
  const english = workspace.locale === 'en'
  const locale = english ? 'en' : 'fr'
  const categories: Array<{ value: AnalysisCategory | 'all'; label: string; icon: typeof SearchCheck }> = [
    { value: 'all', label: english ? 'Priorities' : 'Priorités', icon: Sparkles },
    { value: 'search_terms', label: english ? 'Search terms' : 'Requêtes', icon: SearchCheck },
    { value: 'keywords', label: english ? 'Keywords' : 'Mots-clés', icon: Target },
    { value: 'ads', label: english ? 'Ads' : 'Annonces', icon: FileSearch },
    { value: 'tracking', label: 'Tracking', icon: ShieldCheck },
  ]
  const canProposeAdvanced = entitlements.capabilities.has('google.mutate.advanced')
  const [connection, clients] = await Promise.all([
    getWorkspaceConnection(workspace.id),
    listWorkspaceClients(workspace.id),
  ])
  const client = await getWorkspaceClient(workspace.id, query.client)
  let data: AccountAnalysisData | undefined
  let apiError: string | undefined

  if (connection && client) {
    try {
      data = await new GoogleAdsGateway(connection).accountAnalysis(client.googleCustomerId)
      await recordActivationMilestone({
        workspaceId: workspace.id,
        milestone: 'first_analysis',
        actorUserId: session.userId,
        sourceEntityId: client.id,
      }).catch((error) => console.error(JSON.stringify({
        level: 'error',
        message: 'activation.first_analysis.failed',
        error: error instanceof Error ? error.message : String(error),
      })))
    } catch (error) {
      apiError = error instanceof Error ? error.message : english ? 'Unable to run the Google Ads analysis.' : 'Impossible d’exécuter l’analyse Google Ads.'
    }
  }

  const analysis = data ? analyzeAccount(data, locale) : undefined
  const currency = client?.currencyCode ?? 'EUR'

  return (
    <>
      <PageHeading
        eyebrow={english ? 'Google Ads intelligence · 30 days' : 'Intelligence Google Ads · 30 jours'}
        title={english ? '360 analysis' : 'Analyse 360'}
        description={english ? 'Ads by Yodev combines search terms, Quality Score, responsive ads and tracking to prioritize the actions that matter.' : 'Ads by Yodev croise les requêtes, le Quality Score, les annonces responsives et le tracking pour prioriser les actions qui comptent.'}
        actions={
          clients.length ? (
            <form className="flex gap-2">
              <select
                name="client"
                defaultValue={client?.id}
                className="h-10 min-w-56 rounded-lg border bg-white px-3 text-sm"
                aria-label={english ? 'Client account' : 'Compte client'}
              >
                {clients
                  .filter((item) => !item.isManager)
                  .map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
              </select>
              <Button type="submit">{english ? 'Refresh' : 'Actualiser'}</Button>
            </form>
          ) : undefined
        }
      />
      <FlashMessage notice={query.notice} error={query.error ?? apiError} locale={locale} />

      {!connection || !client || !data || !analysis ? (
        <EmptyState
          title={connection ? (english ? 'No account available for analysis' : 'Aucun compte analysable') : (english ? 'Connect Google Ads to start the analysis' : 'Connectez Google Ads pour lancer l’analyse')}
          description={
            connection
              ? (english ? 'Sync at least one client account from settings.' : 'Synchronisez au moins un compte client depuis les réglages.')
              : (english ? 'The analysis uses only the official Google Ads API and remains read-only.' : 'L’analyse utilise uniquement l’API officielle Google Ads et reste en lecture seule.')
          }
        />
      ) : (
        <>
          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
            <Card className="border-0 bg-[#0d1722] text-white shadow-none sm:col-span-2 xl:col-span-1">
              <CardContent className="p-5">
                <p className="text-xs font-semibold uppercase tracking-[.16em] text-[#19A58F]">{english ? 'Opportunity score' : 'Score d’opportunité'}</p>
                <div className="mt-5 flex items-end gap-2">
                  <span className="text-5xl font-semibold tracking-[-.06em]">{analysis.score}</span>
                  <span className="mb-1 text-sm text-white/45">/ 100</span>
                </div>
                <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-white/10">
                  <div className="h-full rounded-full bg-[#19A58F]" style={{ width: `${analysis.score}%` }} />
                </div>
                <p className="mt-3 text-xs leading-5 text-white/50">{english ? 'Explainable score calculated from the anomalies shown below.' : 'Score explicable, calculé à partir des anomalies visibles ci-dessous.'}</p>
              </CardContent>
            </Card>
            <SummaryCard
              label={english ? 'Potential waste' : 'Gaspillage potentiel'}
              value={formatMoneyFromMicros(analysis.summary.wastedSpendMicros, currency)}
              note={english ? 'search terms without conversions' : 'requêtes sans conversion'}
              icon={MousePointerClick}
            />
            <SummaryCard
              label={english ? 'Weak keywords' : 'Mots-clés faibles'}
              value={formatInteger(analysis.summary.weakKeywords)}
              note="Quality Score ≤ 5"
              icon={Target}
            />
            <SummaryCard
              label={english ? 'Ads to improve' : 'Annonces à renforcer'}
              value={formatInteger(analysis.summary.weakAds)}
              note={english ? 'strength or compliance' : 'force ou conformité'}
              icon={FileSearch}
            />
            <SummaryCard
              label={english ? 'Measurement issues' : 'Points de mesure'}
              value={formatInteger(analysis.summary.trackingIssues)}
              note={trackingLabel(data.conversionTracking.status, locale)}
              icon={ShieldCheck}
            />
          </section>

          <section className="mt-6 rounded-3xl border border-[#dce5e8] bg-white p-5 sm:p-7">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[.16em] text-[#19A58F]">{english ? 'Prioritized action plan' : 'Plan d’action priorisé'}</p>
                <h2 className="mt-2 text-xl font-semibold tracking-tight">
                  {analysis.findings.length
                    ? (english ? `${analysis.findings.length} opportunit${analysis.findings.length === 1 ? 'y' : 'ies'} detected` : `${analysis.findings.length} opportunité${analysis.findings.length > 1 ? 's' : ''} détectée${analysis.findings.length > 1 ? 's' : ''}`)
                    : (english ? 'No critical signal detected' : 'Aucun signal critique détecté')}
                </h2>
              </div>
              <Button asChild variant="outline">
                <Link href="/agents">
                  <CircleGauge className="mr-2 size-4" /> {english ? 'Automate monitoring' : 'Automatiser la surveillance'}
                </Link>
              </Button>
            </div>

            <Tabs defaultValue="all" className="mt-6">
              <TabsList variant="line" className="max-w-full overflow-x-auto">
                {categories.map(({ value, label, icon: Icon }) => (
                  <TabsTrigger key={value} value={value} className="px-3">
                    <Icon className="size-4" /> {label}
                  </TabsTrigger>
                ))}
              </TabsList>
              {categories.map(({ value }) => {
                const findings =
                  value === 'all' ? analysis.findings : analysis.findings.filter((finding) => finding.category === value)
                return (
                  <TabsContent key={value} value={value} className="mt-5">
                    <FindingList findings={findings} currency={currency} clientId={client.id} canProposeAdvanced={canProposeAdvanced} locale={locale} />
                  </TabsContent>
                )
              })}
            </Tabs>
          </section>

          <section className="mt-6 grid gap-4 xl:grid-cols-3">
            <InventoryCard
              title={english ? 'Search term coverage' : 'Couverture des requêtes'}
              value={data.searchTerms.length}
              description={english ? `${data.searchTerms.filter((term) => term.conversions > 0).length} terms generated at least one conversion.` : `${data.searchTerms.filter((term) => term.conversions > 0).length} termes ont généré au moins une conversion.`}
              icon={SearchCheck}
            />
            <InventoryCard
              title={english ? 'Keyword portfolio' : 'Portefeuille de mots-clés'}
              value={data.keywords.length}
              description={english ? `${data.keywords.filter((keyword) => keyword.qualityScore !== null).length} keywords have a usable Quality Score.` : `${data.keywords.filter((keyword) => keyword.qualityScore !== null).length} mots-clés disposent d’un Quality Score exploitable.`}
              icon={ChartNoAxesCombined}
            />
            <InventoryCard
              title={english ? 'Responsive creatives' : 'Créations responsives'}
              value={data.ads.length}
              description={english ? `${data.ads.filter((ad) => ad.approvalStatus === 'APPROVED').length} ads are approved by Google.` : `${data.ads.filter((ad) => ad.approvalStatus === 'APPROVED').length} annonces sont approuvées par Google.`}
              icon={BadgeAlert}
            />
          </section>
        </>
      )}
    </>
  )
}

function FindingList({ findings, currency, clientId, canProposeAdvanced, locale }: { findings: AnalysisFinding[]; currency: string; clientId: string; canProposeAdvanced: boolean; locale: 'fr' | 'en' }) {
  const english = locale === 'en'
  if (!findings.length) {
    return (
      <div className="rounded-2xl border border-dashed bg-[#f7faf9] p-10 text-center">
        <ShieldCheck className="mx-auto size-7 text-emerald-600" />
        <p className="mt-3 font-medium">{english ? 'Nothing to report in this category' : 'Rien à signaler dans cette catégorie'}</p>
        <p className="mt-1 text-sm text-muted-foreground">{english ? 'Data from the last 30 days does not exceed any threshold.' : 'Les données des 30 derniers jours ne dépassent aucun seuil.'}</p>
      </div>
    )
  }
  return (
    <div className="space-y-3">
      {findings.map((finding) => (
        <article key={finding.id} className="rounded-2xl border border-[#e1e7e9] p-4 sm:p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex min-w-0 gap-3">
              <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-xl bg-[#eef7f3] text-[#19A58F]">
                <Lightbulb className="size-4" />
              </span>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-semibold">{finding.title}</h3>
                  <PriorityBadge priority={finding.priority} locale={locale} />
                </div>
                <p className="mt-1 text-xs font-medium text-[#7b858c]">
                  {finding.campaignName ? `${finding.campaignName} · ` : ''}{finding.entityLabel}
                </p>
                <p className="mt-3 text-sm leading-6 text-[#5e6971]">{finding.description}</p>
                <p className="mt-3 rounded-xl bg-[#f5f8f8] px-3 py-2.5 text-sm leading-5 text-[#334149]">
                  <span className="font-semibold">{english ? 'Recommended action' : 'Action recommandée'} :</span> {finding.recommendation}
                </p>
                {canProposeAdvanced && <WorkflowForm finding={finding} clientId={clientId} locale={locale} />}
              </div>
            </div>
            <span className="shrink-0 text-sm font-semibold">
              {finding.valueKind === 'money'
                ? new Intl.NumberFormat(english ? 'en-GB' : 'fr-FR', { style: 'currency', currency }).format(finding.value)
                : finding.valueKind === 'score'
                  ? `${finding.value}/10`
                  : finding.value}
            </span>
          </div>
        </article>
      ))}
    </div>
  )
}

function WorkflowForm({ finding, clientId, locale }: { finding: AnalysisFinding; clientId: string; locale: 'fr' | 'en' }) {
  const english = locale === 'en'
  if (!finding.suggestedWorkflow || !finding.campaignId || !finding.campaignName || !finding.adGroupId) return null
  if (finding.suggestedWorkflow === 'keyword_create_negative' || finding.suggestedWorkflow === 'keyword_create_positive') {
    return (
      <form action={requestGoogleAdsChange} className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-emerald-100 bg-emerald-50/50 p-3">
        <input type="hidden" name="kind" value={finding.suggestedWorkflow} />
        <input type="hidden" name="clientId" value={clientId} />
        <input type="hidden" name="campaignId" value={finding.campaignId} />
        <input type="hidden" name="campaignName" value={finding.campaignName} />
        <input type="hidden" name="adGroupId" value={finding.adGroupId} />
        <input type="hidden" name="adGroupName" value={finding.adGroupName ?? (english ? 'Ad group' : 'Groupe d’annonces')} />
        <input type="hidden" name="keywordText" value={finding.entityLabel} />
        {finding.suggestedWorkflow === 'keyword_create_negative' ? (
          <label className="text-xs font-medium">{english ? 'Scope' : 'Portée'} <select name="scope" defaultValue="ad_group" className="ml-1 h-8 rounded-lg border bg-white px-2" aria-label={english ? 'Negative keyword scope' : 'Portée du mot-clé négatif'}><option value="ad_group">{english ? 'Ad group' : 'Groupe d’annonces'}</option><option value="campaign">{english ? 'Whole campaign' : 'Campagne entière'}</option><option value="account">{english ? 'Whole account' : 'Compte entier'}</option></select></label>
        ) : <input type="hidden" name="scope" value="ad_group" />}
        <label className="text-xs font-medium">{english ? 'Match' : 'Correspondance'} <select name="matchType" defaultValue="PHRASE" className="ml-1 h-8 rounded-lg border bg-white px-2" aria-label={english ? 'Match type' : 'Type de correspondance'}><option value="EXACT">{english ? 'Exact' : 'Exacte'}</option><option value="PHRASE">{english ? 'Phrase' : 'Expression'}</option><option value="BROAD">{english ? 'Broad' : 'Large'}</option></select></label>
        <Button type="submit" size="sm" variant="outline">
          {finding.suggestedWorkflow === 'keyword_create_negative' ? (english ? 'Propose as negative' : 'Proposer en négatif') : (english ? 'Propose as keyword' : 'Proposer comme mot-clé')}
        </Button>
      </form>
    )
  }
  if (finding.suggestedWorkflow === 'keyword_status' && finding.criterionId) {
    return (
      <form action={requestGoogleAdsChange} className="mt-3">
        <input type="hidden" name="kind" value="keyword_status" /><input type="hidden" name="clientId" value={clientId} />
        <input type="hidden" name="campaignId" value={finding.campaignId} /><input type="hidden" name="campaignName" value={finding.campaignName} />
        <input type="hidden" name="adGroupId" value={finding.adGroupId} /><input type="hidden" name="criterionId" value={finding.criterionId} />
        <input type="hidden" name="status" value="PAUSED" />
        <Button type="submit" size="sm" variant="outline">{english ? 'Propose pause' : 'Proposer une suspension'}</Button>
      </form>
    )
  }
  if (finding.suggestedWorkflow === 'ad_status' && finding.adId) {
    return (
      <div className="mt-3 space-y-3">
        <form action={requestGoogleAdsChange}>
          <input type="hidden" name="kind" value="ad_status" /><input type="hidden" name="clientId" value={clientId} />
          <input type="hidden" name="campaignId" value={finding.campaignId} /><input type="hidden" name="campaignName" value={finding.campaignName} />
          <input type="hidden" name="adGroupId" value={finding.adGroupId} /><input type="hidden" name="adId" value={finding.adId} />
          <input type="hidden" name="status" value="PAUSED" />
          <Button type="submit" size="sm" variant="outline">{english ? 'Propose pause' : 'Proposer une suspension'}</Button>
        </form>
        <details className="rounded-xl border bg-white p-3 text-sm">
          <summary className="cursor-pointer font-medium">{english ? 'Prepare a new paused RSA draft' : 'Préparer un nouveau draft RSA en pause'}</summary>
          <form action={requestGoogleAdsChange} className="mt-3 grid gap-2">
            <input type="hidden" name="kind" value="rsa_create_draft" /><input type="hidden" name="clientId" value={clientId} />
            <input type="hidden" name="campaignId" value={finding.campaignId} /><input type="hidden" name="campaignName" value={finding.campaignName} />
            <input type="hidden" name="adGroupId" value={finding.adGroupId} /><input type="hidden" name="adGroupName" value={finding.adGroupName ?? (english ? 'Ad group' : 'Groupe d’annonces')} />
            <textarea name="headlines" required minLength={5} maxLength={500} rows={4} className="rounded-lg border p-2 text-xs" placeholder={english ? '3 to 15 headlines, one per line\nMaximum 30 characters per headline' : '3 à 15 titres, un par ligne\nMaximum 30 caractères par titre'} />
            <textarea name="descriptions" required minLength={5} maxLength={500} rows={3} className="rounded-lg border p-2 text-xs" placeholder={english ? '2 to 4 descriptions, one per line\nMaximum 90 characters per description' : '2 à 4 descriptions, une par ligne\nMaximum 90 caractères par description'} />
            <input name="finalUrl" type="url" required pattern="https://.*" className="h-9 rounded-lg border px-2 text-xs" placeholder="https://example.com/landing-page" />
            <Button type="submit" size="sm" variant="outline">{english ? 'Validate and propose draft' : 'Valider et proposer le draft'}</Button>
          </form>
        </details>
      </div>
    )
  }
  return null
}

function PriorityBadge({ priority, locale }: { priority: AnalysisFinding['priority']; locale: 'fr' | 'en' }) {
  const labels = locale === 'en' ? { critical: 'Critical', high: 'Priority', medium: 'Optimize' } : { critical: 'Critique', high: 'Prioritaire', medium: 'À optimiser' }
  return (
    <Badge variant={priority === 'critical' ? 'destructive' : priority === 'high' ? 'secondary' : 'outline'}>
      {labels[priority]}
    </Badge>
  )
}

function SummaryCard({
  label,
  value,
  note,
  icon: Icon,
}: {
  label: string
  value: string
  note: string
  icon: typeof Target
}) {
  return (
    <Card className="border-[#dce5e8] shadow-none">
      <CardContent className="p-5">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium text-muted-foreground">{label}</p>
          <Icon className="size-4 text-[#19A58F]" />
        </div>
        <p className="mt-4 text-2xl font-semibold tracking-tight">{value}</p>
        <p className="mt-1 truncate text-xs text-muted-foreground">{note}</p>
      </CardContent>
    </Card>
  )
}

function InventoryCard({ title, value, description, icon: Icon }: { title: string; value: number; description: string; icon: typeof Target }) {
  return (
    <Card className="border-[#dce5e8] shadow-none">
      <CardContent className="flex gap-4 p-5">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[#e9fbf3] text-[#176646]">
          <Icon className="size-5" />
        </span>
        <div>
          <p className="text-sm font-semibold">{title}</p>
          <p className="mt-1 text-2xl font-semibold">{formatInteger(value)}</p>
          <p className="mt-2 text-xs leading-5 text-muted-foreground">{description}</p>
        </div>
      </CardContent>
    </Card>
  )
}

function trackingLabel(status: string, locale: 'fr' | 'en') {
  if (status === 'CONVERSION_TRACKING_MANAGED_BY_THIS_CLIENT') return locale === 'en' ? 'managed by account' : 'géré par le compte'
  if (status === 'CONVERSION_TRACKING_MANAGED_BY_MANAGER') return locale === 'en' ? 'managed by MCC' : 'géré par le MCC'
  return locale === 'en' ? 'tracking to verify' : 'tracking à vérifier'
}
