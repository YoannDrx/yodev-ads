import Link from 'next/link'
import { ArrowUpRight, Building2 } from 'lucide-react'
import { FlashMessage } from '@/components/flash-message'
import { PageHeading } from '@/components/page-heading'
import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { formatCustomerId } from '@/lib/ids'
import { listWorkspaceClients } from '@/lib/data'
import { requireWorkspacePermission } from '@/lib/workspace'

export default async function AccountsPage({ searchParams }: { searchParams: Promise<{ notice?: string; error?: string }> }) {
  const query = await searchParams
  const { workspace } = await requireWorkspacePermission('portfolio:read')
  const english = workspace.locale === 'en'
  const accounts = await listWorkspaceClients(workspace.id)
  return <>
    <PageHeading eyebrow={english ? 'Portfolio' : 'Portefeuille'} title={english ? 'Client accounts' : 'Comptes clients'} description={english ? 'Every account available from your MCC, isolated within this organization.' : 'Tous les comptes accessibles depuis votre MCC, isolés dans cette organisation.'} actions={<Button asChild variant="outline"><Link href="/settings">{english ? 'Manage connection' : 'Gérer la connexion'}</Link></Button>} />
    <FlashMessage notice={query.notice} error={query.error} locale={english ? 'en' : 'fr'} />
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {accounts.map((account) => <Card key={account.id} className="border-[#e8e5ef] shadow-sm"><CardContent className="p-5"><div className="flex items-start justify-between"><span className="grid size-10 place-items-center rounded-xl bg-violet-50 text-violet-700"><Building2 className="size-5" /></span><StatusBadge status={account.active ? 'active' : 'inactive'} locale={english ? 'en' : 'fr'} /></div><h2 className="mt-5 font-semibold tracking-tight">{account.name}</h2><p className="mt-1 font-mono text-xs text-muted-foreground">{formatCustomerId(account.googleCustomerId)}</p><div className="mt-5 flex items-center justify-between border-t pt-4 text-xs text-muted-foreground"><span>{account.currencyCode} · {account.timezone}</span>{account.isManager ? <span>MCC</span> : <Button asChild variant="ghost" size="sm"><Link href={`/dashboard?client=${account.id}`}>{english ? 'View' : 'Voir'} <ArrowUpRight className="ml-1 size-3" /></Link></Button>}</div></CardContent></Card>)}
      {accounts.length === 0 && <div className="col-span-full rounded-3xl border border-dashed bg-white p-12 text-center text-muted-foreground">{english ? 'No account has been synchronized yet.' : 'Aucun compte synchronisé pour le moment.'}</div>}
    </div>
  </>
}
