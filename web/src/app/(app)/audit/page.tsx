import { format } from 'date-fns'
import { fr } from 'date-fns/locale'
import { Fingerprint } from 'lucide-react'
import { PageHeading } from '@/components/page-heading'
import { Card, CardContent } from '@/components/ui/card'
import { listAuditEvents } from '@/lib/data'
import { requireWorkspace } from '@/lib/workspace'

const actionLabels: Record<string, string> = {
  'google_ads.connected': 'Connexion Google Ads établie',
  'google_ads.disconnected': 'Connexion Google Ads révoquée',
  'google_ads.accounts_synced': 'Comptes Google Ads synchronisés',
  'workspace.branding_updated': 'Identité de marque modifiée',
  'approval.requested': 'Changement demandé',
  'approval.executed': 'Changement approuvé et exécuté',
  'approval.rejected': 'Changement rejeté',
}

export default async function AuditPage() {
  const { workspace } = await requireWorkspace()
  const events = await listAuditEvents(workspace.id)
  return <>
    <PageHeading eyebrow="Traçabilité" title="Journal d’audit" description="Les événements sensibles sont consignés de façon append-only, organisation par organisation." />
    <Card className="overflow-hidden border-[#e8e5ef] shadow-sm"><CardContent className="p-0"><div className="divide-y">
      {events.map((event) => <div key={event.id} className="flex gap-4 bg-white px-5 py-4"><span className="grid size-9 shrink-0 place-items-center rounded-xl bg-[#f3f1fb] text-[var(--brand-accent)]"><Fingerprint className="size-4" /></span><div className="min-w-0"><p className="text-sm font-medium">{actionLabels[event.action] ?? event.action}</p><p className="mt-1 text-xs text-muted-foreground">{format(event.createdAt, "d MMMM yyyy 'à' HH:mm", { locale: fr })} · acteur {event.actorUserId}</p>{Object.keys(event.metadata).length > 0 && <code className="mt-2 block max-w-full overflow-hidden text-ellipsis whitespace-nowrap rounded bg-muted px-2 py-1 text-[10px] text-muted-foreground">{JSON.stringify(event.metadata)}</code>}</div></div>)}
      {events.length === 0 && <div className="p-14 text-center text-muted-foreground">Aucun événement consigné pour le moment.</div>}
    </div></CardContent></Card>
  </>
}
