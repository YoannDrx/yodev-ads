import { Activity, CalendarDays, MousePointerClick, ReceiptText, Target } from 'lucide-react'
import { PageHeading } from '@/components/page-heading'
import { Card, CardContent } from '@/components/ui/card'
import { getWorkspaceClient, listWorkspaceClients } from '@/lib/data'
import { formatInteger, formatMoneyFromMicros } from '@/lib/format'
import { listPerformanceHistory } from '@/lib/performance-history'
import { requireWorkspace } from '@/lib/workspace'

export default async function HistoryPage({ searchParams }: { searchParams: Promise<{ client?: string }> }) {
  const query = await searchParams
  const { workspace } = await requireWorkspace()
  const [clients, client] = await Promise.all([
    listWorkspaceClients(workspace.id),
    getWorkspaceClient(workspace.id, query.client),
  ])
  const history = client ? await listPerformanceHistory(workspace.id, client.id) : []
  const latest = history.at(-1)
  const oldest = history.at(0)
  const delta = (key: 'costMicros' | 'clicks' | 'conversions') => {
    if (!latest || !oldest || Number(oldest[key]) === 0) return null
    return ((Number(latest[key]) - Number(oldest[key])) / Number(oldest[key])) * 100
  }
  return (
    <>
      <PageHeading
        eyebrow="Mémoire Neon"
        title="Historique de performance"
        description="Conservez un point quotidien des 30 derniers jours Google Ads pour suivre les tendances au-delà de la fenêtre de reporting live."
        actions={
          clients.length ? (
            <form>
              <select name="client" defaultValue={client?.id} aria-label="Compte client" className="h-10 rounded-lg border bg-white px-3 text-sm">
                {clients
                  .filter((item) => !item.isManager)
                  .map((item) => (
                    <option key={item.id} value={item.id}>{item.name}</option>
                  ))}
              </select>
              <button className="ml-2 h-10 rounded-lg border bg-white px-4 text-sm">Afficher</button>
            </form>
          ) : undefined
        }
      />
      {latest ? (
        <>
          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <HistoryMetric icon={ReceiptText} label="Investissement 30 j" value={formatMoneyFromMicros(latest.costMicros, latest.currencyCode)} delta={delta('costMicros')} />
            <HistoryMetric icon={Target} label="Conversions 30 j" value={Number(latest.conversions).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} delta={delta('conversions')} />
            <HistoryMetric icon={MousePointerClick} label="Clics 30 j" value={formatInteger(latest.clicks)} delta={delta('clicks')} />
            <HistoryMetric icon={Activity} label="Campagnes actives" value={String(latest.activeCampaigns)} delta={null} />
          </section>
          <Card className="mt-6 border-[#dde4e7] shadow-none">
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-[#f7f9fa] text-left text-xs uppercase tracking-wider text-muted-foreground">
                    <tr><th className="px-5 py-3">Date</th><th className="px-4 py-3 text-right">Coût 30 j</th><th className="px-4 py-3 text-right">Impressions</th><th className="px-4 py-3 text-right">Clics</th><th className="px-5 py-3 text-right">Conversions</th></tr>
                  </thead>
                  <tbody className="divide-y">
                    {[...history].reverse().map((point) => (
                      <tr key={point.id} className="bg-white">
                        <td className="px-5 py-3 font-medium">{new Date(`${point.snapshotDate}T12:00:00Z`).toLocaleDateString('fr-FR')}</td>
                        <td className="px-4 py-3 text-right">{formatMoneyFromMicros(point.costMicros, point.currencyCode)}</td>
                        <td className="px-4 py-3 text-right">{formatInteger(point.impressions)}</td>
                        <td className="px-4 py-3 text-right">{formatInteger(point.clicks)}</td>
                        <td className="px-5 py-3 text-right">{Number(point.conversions).toLocaleString('fr-FR', { maximumFractionDigits: 1 })}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      ) : (
        <div className="rounded-3xl border border-dashed bg-white p-14 text-center text-muted-foreground">
          <CalendarDays className="mx-auto mb-4 size-8" />
          Le premier point sera enregistré lors de la prochaine exécution d’une vigie.
        </div>
      )}
    </>
  )
}

function HistoryMetric({ icon: Icon, label, value, delta }: { icon: typeof Activity; label: string; value: string; delta: number | null }) {
  return (
    <Card className="border-[#dde4e7] shadow-none">
      <CardContent className="p-5">
        <div className="flex items-center justify-between">
          <div><p className="text-sm text-muted-foreground">{label}</p><p className="mt-2 text-2xl font-semibold">{value}</p></div>
          <Icon className="size-5 text-[var(--brand-accent)]" />
        </div>
        {delta !== null && <p className={`mt-3 text-xs ${delta >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>{delta >= 0 ? '+' : ''}{delta.toFixed(1)} % depuis le premier point</p>}
      </CardContent>
    </Card>
  )
}
