import { ExternalLink, Link2, LockKeyhole, Plus, Trash2 } from 'lucide-react'
import { createShareLink, revokeShareLink } from '@/app/actions'
import { FlashMessage } from '@/components/flash-message'
import { PageHeading } from '@/components/page-heading'
import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { listShareLinks, listWorkspaceClients } from '@/lib/data'
import { requireWorkspace } from '@/lib/workspace'

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; error?: string; share?: string }>
}) {
  const query = await searchParams
  const { workspace } = await requireWorkspace()
  const [links, clients] = await Promise.all([listShareLinks(workspace.id), listWorkspaceClients(workspace.id)])
  const origin = process.env.NEXT_PUBLIC_APP_URL ?? 'https://vigieads.vercel.app'
  const freshUrl = query.share ? `${origin}/r/${query.share}` : undefined
  return (
    <>
      <PageHeading
        eyebrow="Portail client"
        title="Rapports partageables"
        description="Donnez à vos clients une vue Google Ads actualisée, en lecture seule, sans compte à créer. Chaque lien est isolé et révocable."
      />
      <FlashMessage notice={query.notice} error={query.error} />
      {freshUrl && (
        <div className="mb-6 rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
          <p className="text-sm font-semibold text-emerald-900">Votre nouveau lien sécurisé</p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <Input readOnly value={freshUrl} className="bg-white font-mono text-xs" />
            <Button asChild variant="outline">
              <a href={freshUrl} target="_blank" rel="noreferrer">
                Ouvrir <ExternalLink className="ml-2 size-4" />
              </a>
            </Button>
          </div>
          <p className="mt-2 text-xs text-emerald-800">
            Copiez-le maintenant : Vigieads ne stocke que son empreinte cryptographique.
          </p>
        </div>
      )}
      <div className="grid gap-6 xl:grid-cols-[.8fr_1.2fr]">
        <Card className="h-fit border-[#dde4e7] shadow-none">
          <CardContent className="p-6">
            <div className="flex items-center gap-3">
              <span className="grid size-10 place-items-center rounded-xl bg-[#e9fbf3] text-[#176646]">
                <Plus className="size-5" />
              </span>
              <div>
                <h2 className="font-semibold">Créer un rapport</h2>
                <p className="text-sm text-muted-foreground">Valide 90 jours par défaut</p>
              </div>
            </div>
            <form action={createShareLink} className="mt-6 space-y-4">
              <div>
                <label className="mb-2 block text-sm font-medium" htmlFor="report-label">
                  Nom interne
                </label>
                <Input id="report-label" name="label" placeholder="Reporting mensuel Mail Certificate" required />
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium" htmlFor="report-client">
                  Compte client
                </label>
                <select
                  id="report-client"
                  name="clientId"
                  className="h-10 w-full rounded-lg border bg-white px-3 text-sm"
                  required
                >
                  {clients
                    .filter((client) => !client.isManager)
                    .map((client) => (
                      <option key={client.id} value={client.id}>
                        {client.name}
                      </option>
                    ))}
                </select>
              </div>
              <Button type="submit" className="w-full">
                <Link2 className="mr-2 size-4" />
                Générer le lien
              </Button>
            </form>
            <div className="mt-5 flex gap-3 rounded-xl bg-[#f4f7f8] p-3 text-xs leading-5 text-muted-foreground">
              <LockKeyhole className="mt-0.5 size-4 shrink-0 text-[#176646]" />
              Le lecteur ne peut ni naviguer dans votre espace, ni modifier Google Ads.
            </div>
          </CardContent>
        </Card>
        <div className="space-y-3">
          {links.map(({ share, client }) => (
            <Card key={share.id} className="border-[#dde4e7] shadow-none">
              <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <StatusBadge status={share.active ? 'active' : 'revoked'} />
                    <span className="font-mono text-[10px] text-muted-foreground">{share.tokenPrefix}••••</span>
                  </div>
                  <h3 className="mt-3 font-semibold">{share.label}</h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {client.name} · créé le {share.createdAt.toLocaleDateString('fr-FR')}
                    {share.expiresAt ? ` · expire le ${share.expiresAt.toLocaleDateString('fr-FR')}` : ''}
                  </p>
                </div>
                {share.active && (
                  <form action={revokeShareLink}>
                    <input type="hidden" name="shareId" value={share.id} />
                    <Button type="submit" size="sm" variant="ghost">
                      <Trash2 className="mr-2 size-4" />
                      Révoquer
                    </Button>
                  </form>
                )}
              </CardContent>
            </Card>
          ))}
          {links.length === 0 && (
            <div className="rounded-3xl border border-dashed bg-white p-12 text-center text-muted-foreground">
              Aucun rapport partagé pour le moment.
            </div>
          )}
        </div>
      </div>
    </>
  )
}
