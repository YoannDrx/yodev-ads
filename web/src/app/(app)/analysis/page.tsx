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
import { requireWorkspace } from '@/lib/workspace'

type AnalysisPageProps = { searchParams: Promise<{ client?: string; notice?: string; error?: string }> }

const categories: Array<{ value: AnalysisCategory | 'all'; label: string; icon: typeof SearchCheck }> = [
  { value: 'all', label: 'Priorités', icon: Sparkles },
  { value: 'search_terms', label: 'Requêtes', icon: SearchCheck },
  { value: 'keywords', label: 'Mots-clés', icon: Target },
  { value: 'ads', label: 'Annonces', icon: FileSearch },
  { value: 'tracking', label: 'Tracking', icon: ShieldCheck },
]

export default async function AnalysisPage({ searchParams }: AnalysisPageProps) {
  const query = await searchParams
  const { workspace } = await requireWorkspace()
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
    } catch (error) {
      apiError = error instanceof Error ? error.message : 'Impossible d’exécuter l’analyse Google Ads.'
    }
  }

  const analysis = data ? analyzeAccount(data) : undefined
  const currency = client?.currencyCode ?? 'EUR'

  return (
    <>
      <PageHeading
        eyebrow="Intelligence Google Ads · 30 jours"
        title="Analyse 360"
        description="Ads by Yodev croise les requêtes, le Quality Score, les annonces responsives et le tracking pour prioriser les actions qui comptent."
        actions={
          clients.length ? (
            <form className="flex gap-2">
              <select
                name="client"
                defaultValue={client?.id}
                className="h-10 min-w-56 rounded-lg border bg-white px-3 text-sm"
                aria-label="Compte client"
              >
                {clients
                  .filter((item) => !item.isManager)
                  .map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
              </select>
              <Button type="submit">Actualiser</Button>
            </form>
          ) : undefined
        }
      />
      <FlashMessage notice={query.notice} error={query.error ?? apiError} />

      {!connection || !client || !data || !analysis ? (
        <EmptyState
          title={connection ? 'Aucun compte analysable' : 'Connectez Google Ads pour lancer l’analyse'}
          description={
            connection
              ? 'Synchronisez au moins un compte client depuis les réglages.'
              : 'L’analyse utilise uniquement l’API officielle Google Ads et reste en lecture seule.'
          }
        />
      ) : (
        <>
          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
            <Card className="border-0 bg-[#0d1722] text-white shadow-none sm:col-span-2 xl:col-span-1">
              <CardContent className="p-5">
                <p className="text-xs font-semibold uppercase tracking-[.16em] text-[#19A58F]">Score d’opportunité</p>
                <div className="mt-5 flex items-end gap-2">
                  <span className="text-5xl font-semibold tracking-[-.06em]">{analysis.score}</span>
                  <span className="mb-1 text-sm text-white/45">/ 100</span>
                </div>
                <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-white/10">
                  <div className="h-full rounded-full bg-[#19A58F]" style={{ width: `${analysis.score}%` }} />
                </div>
                <p className="mt-3 text-xs leading-5 text-white/50">Score explicable, calculé à partir des anomalies visibles ci-dessous.</p>
              </CardContent>
            </Card>
            <SummaryCard
              label="Gaspillage potentiel"
              value={formatMoneyFromMicros(analysis.summary.wastedSpendMicros, currency)}
              note="requêtes sans conversion"
              icon={MousePointerClick}
            />
            <SummaryCard
              label="Mots-clés faibles"
              value={formatInteger(analysis.summary.weakKeywords)}
              note="Quality Score ≤ 5"
              icon={Target}
            />
            <SummaryCard
              label="Annonces à renforcer"
              value={formatInteger(analysis.summary.weakAds)}
              note="force ou conformité"
              icon={FileSearch}
            />
            <SummaryCard
              label="Points de mesure"
              value={formatInteger(analysis.summary.trackingIssues)}
              note={trackingLabel(data.conversionTracking.status)}
              icon={ShieldCheck}
            />
          </section>

          <section className="mt-6 rounded-3xl border border-[#dce5e8] bg-white p-5 sm:p-7">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[.16em] text-[#19A58F]">Plan d’action priorisé</p>
                <h2 className="mt-2 text-xl font-semibold tracking-tight">
                  {analysis.findings.length
                    ? `${analysis.findings.length} opportunité${analysis.findings.length > 1 ? 's' : ''} détectée${analysis.findings.length > 1 ? 's' : ''}`
                    : 'Aucun signal critique détecté'}
                </h2>
              </div>
              <Button asChild variant="outline">
                <Link href="/agents">
                  <CircleGauge className="mr-2 size-4" /> Automatiser la surveillance
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
                    <FindingList findings={findings} currency={currency} />
                  </TabsContent>
                )
              })}
            </Tabs>
          </section>

          <section className="mt-6 grid gap-4 xl:grid-cols-3">
            <InventoryCard
              title="Couverture des requêtes"
              value={data.searchTerms.length}
              description={`${data.searchTerms.filter((term) => term.conversions > 0).length} termes ont généré au moins une conversion.`}
              icon={SearchCheck}
            />
            <InventoryCard
              title="Portefeuille de mots-clés"
              value={data.keywords.length}
              description={`${data.keywords.filter((keyword) => keyword.qualityScore !== null).length} mots-clés disposent d’un Quality Score exploitable.`}
              icon={ChartNoAxesCombined}
            />
            <InventoryCard
              title="Créations responsives"
              value={data.ads.length}
              description={`${data.ads.filter((ad) => ad.approvalStatus === 'APPROVED').length} annonces sont approuvées par Google.`}
              icon={BadgeAlert}
            />
          </section>
        </>
      )}
    </>
  )
}

function FindingList({ findings, currency }: { findings: AnalysisFinding[]; currency: string }) {
  if (!findings.length) {
    return (
      <div className="rounded-2xl border border-dashed bg-[#f7faf9] p-10 text-center">
        <ShieldCheck className="mx-auto size-7 text-emerald-600" />
        <p className="mt-3 font-medium">Rien à signaler dans cette catégorie</p>
        <p className="mt-1 text-sm text-muted-foreground">Les données des 30 derniers jours ne dépassent aucun seuil.</p>
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
                  <PriorityBadge priority={finding.priority} />
                </div>
                <p className="mt-1 text-xs font-medium text-[#7b858c]">
                  {finding.campaignName ? `${finding.campaignName} · ` : ''}{finding.entityLabel}
                </p>
                <p className="mt-3 text-sm leading-6 text-[#5e6971]">{finding.description}</p>
                <p className="mt-3 rounded-xl bg-[#f5f8f8] px-3 py-2.5 text-sm leading-5 text-[#334149]">
                  <span className="font-semibold">Action recommandée :</span> {finding.recommendation}
                </p>
              </div>
            </div>
            <span className="shrink-0 text-sm font-semibold">
              {finding.valueKind === 'money'
                ? new Intl.NumberFormat('fr-FR', { style: 'currency', currency }).format(finding.value)
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

function PriorityBadge({ priority }: { priority: AnalysisFinding['priority'] }) {
  const labels = { critical: 'Critique', high: 'Prioritaire', medium: 'À optimiser' }
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

function trackingLabel(status: string) {
  if (status === 'CONVERSION_TRACKING_MANAGED_BY_THIS_CLIENT') return 'géré par le compte'
  if (status === 'CONVERSION_TRACKING_MANAGED_BY_MANAGER') return 'géré par le MCC'
  return 'tracking à vérifier'
}
