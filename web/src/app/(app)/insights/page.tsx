import { BarChart3, Boxes, Clock3, Crosshair, MapPinned, MonitorSmartphone, PackageSearch, UsersRound, Video } from 'lucide-react'
import { EmptyState } from '@/components/empty-state'
import { PageHeading } from '@/components/page-heading'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { getWorkspaceClient, getWorkspaceConnection, listWorkspaceClients } from '@/lib/data'
import { formatInteger, formatMoneyFromMicros, formatPercent } from '@/lib/format'
import { GoogleAdsGateway, type BreakdownPerformance } from '@/lib/google-ads'
import { requireWorkspace } from '@/lib/workspace'

type InsightsPageProps = { searchParams: Promise<{ client?: string }> }

function PerformanceTable({ rows, currency, locale }: { rows: BreakdownPerformance[]; currency: string; locale: 'fr' | 'en' }) {
  const english = locale === 'en'
  if (!rows.length) return <p className="p-5 text-sm text-muted-foreground">{english ? 'No sufficient data over the last 30 days.' : 'Aucune donnée suffisante sur les 30 derniers jours.'}</p>
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-muted-foreground"><tr><th className="px-4 py-3">Segment</th><th className="px-4 py-3 text-right">Impressions</th><th className="px-4 py-3 text-right">{english ? 'Clicks' : 'Clics'}</th><th className="px-4 py-3 text-right">{english ? 'Cost' : 'Coût'}</th><th className="px-4 py-3 text-right">Conv.</th><th className="px-4 py-3 text-right">{english ? 'Value' : 'Valeur'}</th></tr></thead>
        <tbody className="divide-y">
          {rows.slice(0, 100).map((row) => <tr key={row.key}><td className="px-4 py-3 font-medium">{row.label}</td><td className="px-4 py-3 text-right">{formatInteger(row.impressions)}</td><td className="px-4 py-3 text-right">{formatInteger(row.clicks)}</td><td className="px-4 py-3 text-right">{formatMoneyFromMicros(row.costMicros, currency)}</td><td className="px-4 py-3 text-right">{row.conversions.toLocaleString(english ? 'en-GB' : 'fr-FR')}</td><td className="px-4 py-3 text-right">{formatMoneyFromMicros(row.conversionValueMicros, currency)}</td></tr>)}
        </tbody>
      </table>
    </div>
  )
}

function SectionError({ message, locale }: { message?: string; locale: 'fr' | 'en' }) {
  return message ? <p className="border-t bg-amber-50 px-5 py-3 text-xs text-amber-800">{locale === 'en' ? 'Section unavailable' : 'Section indisponible'} : {message}</p> : null
}

