import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { Activity, Eye, MousePointerClick, ReceiptText, ShieldCheck, Target } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { getPublicShare } from '@/lib/data'
import { formatInteger, formatMoneyFromMicros, formatPercent } from '@/lib/format'
import { GoogleAdsGateway } from '@/lib/google-ads'

export const metadata: Metadata = { title: 'Rapport client', robots: { index: false, follow: false } }

export default async function PublicReportPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const result = await getPublicShare(token)
  if (!result) notFound()
  const campaigns = await new GoogleAdsGateway(result.connection).campaignPerformance(result.client.googleCustomerId)
  const totals = campaigns.reduce(
    (sum, campaign) => ({
      cost: sum.cost + Number(campaign.costMicros),
      clicks: sum.clicks + Number(campaign.clicks),
      impressions: sum.impressions + Number(campaign.impressions),
      conversions: sum.conversions + campaign.conversions,
    }),
    { cost: 0, clicks: 0, impressions: 0, conversions: 0 },
  )

  return (
    <main className="min-h-screen bg-[#f3f6f8] text-[#121b24]">
      <header className="border-b border-black/5 bg-[#0d1722] text-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5 sm:px-8">
          <div className="flex items-center gap-3">
            <VigieadsMark />
            <div>
              <p className="font-semibold">Vigieads</p>
              <p className="text-xs text-white/55">Rapport sécurisé</p>
            </div>
          </div>
          <span className="flex items-center gap-2 rounded-full bg-white/8 px-3 py-1.5 text-xs text-white/70">
            <Eye className="size-3.5" /> Lecture seule
          </span>
        </div>
      </header>
      <div className="mx-auto max-w-6xl px-5 py-10 sm:px-8 sm:py-14">
        <div className="flex flex-col gap-4 border-b border-black/8 pb-8 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[.18em] text-[#2f6b56]">Performance · 30 jours</p>
            <h1 className="mt-3 text-4xl font-semibold tracking-[-.045em]">{result.client.name}</h1>
            <p className="mt-2 text-sm text-[#63717d]">Données Google Ads actualisées à l’ouverture de ce rapport.</p>
          </div>
          <div className="flex items-center gap-2 text-xs text-[#517163]">
            <ShieldCheck className="size-4" /> Aucun accès au compte n’est accordé au lecteur.
          </div>
        </div>
        <section className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <ReportMetric
            label="Investissement"
            value={formatMoneyFromMicros(totals.cost, result.client.currencyCode)}
            icon={ReceiptText}
          />
          <ReportMetric label="Conversions" value={formatInteger(totals.conversions)} icon={Target} />
          <ReportMetric label="Clics" value={formatInteger(totals.clicks)} icon={MousePointerClick} />
          <ReportMetric
            label="CTR"
            value={totals.impressions ? formatPercent(totals.clicks / totals.impressions) : '—'}
            icon={Activity}
          />
        </section>
        <Card className="mt-6 overflow-hidden border-black/8 shadow-none">
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-[#f7f9fa] text-left text-xs uppercase tracking-wider text-[#74808a]">
                  <tr>
                    <th className="px-5 py-3">Campagne</th>
                    <th className="px-4 py-3">Statut</th>
                    <th className="px-4 py-3 text-right">Coût</th>
                    <th className="px-4 py-3 text-right">Clics</th>
                    <th className="px-5 py-3 text-right">Conversions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-black/6">
                  {campaigns.map((campaign) => (
                    <tr key={campaign.id}>
                      <td className="px-5 py-4 font-medium">{campaign.name}</td>
                      <td className="px-4 py-4 text-xs text-[#63717d]">
                        {campaign.status === 'ENABLED' ? 'Active' : 'En pause'}
                      </td>
                      <td className="px-4 py-4 text-right">
                        {formatMoneyFromMicros(campaign.costMicros, result.client.currencyCode)}
                      </td>
                      <td className="px-4 py-4 text-right">{formatInteger(campaign.clicks)}</td>
                      <td className="px-5 py-4 text-right">
                        {campaign.conversions.toLocaleString('fr-FR', { maximumFractionDigits: 1 })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
        <p className="mt-6 text-center text-xs text-[#8a959e]">
          Rapport généré par Vigieads · L’operating system Google Ads des agences
        </p>
      </div>
    </main>
  )
}

function ReportMetric({ label, value, icon: Icon }: { label: string; value: string; icon: typeof Activity }) {
  return (
    <Card className="border-black/8 shadow-none">
      <CardContent className="p-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-[#71808c]">{label}</p>
            <p className="mt-2 text-2xl font-semibold tracking-tight">{value}</p>
          </div>
          <span className="grid size-10 place-items-center rounded-xl bg-[#e6f8ef] text-[#1f7554]">
            <Icon className="size-5" />
          </span>
        </div>
      </CardContent>
    </Card>
  )
}

function VigieadsMark() {
  return (
    <span className="relative grid size-10 place-items-center overflow-hidden rounded-xl bg-[#76f1b3] text-[#0d1722]">
      <span className="absolute -top-2 h-5 w-7 rounded-full border-2 border-current" />
      <span className="mt-2 text-sm font-black">V</span>
    </span>
  )
}
