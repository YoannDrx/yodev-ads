import { Clock3, LifeBuoy, MessageSquareText, ShieldCheck } from 'lucide-react'
import { addSupportMessage, createSupportTicket } from '@/app/actions'
import { FlashMessage } from '@/components/flash-message'
import { PageHeading } from '@/components/page-heading'
import { StatusBadge } from '@/components/status-badge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { listWorkspaceSupportTickets } from '@/lib/data'
import { permissionsForRole } from '@/lib/permissions'
import { requireWorkspace } from '@/lib/workspace'

const categoryLabels: Record<string, { fr: string; en: string }> = {
  technical: { fr: 'Technique', en: 'Technical' },
  billing: { fr: 'Facturation', en: 'Billing' },
  google_ads: { fr: 'Google Ads', en: 'Google Ads' },
  feature: { fr: 'Fonctionnalité', en: 'Feature' },
  data_privacy: { fr: 'Données et confidentialité', en: 'Data and privacy' },
}

export default async function SupportPage({ searchParams }: { searchParams: Promise<{ notice?: string; error?: string }> }) {
  const query = await searchParams
  const { workspace, role, session } = await requireWorkspace()
  const tickets = await listWorkspaceSupportTickets(workspace.id)
  const canContact = permissionsForRole(role).has('support:contact')
  const english = workspace.locale === 'en'
  const openCount = tickets.filter(({ ticket }) => !['resolved', 'closed'].includes(ticket.status)).length

  return (
    <>
      <PageHeading
        eyebrow={english ? 'Customer support' : 'Support client'}
        title={english ? 'Get help from Yodev' : 'Obtenir l’aide de Yodev'}
        description={english
          ? 'A tenant-isolated, audited channel for technical, billing, Google Ads and privacy requests.'
          : 'Un canal tenanté et audité pour les demandes techniques, de facturation, Google Ads et de confidentialité.'}
      />
      <FlashMessage notice={query.notice} error={query.error} locale={english ? 'en' : 'fr'} />
      <section className="mb-6 grid gap-4 sm:grid-cols-3">
        <Summary label={english ? 'Open requests' : 'Demandes ouvertes'} value={openCount} icon={LifeBuoy} />
        <Summary label={english ? 'Total history' : 'Historique total'} value={tickets.length} icon={MessageSquareText} />
        <Card className="shadow-none"><CardContent className="flex items-center gap-3 p-5"><ShieldCheck className="size-5 text-emerald-600" /><p className="text-sm text-muted-foreground">{english ? 'Messages are visible only to your workspace and Yodev support.' : 'Les messages ne sont visibles que par votre workspace et le support Yodev.'}</p></CardContent></Card>
      </section>

      {canContact && <Card className="mb-6 border-[#dce5e7] shadow-none">
        <CardHeader><CardTitle>{english ? 'Create a support request' : 'Créer une demande de support'}</CardTitle></CardHeader>
        <CardContent><form action={createSupportTicket} className="grid gap-3 md:grid-cols-2">
          <Input name="subject" minLength={4} maxLength={220} required placeholder={english ? 'Short, precise subject' : 'Objet court et précis'} className="md:col-span-2" />
          <select name="category" className="h-10 rounded-lg border bg-white px-3 text-sm" aria-label={english ? 'Category' : 'Catégorie'}>
            {Object.entries(categoryLabels).map(([value, label]) => <option key={value} value={value}>{english ? label.en : label.fr}</option>)}
          </select>
          <select name="priority" className="h-10 rounded-lg border bg-white px-3 text-sm" aria-label={english ? 'Priority' : 'Priorité'} defaultValue="normal">
            <option value="normal">{english ? 'Normal' : 'Normale'}</option><option value="high">{english ? 'High' : 'Haute'}</option><option value="urgent">{english ? 'Urgent — production blocked' : 'Urgente — production bloquée'}</option>
          </select>
          <Textarea name="body" minLength={10} maxLength={8000} required className="min-h-32 md:col-span-2" placeholder={english ? 'Context, steps to reproduce, expected and observed result. Never include credentials.' : 'Contexte, étapes de reproduction, résultat attendu et constaté. Ne transmettez jamais de secrets.'} />
          <Button type="submit" className="md:col-span-2 md:w-fit"><LifeBuoy className="mr-2 size-4" />{english ? 'Send request' : 'Envoyer la demande'}</Button>
        </form></CardContent>
      </Card>}

      <div className="space-y-4">
        {tickets.map(({ ticket, messages }) => <Card key={ticket.id} className="[content-visibility:auto] border-[#dce5e7] shadow-none"><CardContent className="p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><div className="flex flex-wrap gap-2"><StatusBadge status={ticket.status} locale={english ? 'en' : 'fr'} /><Badge variant="outline">{categoryLabels[ticket.category]?.[english ? 'en' : 'fr'] ?? ticket.category}</Badge>{ticket.priority !== 'normal' && <Badge variant={ticket.priority === 'urgent' ? 'destructive' : 'secondary'}>{ticket.priority}</Badge>}</div><h2 className="mt-3 font-semibold">{ticket.subject}</h2><p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground"><Clock3 className="size-3" />{ticket.lastMessageAt.toLocaleString(english ? 'en-GB' : 'fr-FR', { timeZone: workspace.timezone })}</p></div><span className="text-xs text-muted-foreground">#{ticket.id.slice(0, 8)}</span></div>
          <div className="mt-5 space-y-3 border-t pt-4">{messages.map((supportMessage) => <div key={supportMessage.id} className={`rounded-2xl px-4 py-3 ${supportMessage.authorKind === 'support' ? 'bg-emerald-50' : 'bg-slate-50'}`}><p className="whitespace-pre-wrap text-sm leading-6">{supportMessage.body}</p><p className="mt-2 text-[11px] text-muted-foreground">{supportMessage.authorKind === 'support' ? 'Yodev Support' : supportMessage.authorUserId === session.userId ? (english ? 'You' : 'Vous') : (english ? 'Workspace member' : 'Membre du workspace')} · {supportMessage.createdAt.toLocaleString(english ? 'en-GB' : 'fr-FR')}</p></div>)}</div>
          {canContact && ticket.status !== 'closed' && <form action={addSupportMessage} className="mt-4 flex flex-col gap-2 sm:flex-row"><input type="hidden" name="ticketId" value={ticket.id} /><Textarea name="body" maxLength={8000} required placeholder={english ? 'Add context or reply to support' : 'Ajouter du contexte ou répondre au support'} className="min-h-20 flex-1" /><Button type="submit" variant="outline">{english ? 'Reply' : 'Répondre'}</Button></form>}
        </CardContent></Card>)}
        {!tickets.length && <div className="rounded-3xl border border-dashed bg-white p-14 text-center"><LifeBuoy className="mx-auto size-8 text-emerald-600" /><h2 className="mt-4 font-semibold">{english ? 'No support request' : 'Aucune demande de support'}</h2><p className="mt-2 text-sm text-muted-foreground">{english ? 'Your future conversations will remain available here.' : 'Vos futures conversations resteront accessibles ici.'}</p></div>}
      </div>
    </>
  )
}

function Summary({ label, value, icon: Icon }: { label: string; value: number; icon: typeof LifeBuoy }) {
  return <Card className="shadow-none"><CardContent className="flex items-center justify-between p-5"><div><p className="text-sm text-muted-foreground">{label}</p><p className="mt-2 text-3xl font-semibold">{value}</p></div><span className="grid size-11 place-items-center rounded-2xl bg-slate-100 text-slate-700"><Icon className="size-5" /></span></CardContent></Card>
}