export default async function InsightsPage({ searchParams }: InsightsPageProps) {
  const query = await searchParams
  const { workspace } = await requireWorkspace()
  const english = workspace.locale === 'en'
  const locale = english ? 'en' : 'fr'
  const [connection, clients] = await Promise.all([getWorkspaceConnection(workspace.id), listWorkspaceClients(workspace.id)])
  const client = await getWorkspaceClient(workspace.id, query.client)
  const errors: Record<string, string> = {}
  let devices: Awaited<ReturnType<GoogleAdsGateway['devicePerformance']>> = []
  let schedules: Awaited<ReturnType<GoogleAdsGateway['schedulePerformance']>> = []
  let geographies: Awaited<ReturnType<GoogleAdsGateway['geographicPerformance']>> = []
  let auctions: Awaited<ReturnType<GoogleAdsGateway['auctionInsights']>> = []
  let placements: Awaited<ReturnType<GoogleAdsGateway['performanceMaxPlacements']>> = []
  let assetGroups: Awaited<ReturnType<GoogleAdsGateway['assetGroupPerformance']>> = []
  let assets: Awaited<ReturnType<GoogleAdsGateway['assetPerformance']>> = []
  let products: Awaited<ReturnType<GoogleAdsGateway['shoppingProductPerformance']>> = []
  let productDiagnostics: Awaited<ReturnType<GoogleAdsGateway['shoppingProductDiagnostics']>> = []
  let audiences: Awaited<ReturnType<GoogleAdsGateway['campaignAudiencePerformance']>> = []
  let adGroupAudiences: Awaited<ReturnType<GoogleAdsGateway['adGroupAudiencePerformance']>> = []
  let groupPlacements: Awaited<ReturnType<GoogleAdsGateway['groupPlacementPerformance']>> = []

  if (connection && client) {
    const gateway = new GoogleAdsGateway(connection)
    const names = ['devices', 'schedules', 'geographies', 'auctions', 'placements', 'assetGroups', 'assets', 'products', 'productDiagnostics', 'audiences', 'adGroupAudiences', 'groupPlacements'] as const
    const localDate = new Intl.DateTimeFormat('en-CA', { timeZone: client.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
    const results = await Promise.allSettled([
      gateway.devicePerformance(client.googleCustomerId),
      gateway.schedulePerformance(client.googleCustomerId),
      gateway.geographicPerformance(client.googleCustomerId),
      gateway.auctionInsights(client.googleCustomerId),
      gateway.performanceMaxPlacements(client.googleCustomerId),
      gateway.assetGroupPerformance(client.googleCustomerId),
      gateway.assetPerformance(client.googleCustomerId, localDate),
      gateway.shoppingProductPerformance(client.googleCustomerId),
      gateway.shoppingProductDiagnostics(client.googleCustomerId),
      gateway.campaignAudiencePerformance(client.googleCustomerId),
      gateway.adGroupAudiencePerformance(client.googleCustomerId),
      gateway.groupPlacementPerformance(client.googleCustomerId),
    ])
    results.forEach((result, index) => {
      if (result.status === 'rejected') errors[names[index]] = result.reason instanceof Error ? result.reason.message : english ? 'Google Ads error' : 'Erreur Google Ads'
    })
    if (results[0].status === 'fulfilled') devices = results[0].value
    if (results[1].status === 'fulfilled') schedules = results[1].value
    if (results[2].status === 'fulfilled') geographies = results[2].value
    if (results[3].status === 'fulfilled') auctions = results[3].value
    if (results[4].status === 'fulfilled') placements = results[4].value
    if (results[5].status === 'fulfilled') assetGroups = results[5].value
    if (results[6].status === 'fulfilled') assets = results[6].value
    if (results[7].status === 'fulfilled') products = results[7].value
    if (results[8].status === 'fulfilled') productDiagnostics = results[8].value
    if (results[9].status === 'fulfilled') audiences = results[9].value
    if (results[10].status === 'fulfilled') adGroupAudiences = results[10].value
    if (results[11].status === 'fulfilled') groupPlacements = results[11].value
  }
  const currency = client?.currencyCode ?? 'EUR'

  return (
    <>
      <PageHeading eyebrow={english ? 'Google Ads v25 · read only' : 'Google Ads v25 · lecture seule'} title={english ? 'Extended insights' : 'Insights étendus'} description={english ? 'Separate views by device, schedule, location, auction, Performance Max and Shopping—without extrapolating Search metrics to other campaign types.' : 'Des vues distinctes par appareil, horaire, zone, enchères, Performance Max et Shopping — sans extrapoler les métriques Search aux autres types de campagne.'} actions={clients.length ? <form className="flex gap-2"><select name="client" defaultValue={client?.id} className="h-10 min-w-56 rounded-lg border bg-white px-3 text-sm">{clients.filter((item) => !item.isManager).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><Button type="submit">{english ? 'Refresh' : 'Actualiser'}</Button></form> : undefined} />
      {!connection || !client ? <EmptyState title={connection ? (english ? 'No account available for analysis' : 'Aucun compte analysable') : (english ? 'Connect Google Ads' : 'Connectez Google Ads')} description={english ? 'Insights use official Google Ads v25 reports and perform no mutations.' : 'Les insights utilisent les rapports officiels Google Ads v25 et ne réalisent aucune mutation.'} /> : (
        <Tabs defaultValue="segments">
          <TabsList className="mb-5 flex h-auto flex-wrap"><TabsTrigger value="segments"><BarChart3 /> Segments</TabsTrigger><TabsTrigger value="audiences"><UsersRound /> Audiences</TabsTrigger><TabsTrigger value="placements"><Video /> Display/YouTube</TabsTrigger><TabsTrigger value="auction"><Crosshair /> {english ? 'Auctions' : 'Enchères'}</TabsTrigger><TabsTrigger value="pmax"><Video /> Performance Max</TabsTrigger><TabsTrigger value="shopping"><PackageSearch /> Shopping</TabsTrigger></TabsList>
          <TabsContent value="segments" className="space-y-5">
            <Card><CardHeader><CardTitle className="flex items-center gap-2"><MonitorSmartphone className="size-5" />{english ? 'Devices' : 'Appareils'}</CardTitle></CardHeader><CardContent className="p-0"><PerformanceTable rows={devices} currency={currency} locale={locale} /><SectionError message={errors.devices} locale={locale} /></CardContent></Card>
            <Card><CardHeader><CardTitle className="flex items-center gap-2"><Clock3 className="size-5" />{english ? 'Days and hours' : 'Jours et heures'}</CardTitle></CardHeader><CardContent className="p-0"><PerformanceTable rows={schedules} currency={currency} locale={locale} /><SectionError message={errors.schedules} locale={locale} /></CardContent></Card>
            <Card><CardHeader><CardTitle className="flex items-center gap-2"><MapPinned className="size-5" />{english ? 'Geographies' : 'Géographies'}</CardTitle><p className="text-sm text-muted-foreground">{english ? 'Countries are identified by the Google geographic criterion so that no local label is invented.' : 'Le pays est identifié par le critère géographique Google afin de ne pas inventer un libellé local.'}</p></CardHeader><CardContent className="p-0"><PerformanceTable rows={geographies} currency={currency} locale={locale} /><SectionError message={errors.geographies} locale={locale} /></CardContent></Card>
          </TabsContent>
          <TabsContent value="audiences" className="space-y-5"><Card><CardHeader><CardTitle>{english ? 'Campaign-level audiences' : 'Audiences rattachées au niveau campagne'}</CardTitle><p className="text-sm text-muted-foreground">{english ? 'Display and YouTube interests/lists and Search remarketing lists aggregated at campaign level.' : 'Intérêts/listes Display et YouTube, et listes de remarketing Search agrégés au niveau campagne.'}</p></CardHeader><CardContent className="p-0"><PerformanceTable rows={audiences} currency={currency} locale={locale} /><SectionError message={errors.audiences} locale={locale} /></CardContent></Card><Card><CardHeader><CardTitle>{english ? 'Ad-group-level audiences' : 'Audiences rattachées au groupe d’annonces'}</CardTitle><p className="text-sm text-muted-foreground">{english ? 'Official `ad_group_audience_view`, kept separate to avoid mixing two aggregation levels.' : 'Vue officielle `ad_group_audience_view`, séparée pour éviter de mélanger deux niveaux d’agrégation.'}</p></CardHeader><CardContent className="p-0"><PerformanceTable rows={adGroupAudiences} currency={currency} locale={locale} /><SectionError message={errors.adGroupAudiences} locale={locale} /></CardContent></Card></TabsContent>
          <TabsContent value="placements"><Card><CardHeader><CardTitle>{english ? 'Where Display and YouTube ads served' : 'Où les annonces Display et YouTube ont diffusé'}</CardTitle><p className="text-sm text-muted-foreground">{english ? 'The “Other” row may aggregate low Google volumes, so placement totals may differ from campaign totals.' : 'La ligne « Other » peut agréger les faibles volumes Google ; la somme des placements peut donc différer du total campagne.'}</p></CardHeader><CardContent className="p-0"><PerformanceTable rows={groupPlacements} currency={currency} locale={locale} /><SectionError message={errors.groupPlacements} locale={locale} /></CardContent></Card></TabsContent>
          <TabsContent value="auction">
            <Card><CardHeader><CardTitle>{english ? 'Search competition by campaign' : 'Concurrence Search par campagne'}</CardTitle><p className="text-sm text-muted-foreground">{english ? 'Rates come from Auction Insights and are not estimates for PMax, Display or Shopping.' : 'Les taux sont fournis par Auction Insights et ne constituent pas une estimation pour PMax, Display ou Shopping.'}</p></CardHeader><CardContent className="p-0">{auctions.length ? <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-muted-foreground"><tr><th className="px-4 py-3">{english ? 'Domain' : 'Domaine'}</th><th className="px-4 py-3">{english ? 'Campaign' : 'Campagne'}</th><th className="px-4 py-3 text-right">{english ? 'Impr. share' : 'Part impr.'}</th><th className="px-4 py-3 text-right">{english ? 'Overlap' : 'Chevauchement'}</th><th className="px-4 py-3 text-right">{english ? 'Position above' : 'Au-dessus'}</th><th className="px-4 py-3 text-right">{english ? 'Outranking' : 'Surclassement'}</th></tr></thead><tbody className="divide-y">{auctions.slice(0, 100).map((row) => <tr key={`${row.campaignId}:${row.domain}`}><td className="px-4 py-3 font-medium">{row.domain}</td><td className="px-4 py-3">{row.campaignName}</td><td className="px-4 py-3 text-right">{row.impressionShare === null ? '—' : formatPercent(row.impressionShare)}</td><td className="px-4 py-3 text-right">{row.overlapRate === null ? '—' : formatPercent(row.overlapRate)}</td><td className="px-4 py-3 text-right">{row.positionAboveRate === null ? '—' : formatPercent(row.positionAboveRate)}</td><td className="px-4 py-3 text-right">{row.outrankingShare === null ? '—' : formatPercent(row.outrankingShare)}</td></tr>)}</tbody></table></div> : <p className="p-5 text-sm text-muted-foreground">{english ? 'Insufficient or ineligible data.' : 'Données insuffisantes ou non éligibles.'}</p>}<SectionError message={errors.auctions} locale={locale} /></CardContent></Card>
          </TabsContent>
          <TabsContent value="pmax" className="space-y-5">
            <Card><CardHeader><CardTitle className="flex items-center gap-2"><Boxes className="size-5" />Asset groups</CardTitle></CardHeader><CardContent className="p-0"><PerformanceTable rows={assetGroups} currency={currency} locale={locale} /><SectionError message={errors.assetGroups} locale={locale} /></CardContent></Card>
            <Card><CardHeader><CardTitle>{english ? 'Asset performance and temporal signal' : 'Performance des assets et signal temporel'}</CardTitle><p className="text-sm text-muted-foreground">{english ? 'Compares the last 15 days with the previous 15. “Review” flags a CTR drop of at least 25% with minimum volume; it is never proof of fatigue or causation.' : 'Comparaison des 15 derniers jours aux 15 précédents. « À examiner » signale une baisse de CTR d’au moins 25 % avec volume minimal ; ce n’est jamais une preuve de fatigue ni de causalité.'}</p></CardHeader><CardContent className="p-0">{assets.length ? <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-muted-foreground"><tr><th className="px-4 py-3">Asset</th><th className="px-4 py-3">Asset group</th><th className="px-4 py-3">{english ? 'Google label' : 'Libellé Google'}</th><th className="px-4 py-3 text-right">{english ? 'Impr. 30 d' : 'Impr. 30 j'}</th><th className="px-4 py-3 text-right">{english ? 'CTR change' : 'Évolution CTR'}</th><th className="px-4 py-3">Signal</th></tr></thead><tbody className="divide-y">{assets.slice(0, 200).map((asset) => <tr key={asset.key}><td className="px-4 py-3"><p className="font-medium">{asset.fieldType} · {asset.assetResourceName.split('/').at(-1)}</p><p className="text-xs text-muted-foreground">{asset.campaignName} · {asset.primaryStatus}</p></td><td className="px-4 py-3">{asset.assetGroupName}</td><td className="px-4 py-3"><Badge variant="outline">{asset.performanceLabel}</Badge></td><td className="px-4 py-3 text-right">{formatInteger(asset.impressions)}</td><td className="px-4 py-3 text-right">{asset.fatigue.ctrChange === null ? (english ? 'insufficient volume' : 'volume insuffisant') : formatPercent(asset.fatigue.ctrChange)}</td><td className="px-4 py-3"><Badge variant={asset.fatigue.status === 'review' ? 'destructive' : 'outline'}>{asset.fatigue.status === 'review' ? `${english ? 'Review' : 'À examiner'} · ${english ? 'confidence' : 'confiance'} ${asset.fatigue.confidence}` : asset.fatigue.status === 'stable' ? 'Stable' : (english ? 'Insufficient data' : 'Données insuffisantes')}</Badge></td></tr>)}</tbody></table></div> : <p className="p-5 text-sm text-muted-foreground">{english ? 'No measurable PMax asset.' : 'Aucun asset PMax mesurable.'}</p>}<SectionError message={errors.assets} locale={locale} /></CardContent></Card>
            <Card><CardHeader><CardTitle>PMax placements</CardTitle><p className="text-sm text-muted-foreground">{english ? 'Google exposes placement impressions here; Search metrics are not applied to this view.' : 'Google expose ici les impressions de placement ; les métriques Search ne sont pas appliquées à cette vue.'}</p></CardHeader><CardContent className="p-0">{placements.length ? <div className="divide-y">{placements.slice(0, 100).map((row) => <div key={`${row.campaignId}:${row.type}:${row.placement}`} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3"><div><p className="font-medium">{row.name}</p><p className="text-xs text-muted-foreground">{row.campaignName} · {row.type}</p></div><Badge variant="outline">{formatInteger(row.impressions)} {english ? 'impr.' : 'impr.'}</Badge></div>)}</div> : <p className="p-5 text-sm text-muted-foreground">{english ? 'No PMax placement available.' : 'Aucun placement PMax disponible.'}</p>}<SectionError message={errors.placements} locale={locale} /></CardContent></Card>
          </TabsContent>
          <TabsContent value="shopping">
            <div className="space-y-5">
              <Card><CardHeader><CardTitle>{english ? 'Current state of products that are not fully eligible' : 'État courant des produits non pleinement éligibles'}</CardTitle><p className="text-sm text-muted-foreground">{english ? 'Google Ads Shopping Product state may lag by up to 24 hours. Each help link indicates whether the fix belongs in Merchant Center or Google Ads.' : 'État Shopping Product Google Ads, susceptible d’avoir jusqu’à 24 h de retard. Chaque lien d’aide indique si la correction relève de Merchant Center ou de Google Ads.'}</p></CardHeader><CardContent className="p-0">{productDiagnostics.length ? <div className="divide-y">{productDiagnostics.slice(0, 100).map((product) => <div key={product.resourceName} className="p-5"><div className="flex flex-wrap items-center justify-between gap-2"><div><p className="font-medium">{product.title}</p><p className="mt-1 text-xs text-muted-foreground">{product.itemId} · Merchant {product.merchantId} · {product.languageCode}/{product.feedLabel}</p></div><Badge variant={product.status === 'NOT_ELIGIBLE' ? 'destructive' : 'outline'}>{product.status}</Badge></div>{product.issues.length ? <ul className="mt-3 space-y-2">{product.issues.map((issue) => <li key={`${issue.errorCode}:${issue.attributeName ?? ''}`} className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-900"><span className="font-semibold">{issue.description}</span>{issue.attributeName ? ` · ${english ? 'attribute' : 'attribut'} ${issue.attributeName}` : ''}{issue.affectedRegions.length ? ` · ${issue.affectedRegions.join(', ')}` : ''}{issue.documentation && <a href={issue.documentation} target="_blank" rel="noreferrer" className="ml-2 underline">{english ? 'Google help' : 'Aide Google'}</a>}</li>)}</ul> : <p className="mt-2 text-xs text-muted-foreground">{english ? 'Google provides no additional detail.' : 'Google ne fournit pas de détail supplémentaire.'}</p>}</div>)}</div> : <p className="p-5 text-sm text-muted-foreground">{english ? 'No ineligible or limited product detected.' : 'Aucun produit non éligible ou limité détecté.'}</p>}<SectionError message={errors.productDiagnostics} locale={locale} /></CardContent></Card>
              <Card><CardHeader><CardTitle>{english ? 'Products that served' : 'Produits ayant diffusé'}</CardTitle><p className="text-sm text-muted-foreground">{english ? 'Historical Shopping/PMax view. It remains separate from the current state above.' : 'Vue historique Shopping/PMax. Elle reste distincte de l’état courant ci-dessus.'}</p></CardHeader><CardContent className="p-0"><PerformanceTable rows={products} currency={currency} locale={locale} /><SectionError message={errors.products} locale={locale} /></CardContent></Card>
            </div>
          </TabsContent>
        </Tabs>
      )}
    </>
  )
}
