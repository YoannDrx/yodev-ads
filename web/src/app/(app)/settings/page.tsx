import { Cable, KeyRound, Palette, Plus, RefreshCw, ShieldCheck, Trash2, Unplug } from 'lucide-react'
import {
  createAgencyApiKey,
  disconnectGoogleAds,
  revokeAgencyApiKey,
  syncGoogleAdsAccounts,
  updateBranding,
} from '@/app/actions'
import { FlashMessage } from '@/components/flash-message'
import { PageHeading } from '@/components/page-heading'
import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { getWorkspaceConnection, listApiKeys } from '@/lib/data'
import { hasGoogleConfiguration } from '@/lib/env'
import { formatCustomerId } from '@/lib/ids'
import { requireWorkspace } from '@/lib/workspace'

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; error?: string; apiKey?: string }>
}) {
  const query = await searchParams
  const { workspace, isAdmin } = await requireWorkspace()
  const [connection, keys] = await Promise.all([getWorkspaceConnection(workspace.id), listApiKeys(workspace.id)])
  const googleReady = hasGoogleConfiguration()
  return (
    <>
      <PageHeading
        eyebrow="Organisation"
        title="Réglages"
        description="Connexion, identité et sécurité de votre espace de travail."
      />
      <FlashMessage notice={query.notice} error={query.error} />
      <div className="grid gap-6 xl:grid-cols-2">
        <Card className="border-[#e8e5ef] shadow-sm">
          <CardHeader>
            <div className="flex items-center gap-3">
              <span className="grid size-10 place-items-center rounded-xl bg-violet-50 text-violet-700">
                <Cable className="size-5" />
              </span>
              <div>
                <CardTitle>Google Ads</CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">Accès officiel via votre compte administrateur.</p>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {connection ? (
              <div className="space-y-5">
                <div className="rounded-2xl bg-[#f7f6fb] p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs text-muted-foreground">Compte administrateur</p>
                      <p className="mt-1 font-mono text-sm font-medium">
                        {formatCustomerId(connection.managerCustomerId)}
                      </p>
                    </div>
                    <StatusBadge status={connection.status} />
                  </div>
                  {connection.googleEmail && (
                    <p className="mt-3 text-xs text-muted-foreground">{connection.googleEmail}</p>
                  )}
                </div>
                {isAdmin && (
                  <div className="flex flex-wrap gap-2">
                    <form action={syncGoogleAdsAccounts}>
                      <Button type="submit" className="bg-[var(--brand-accent)] text-white">
                        <RefreshCw className="mr-2 size-4" />
                        Synchroniser les comptes
                      </Button>
                    </form>
                    <form action={disconnectGoogleAds}>
                      <Button type="submit" variant="outline">
                        <Unplug className="mr-2 size-4" />
                        Révoquer l’accès
                      </Button>
                    </form>
                  </div>
                )}
              </div>
            ) : (
              <div>
                <div className="mb-5 flex items-start gap-3 rounded-2xl bg-[#f7f6fb] p-4">
                  <KeyRound className="mt-0.5 size-5 text-violet-700" />
                  <div>
                    <p className="text-sm font-medium">Connexion sécurisée</p>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      Le jeton OAuth est chiffré AES-256-GCM avant stockage. Les secrets ne sont jamais envoyés au
                      navigateur.
                    </p>
                  </div>
                </div>
                {isAdmin ? (
                  <form action="/api/google-ads/connect" method="get" className="space-y-3">
                    <Label htmlFor="managerCustomerId">ID du MCC</Label>
                    <Input
                      id="managerCustomerId"
                      name="managerCustomerId"
                      defaultValue="972-304-2391"
                      inputMode="numeric"
                      required
                    />
                    <Button
                      type="submit"
                      disabled={!googleReady}
                      className="w-full bg-[var(--brand-accent)] text-white"
                    >
                      {googleReady ? 'Connecter Google Ads' : 'OAuth Google à finaliser'}
                    </Button>
                  </form>
                ) : (
                  <p className="text-sm text-muted-foreground">Un administrateur doit établir la connexion.</p>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-[#e8e5ef] shadow-sm">
          <CardHeader>
            <div className="flex items-center gap-3">
              <span className="grid size-10 place-items-center rounded-xl bg-violet-50 text-violet-700">
                <Palette className="size-5" />
              </span>
              <div>
                <CardTitle>Marque blanche</CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">Adaptez le cockpit à votre agence.</p>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <form action={updateBranding} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="brandName">Nom du produit</Label>
                <Input id="brandName" name="brandName" defaultValue={workspace.brandName} disabled={!isAdmin} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="brandTagline">Signature</Label>
                <Input
                  id="brandTagline"
                  name="brandTagline"
                  defaultValue={workspace.brandTagline}
                  disabled={!isAdmin}
                />
              </div>
              <div className="grid grid-cols-[1fr_90px] gap-3">
                <div className="space-y-2">
                  <Label htmlFor="logoUrl">URL du logo (facultatif)</Label>
                  <Input
                    id="logoUrl"
                    name="logoUrl"
                    type="url"
                    defaultValue={workspace.logoUrl ?? ''}
                    disabled={!isAdmin}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="accentColor">Accent</Label>
                  <Input
                    id="accentColor"
                    name="accentColor"
                    type="color"
                    defaultValue={workspace.accentColor}
                    disabled={!isAdmin}
                    className="p-1"
                  />
                </div>
              </div>
              {isAdmin && (
                <Button type="submit" variant="outline" className="w-full">
                  Enregistrer l’identité
                </Button>
              )}
            </form>
          </CardContent>
        </Card>

        <Card className="border-[#e8e5ef] shadow-sm xl:col-span-2">
          <CardContent className="flex items-start gap-4 p-5">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-emerald-50 text-emerald-700">
              <ShieldCheck className="size-5" />
            </span>
            <div>
              <h2 className="font-semibold">Sécurité active</h2>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                Sessions et rôles via Clerk, données par organisation dans Neon, jetons chiffrés, requêtes Google Ads
                validées avant approbation et journal d’audit complet.
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="border-[#e8e5ef] shadow-sm xl:col-span-2">
          <CardContent className="p-6">
            <div className="flex items-start gap-4">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-sky-50 text-sky-700">
                <KeyRound className="size-5" />
              </span>
              <div>
                <h2 className="font-semibold">API d’agence</h2>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                  Branchez Codex, Claude Code ou vos outils internes sur le portefeuille Vigihat via une clé révocable.
                </p>
              </div>
            </div>
            {query.apiKey && (
              <div className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-emerald-800">
                  Nouvelle clé · à copier maintenant
                </p>
                <Input readOnly value={query.apiKey} className="mt-3 bg-white font-mono text-xs" />
              </div>
            )}
            {isAdmin && (
              <form action={createAgencyApiKey} className="mt-5 flex max-w-xl gap-2">
                <Input name="name" placeholder="Codex production" required />
                <Button type="submit">
                  <Plus className="mr-2 size-4" />
                  Créer une clé
                </Button>
              </form>
            )}
            <div className="mt-5 space-y-2">
              {keys.map((key) => (
                <div key={key.id} className="flex items-center justify-between rounded-xl bg-[#f7f9fa] px-4 py-3">
                  <div>
                    <p className="text-sm font-medium">{key.name}</p>
                    <p className="mt-1 font-mono text-[10px] text-muted-foreground">
                      {key.tokenPrefix}•••• ·{' '}
                      {key.lastUsedAt ? `utilisée ${key.lastUsedAt.toLocaleString('fr-FR')}` : 'jamais utilisée'}
                    </p>
                  </div>
                  {isAdmin && (
                    <form action={revokeAgencyApiKey}>
                      <input type="hidden" name="keyId" value={key.id} />
                      <Button type="submit" size="sm" variant="ghost">
                        <Trash2 className="size-4" />
                      </Button>
                    </form>
                  )}
                </div>
              ))}
            </div>
            <div className="mt-5 rounded-xl border bg-white p-4">
              <p className="text-xs font-medium">Endpoint prêt à l’emploi</p>
              <code className="mt-2 block overflow-x-auto text-xs text-muted-foreground">
                curl -H &quot;Authorization: Bearer $VIGIHAT_API_KEY&quot; https://vigihat.com/api/v1/portfolio
              </code>
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  )
}
