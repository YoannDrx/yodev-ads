import { format } from 'date-fns'
import { enGB, fr } from 'date-fns/locale'
import { Fingerprint } from 'lucide-react'
import { PageHeading } from '@/components/page-heading'
import { Card, CardContent } from '@/components/ui/card'
import { listAuditEvents } from '@/lib/data'
import { requireWorkspacePermission } from '@/lib/workspace'

const actionLabels: Record<'fr' | 'en', Record<string, string>> = {
  fr: {
    'google_ads.connected': 'Connexion Google Ads établie', 'google_ads.disconnected': 'Connexion Google Ads révoquée',
    'google_ads.accounts_synced': 'Comptes Google Ads synchronisés', 'workspace.branding_updated': 'Identité de marque modifiée',
    'approval.requested': 'Changement demandé', 'approval.executed': 'Changement approuvé et exécuté', 'approval.rejected': 'Changement rejeté',
  },
  en: {
    'google_ads.connected': 'Google Ads connection established', 'google_ads.disconnected': 'Google Ads connection revoked',
    'google_ads.accounts_synced': 'Google Ads accounts synchronized', 'workspace.branding_updated': 'Brand identity updated',
    'approval.requested': 'Change requested', 'approval.executed': 'Change approved and executed', 'approval.rejected': 'Change rejected',
  },
}

export default async function AuditPage() {
  const { workspace } = await requireWorkspacePermission('workspace:admin')
  const english = workspace.locale === 'en'
  const locale = english ? 'en' : 'fr'
  const events = await listAuditEvents(workspace.id)
  return <>
    <PageHeading eyebrow={english ? 'Traceability' : 'Traçabilité'} title={english ? 'Audit log' : 'Journal d’audit'} description={english ? 'Sensitive events are recorded append-only, one organization at a time.' : 'Les événements sensibles sont consignés de façon append-only, organisation par organisation.'} />
    <Card className="overflow-hidden border-[#e8e5ef] shadow-sm"><CardContent className="p-0"><div className="divide-y">
      {events.map((event) => <div key={event.id} className="flex gap-4 bg-white px-5 py-4"><span className="grid size-9 shrink-0 place-items-center rounded-xl bg-[#f3f1fb] text-[var(--brand-accent)]"><Fingerprint className="size-4" /></span><div className="min-w-0"><p className="text-sm font-medium">{actionLabels[locale][event.action] ?? event.action}</p><p className="mt-1 text-xs text-muted-foreground">{format(event.createdAt, english ? 'd MMMM yyyy HH:mm' : "d MMMM yyyy 'à' HH:mm", { locale: english ? enGB : fr })} · {english ? 'actor' : 'acteur'} {event.actorUserId}</p>{Object.keys(event.metadata).length > 0 && <code className="mt-2 block max-w-full overflow-hidden text-ellipsis whitespace-nowrap rounded bg-muted px-2 py-1 text-[10px] text-muted-foreground">{JSON.stringify(event.metadata)}</code>}</div></div>)}
      {events.length === 0 && <div className="p-14 text-center text-muted-foreground">{english ? 'No event has been recorded yet.' : 'Aucun événement consigné pour le moment.'}</div>}
    </div></CardContent></Card>
  </>
}
