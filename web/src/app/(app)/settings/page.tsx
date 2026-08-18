import { BellRing, Cable, Gauge, Globe2, KeyRound, Palette, Plus, RefreshCw, ShieldCheck, Trash2, Unplug, UserRound, UsersRound, Workflow } from 'lucide-react'
import {
  createAgencyApiKey,
  createNotificationChannel,
  disableNotificationChannel,
  disconnectGoogleAds,
  revokeAgencyApiKey,
  retryDeadLetterJob,
  createWorkspaceDomain,
  inviteWorkspaceMember,
  removeWorkspaceMember,
  removeWorkspaceLogo,
  revokeWorkspaceDomain,
  revokeWorkspaceInvitation,
  syncGoogleAdsAccounts,
  transferWorkspaceOwnership,
  updateBranding,
  updateApprovalPolicy,
  updateWorkspaceLocale,
  updateSafetyRules,
  updateMyTaskNotificationPreferences,
  updateWorkspaceMemberRole,
  uploadWorkspaceLogo,
  verifyWorkspaceDomain,
} from '@/app/actions'
import { FlashMessage } from '@/components/flash-message'
import { SecretRevelation } from '@/components/api-key-revelation'
import { AuthSecurityControls } from '@/components/auth-security-controls'
import { PageHeading } from '@/components/page-heading'
import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { getMyTaskNotificationPreferences, getWorkspaceConnection, listApiKeys, listNotificationChannels, listWorkspaceClients, listWorkspaceDeadLetters, listWorkspaceDomains, listWorkspaceSafetyPolicies } from '@/lib/data'
import { hasGoogleConfiguration } from '@/lib/env'
import { featureEnabled, privateApiWorkspaceAllowed } from '@/lib/feature-flags'
import { formatCustomerId } from '@/lib/ids'
import { hasSlackOAuthConfiguration } from '@/lib/slack-oauth'
import { hasTeamsOAuthConfiguration } from '@/lib/teams-oauth'
import { requireWorkspacePermission } from '@/lib/workspace'
import { workspaceMemberRoster } from '@/lib/workspace-members'
import { isControlledBrandLogoUrl } from '@/lib/branding-assets'

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; error?: string; reveal?: string }>
}) {
  const query = await searchParams
  const { workspace, isAdmin, entitlements, session } = await requireWorkspacePermission('workspace:admin')
  const english = workspace.locale === 'en'
  const locale = english ? 'en' : 'fr'
  const canUseCustomDomain = entitlements.capabilities.has('custom_domain') && featureEnabled('customDomains')
  const canUseBranding = entitlements.capabilities.has('reports.white_label')
  const canCollaborate = entitlements.capabilities.has('collaboration')
  const canUsePrivateApi = privateApiWorkspaceAllowed(workspace.id, workspace.accessState)
  const notificationsEnabled = featureEnabled('notifications')
  const [connection, keys, channels, safetyPolicies, clients, deadLetters, domains, taskPreferences, memberRoster] = await Promise.all([
    getWorkspaceConnection(workspace.id),
    canUsePrivateApi ? listApiKeys(workspace.id) : Promise.resolve([]),
    notificationsEnabled ? listNotificationChannels(workspace.id) : Promise.resolve([]),
    listWorkspaceSafetyPolicies(workspace.id),
    listWorkspaceClients(workspace.id),
    isAdmin ? listWorkspaceDeadLetters(workspace.id) : Promise.resolve([]),
    canUseCustomDomain ? listWorkspaceDomains(workspace.id) : Promise.resolve([]),
    getMyTaskNotificationPreferences(workspace.id, session.userId),
    isAdmin && workspace.authOrganizationId ? workspaceMemberRoster(workspace.authOrganizationId, workspace.ownerUserId).catch(() => null) : Promise.resolve(null),
  ])
  const safetyPolicy = safetyPolicies.find((policy) => !policy.clientId && !policy.campaignId)
  const googleReady = hasGoogleConfiguration()
  const slackReady = featureEnabled('slackConnector') && hasSlackOAuthConfiguration()
  const teamsReady = featureEnabled('teamsConnector') && hasTeamsOAuthConfiguration()
  const blobReady = featureEnabled('blobUploads') && Boolean(process.env.BLOB_READ_WRITE_TOKEN)
  return (
    <>
      <PageHeading
        eyebrow={english ? 'Organisation' : 'Organisation'}
        title={english ? 'Settings' : 'Réglages'}
        description={english ? 'Connection, identity and security for your workspace.' : 'Connexion, identité et sécurité de votre espace de travail.'}
      />
      <FlashMessage notice={query.notice} error={query.error} locale={locale} />
      <Card className="mb-6 border-[#e8e5ef] shadow-sm">
        <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex items-start gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-indigo-50 text-indigo-700"><Globe2 className="size-5" /></span>
            <div><h2 className="font-semibold">{english ? 'Workspace language' : 'Langue de l’espace'}</h2><p className="mt-1 text-sm text-muted-foreground">{english ? 'Controls the authenticated application, reports by default and operational emails.' : 'Pilote l’application authentifiée, la langue par défaut des rapports et les emails opérationnels.'}</p></div>
          </div>
          <form action={updateWorkspaceLocale} className="flex gap-2">
            <select name="locale" defaultValue={locale} disabled={!isAdmin} aria-label={english ? 'Workspace language' : 'Langue de l’espace'} className="h-10 rounded-lg border bg-white px-3 text-sm"><option value="fr">Français</option><option value="en">English</option></select>
            {isAdmin && <Button type="submit" variant="outline">{english ? 'Apply language' : 'Appliquer la langue'}</Button>}
          </form>
        </CardContent>
      </Card>
      <div className="grid gap-6 xl:grid-cols-2">
        <Card className="border-[#e8e5ef] shadow-sm xl:col-span-2">
          <CardHeader>
            <div className="flex items-center gap-3">
              <span className="grid size-10 place-items-center rounded-xl bg-indigo-50 text-indigo-700"><UsersRound className="size-5" /></span>
              <div><CardTitle>{english ? 'Members and roles' : 'Membres et rôles'}</CardTitle><p className="mt-1 text-sm text-muted-foreground">{english ? 'Better Auth invitations and roles are controlled server-side and count against the plan quota.' : 'Les invitations et rôles Better Auth sont contrôlés côté serveur et décomptés du quota du plan.'}</p></div>
            </div>
          </CardHeader>
          <CardContent>
            {!isAdmin ? (
              <p className="text-sm text-muted-foreground">{english ? 'Only owners and administrators can manage members.' : 'Seuls les propriétaires et administrateurs peuvent gérer les membres.'}</p>
            ) : !memberRoster ? (
              <p className="rounded-xl bg-amber-50 p-4 text-sm text-amber-800">{english ? 'Better Auth member management is temporarily unavailable.' : 'La gestion des membres Better Auth est temporairement indisponible.'}</p>
            ) : (
              <div className="space-y-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-sm text-muted-foreground">{english ? 'Used' : 'Utilisés'} : <strong>{memberRoster.usage}</strong> / {entitlements.limits.members ?? (english ? 'unlimited' : 'illimité')}</p>
                  {!canCollaborate && <p className="text-xs text-amber-700">{english ? 'Invitations are available from Studio.' : 'Les invitations sont disponibles à partir de Studio.'}</p>}
                </div>
                {canCollaborate && (
                  <form action={inviteWorkspaceMember} className="grid gap-3 md:grid-cols-[1fr_180px_auto]">
                    <Input name="emailAddress" type="email" placeholder={english ? 'member@company.com' : 'membre@entreprise.fr'} required />
                    <select name="role" aria-label={english ? 'Role' : 'Rôle'} defaultValue="client" className="h-10 rounded-lg border bg-white px-3 text-sm"><option value="admin">Admin</option><option value="strategist">Strategist</option><option value="analyst">Analyst</option><option value="client">Client</option></select>
                    <Button type="submit"><Plus className="mr-2 size-4" />{english ? 'Invite' : 'Inviter'}</Button>
                  </form>
                )}
                <div className="space-y-2">
                  {memberRoster.members.map((member) => (
                    <div key={member.id} className="flex flex-col gap-3 rounded-xl bg-[#f7f9fa] px-4 py-3 md:flex-row md:items-center md:justify-between">
                      <div><p className="text-sm font-medium">{member.displayName}{member.userId === session.userId ? ` · ${english ? 'you' : 'vous'}` : ''}</p><p className="mt-1 text-xs text-muted-foreground">{member.identifier} · {member.role}</p></div>
                      {member.role !== 'owner' && <div className="flex flex-wrap gap-2"><form action={updateWorkspaceMemberRole} className="flex gap-2"><input type="hidden" name="userId" value={member.userId} /><select name="role" defaultValue={member.role} aria-label={english ? `Role for ${member.displayName}` : `Rôle de ${member.displayName}`} className="h-9 rounded-lg border bg-white px-2 text-xs"><option value="admin">Admin</option><option value="strategist">Strategist</option><option value="analyst">Analyst</option><option value="client">Client</option></select><Button type="submit" size="sm" variant="outline">{english ? 'Update' : 'Modifier'}</Button></form><form action={removeWorkspaceMember}><input type="hidden" name="userId" value={member.userId} /><Button type="submit" size="sm" variant="ghost" aria-label={english ? `Remove ${member.displayName}` : `Retirer ${member.displayName}`}><Trash2 className="size-4" /></Button></form></div>}
                    </div>
                  ))}
                  {memberRoster.invitations.map((invitation) => (
                    <div key={invitation.id} className="flex items-center justify-between rounded-xl border border-dashed px-4 py-3"><div><p className="text-sm font-medium">{invitation.emailAddress}</p><p className="mt-1 text-xs text-muted-foreground">{english ? 'Pending invitation' : 'Invitation en attente'} · {invitation.role} · {english ? 'expires' : 'expire'} {invitation.expiresAt.toLocaleDateString(english ? 'en-GB' : 'fr-FR')}</p></div><form action={revokeWorkspaceInvitation}><input type="hidden" name="invitationId" value={invitation.id} /><Button type="submit" size="sm" variant="ghost">{english ? 'Revoke' : 'Révoquer'}</Button></form></div>
                  ))}
                </div>
                {session.userId === workspace.ownerUserId && memberRoster.members.some((member) => member.userId !== workspace.ownerUserId) && (
                  <details className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                    <summary className="cursor-pointer text-sm font-semibold text-amber-900">{english ? 'Transfer workspace ownership' : 'Transférer la propriété de l’espace'}</summary>
                    <p className="mt-2 text-xs leading-5 text-amber-800">{english ? `This changes the billing and deletion authority. To confirm, enter “${workspace.slug}”.` : `Cette action transfère l’autorité de facturation et de suppression. Pour confirmer, saisissez « ${workspace.slug} ».`}</p>
                    <form action={transferWorkspaceOwnership} className="mt-3 grid gap-3 md:grid-cols-[1fr_1fr_auto]">
                      <select name="userId" aria-label={english ? 'New owner' : 'Nouveau propriétaire'} required className="h-10 rounded-lg border bg-white px-3 text-sm"><option value="">{english ? 'Choose a member' : 'Choisir un membre'}</option>{memberRoster.members.filter((member) => member.userId !== workspace.ownerUserId).map((member) => <option key={member.id} value={member.userId}>{member.displayName} · {member.identifier}</option>)}</select>
                      <Input name="confirmation" placeholder={workspace.slug} autoComplete="off" required />
                      <Button type="submit" variant="outline" className="border-amber-400 text-amber-900">{english ? 'Transfer' : 'Transférer'}</Button>
                    </form>
                  </details>
                )}
              </div>
            )}
          </CardContent>
        </Card>
        <Card className="border-[#e8e5ef] shadow-sm">
          <CardHeader>
            <div className="flex items-center gap-3">
              <span className="grid size-10 place-items-center rounded-xl bg-violet-50 text-violet-700">
                <Cable className="size-5" />
              </span>
              <div>
                <CardTitle>Google Ads</CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">{english ? 'Official access through your manager account.' : 'Accès officiel via votre compte administrateur.'}</p>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {connection ? (
              <div className="space-y-5">
                <div className="rounded-2xl bg-[#f7f6fb] p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs text-muted-foreground">{english ? 'Manager account' : 'Compte administrateur'}</p>
                      <p className="mt-1 font-mono text-sm font-medium">
                        {formatCustomerId(connection.managerCustomerId)}
                      </p>
                    </div>
                    <StatusBadge status={connection.status} locale={locale} />
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
                        {english ? 'Sync accounts' : 'Synchroniser les comptes'}
                      </Button>
                    </form>
                    <Button asChild variant="outline">
                      <a href={`/api/google-ads/connect?managerCustomerId=${encodeURIComponent(connection.managerCustomerId)}`}>
                        <KeyRound className="mr-2 size-4" />
                        {english ? 'Reconnect Google Ads' : 'Reconnecter Google Ads'}
                      </a>
                    </Button>
                    <form action={disconnectGoogleAds}>
                      <Button type="submit" variant="outline">
                        <Unplug className="mr-2 size-4" />
                        {english ? 'Revoke access' : 'Révoquer l’accès'}
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
                    <p className="text-sm font-medium">{english ? 'Secure connection' : 'Connexion sécurisée'}</p>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      {english ? 'The OAuth token is encrypted with AES-256-GCM before storage. Secrets are never sent to the browser.' : 'Le jeton OAuth est chiffré AES-256-GCM avant stockage. Les secrets ne sont jamais envoyés au navigateur.'}
                    </p>
                  </div>
                </div>
                {isAdmin ? (
                  <form action="/api/google-ads/connect" method="get" className="space-y-3">
                    <Label htmlFor="managerCustomerId">{english ? 'MCC ID' : 'ID du MCC'}</Label>
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
                      {googleReady ? (english ? 'Connect Google Ads' : 'Connecter Google Ads') : (english ? 'Google OAuth setup required' : 'OAuth Google à finaliser')}
                    </Button>
                  </form>
                ) : (
                  <p className="text-sm text-muted-foreground">{english ? 'An administrator must establish the connection.' : 'Un administrateur doit établir la connexion.'}</p>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-[#e8e5ef] shadow-sm">
          <CardHeader>
            <div className="flex items-center gap-3"><span className="grid size-10 place-items-center rounded-xl bg-emerald-50 text-emerald-700"><Workflow className="size-5" /></span><div><CardTitle>{english ? 'Approval policy' : 'Politique d’approbation'}</CardTitle><p className="mt-1 text-sm text-muted-foreground">{english ? 'Separate proposal and execution according to your plan.' : 'Séparez proposition et exécution selon votre offre.'}</p></div></div>
          </CardHeader>
          <CardContent>
            <form action={updateApprovalPolicy} className="space-y-4">
              <div className="space-y-2"><Label htmlFor="requiredApprovals">{english ? 'Required approvals' : 'Approbations requises'}</Label><select id="requiredApprovals" name="requiredApprovals" defaultValue={workspace.requiredApprovals} disabled={!isAdmin} className="h-10 w-full rounded-lg border bg-white px-3 text-sm"><option value="1">1</option><option value="2" disabled={!entitlements.capabilities.has('approvals.dual')}>2</option></select></div>
              <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="allowSelfApproval" defaultChecked={workspace.allowSelfApproval} disabled={!isAdmin || workspace.plan === 'agency' || workspace.plan === 'trial'} className="mt-1" /><span>{english ? 'Allow the proposer to approve their own request. Execution still requires a separate confirmation interaction.' : 'Autoriser le proposant à approuver sa propre demande. L’exécution exige toujours une interaction de confirmation distincte.'}</span></label>
              {(workspace.plan === 'agency' || workspace.plan === 'trial') && <p className="text-xs text-muted-foreground">{english ? 'Self-approval is disabled for this plan.' : 'L’auto-approbation est désactivée pour cette offre.'}</p>}
              {isAdmin && <Button type="submit" variant="outline" className="w-full">{english ? 'Save approval policy' : 'Enregistrer la politique'}</Button>}
            </form>
          </CardContent>
        </Card>

        <Card className="border-[#e8e5ef] shadow-sm">
          <CardHeader>
            <div className="flex items-center gap-3">
              <span className="grid size-10 place-items-center rounded-xl bg-violet-50 text-violet-700">
                <Palette className="size-5" />
              </span>
              <div>
                <CardTitle>{english ? 'White label' : 'Marque blanche'}</CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">{english ? 'Adapt the cockpit to your agency.' : 'Adaptez le cockpit à votre agence.'}</p>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <form action={updateBranding} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="brandName">{english ? 'Product name' : 'Nom du produit'}</Label>
                <Input id="brandName" name="brandName" defaultValue={workspace.brandName} disabled={!isAdmin || !canUseBranding} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="brandTagline">{english ? 'Tagline' : 'Signature'}</Label>
                <Input
                  id="brandTagline"
                  name="brandTagline"
                  defaultValue={workspace.brandTagline}
                  disabled={!isAdmin || !canUseBranding}
                />
              </div>
              <div className="grid grid-cols-[1fr_90px] gap-3">
                <p className="self-end text-xs leading-5 text-muted-foreground">{english ? 'External logo URLs are rejected. Files are signature-checked and stored in the controlled product bucket.' : 'Les URL de logo externes sont refusées. Les fichiers sont vérifiés par signature et stockés dans le bucket contrôlé du produit.'}</p>
                <div className="space-y-2">
                  <Label htmlFor="accentColor">Accent</Label>
                  <Input
                    id="accentColor"
                    name="accentColor"
                    type="color"
                    defaultValue={workspace.accentColor}
                    disabled={!isAdmin || !canUseBranding}
                    className="p-1"
                  />
                </div>
              </div>
              {!canUseBranding && <p className="text-xs text-muted-foreground">{english ? 'Report customization is available from the Studio plan.' : 'La personnalisation des rapports est disponible à partir de Studio.'}</p>}
              {isAdmin && canUseBranding && (
                <Button type="submit" variant="outline" className="w-full">
                  {english ? 'Save identity' : 'Enregistrer l’identité'}
                </Button>
              )}
            </form>
            {isAdmin && canUseBranding && blobReady && (
              <div className="mt-5 border-t pt-5">
                <form action={uploadWorkspaceLogo} className="flex flex-col gap-3 sm:flex-row sm:items-end">
                  <div className="flex-1 space-y-2"><Label htmlFor="workspaceLogo">{english ? 'Logo (PNG, JPEG or WebP, 2 MB max)' : 'Logo (PNG, JPEG ou WebP, 2 Mo max)'}</Label><Input id="workspaceLogo" name="logo" type="file" accept="image/png,image/jpeg,image/webp" required /></div>
                  <Button type="submit" variant="outline">{english ? 'Upload logo' : 'Importer le logo'}</Button>
                </form>
                {isControlledBrandLogoUrl(workspace.logoUrl) && <div className="mt-3 flex items-center justify-between rounded-xl bg-[#f7f9fa] p-3"><div className="flex items-center gap-3"><span className="grid size-10 place-items-center rounded-lg bg-white text-sm font-bold text-[var(--brand-accent)]">{workspace.brandName.slice(0, 2).toUpperCase()}</span><span className="text-sm">{english ? 'Controlled logo active' : 'Logo contrôlé actif'}</span></div><form action={removeWorkspaceLogo}><Button type="submit" size="sm" variant="ghost">{english ? 'Remove' : 'Retirer'}</Button></form></div>}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-[#e8e5ef] shadow-sm">
          <CardHeader>
            <div className="flex items-center gap-3">
              <span className="grid size-10 place-items-center rounded-xl bg-amber-50 text-amber-700"><Gauge className="size-5" /></span>
              <div><CardTitle>{english ? 'Safety rules' : 'Règles de sécurité'}</CardTitle><p className="mt-1 text-sm text-muted-foreground">{english ? 'Block out-of-policy budgets before Google Ads.' : 'Bloquez les budgets hors politique avant Google Ads.'}</p></div>
            </div>
          </CardHeader>
          <CardContent>
            <form action={updateSafetyRules} className="space-y-4">
              <div className="space-y-2"><Label htmlFor="safetyScope">{english ? 'Policy scope' : 'Portée de la règle'}</Label><select id="safetyScope" name="scope" defaultValue="workspace" disabled={!isAdmin} className="h-10 w-full rounded-lg border bg-white px-3 text-sm"><option value="workspace">Workspace</option><option value="client" disabled={workspace.plan === 'trial' || workspace.plan === 'solo'}>{english ? 'Client account' : 'Compte client'}</option><option value="campaign" disabled={workspace.plan !== 'agency' && workspace.plan !== 'internal'}>{english ? 'Campaign' : 'Campagne'}</option></select><p className="text-xs text-muted-foreground">{english ? 'For a client rule, select a client below. For a campaign rule, also enter its numeric Google Ads ID.' : 'Pour une règle client, sélectionnez un client ci-dessous. Pour une campagne, saisissez aussi son ID Google Ads numérique.'}</p></div>
              <div className="grid gap-3 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="safetyClientId">{english ? 'Client account (scoped rules)' : 'Compte client (règles ciblées)'}</Label><select id="safetyClientId" name="clientId" defaultValue="" disabled={!isAdmin} className="h-10 w-full rounded-lg border bg-white px-3 text-sm"><option value="">{english ? 'No client — workspace rule' : 'Aucun — règle workspace'}</option>{clients.filter((client) => !client.isManager).map((client) => <option key={client.id} value={client.id}>{client.name} · {client.currencyCode}</option>)}</select></div><div className="space-y-2"><Label htmlFor="safetyCampaignId">{english ? 'Campaign ID (Agency)' : 'ID de campagne (Agency)'}</Label><Input id="safetyCampaignId" name="campaignId" inputMode="numeric" pattern="[0-9]+" maxLength={32} placeholder="123456789" disabled={!isAdmin} /></div></div>
              <div className="space-y-2"><Label htmlFor="currencyCode">{english ? 'Policy currency' : 'Devise de la politique'}</Label><Input id="currencyCode" name="currencyCode" maxLength={3} pattern="[A-Za-z]{3}" defaultValue={safetyPolicy?.currencyCode ?? 'EUR'} disabled={!isAdmin} /></div>
              <div className="space-y-2"><Label htmlFor="maximumDailyBudget">{english ? 'Maximum daily budget' : 'Budget quotidien maximal'}</Label><Input id="maximumDailyBudget" name="maximumDailyBudget" type="number" min="0.01" step="0.01" defaultValue={safetyPolicy?.maximumDailyBudgetMicros ? Number(safetyPolicy.maximumDailyBudgetMicros) / 1_000_000 : ''} disabled={!isAdmin} /></div>
              <div className="space-y-2"><Label htmlFor="maximumMonthlySpend">{english ? 'Maximum calendar-month spend' : 'Dépense maximale du mois calendaire'}</Label><Input id="maximumMonthlySpend" name="maximumMonthlySpend" type="number" min="0.01" step="0.01" defaultValue={safetyPolicy?.maximumMonthlySpendMicros ? Number(safetyPolicy.maximumMonthlySpendMicros) / 1_000_000 : ''} disabled={!isAdmin} /></div>
              <div className="space-y-2"><Label htmlFor="maximumVariationPercent">{english ? 'Maximum variation per change (%)' : 'Variation maximale par changement (%)'}</Label><Input id="maximumVariationPercent" name="maximumVariationPercent" type="number" min="0.01" max="1000" step="0.01" defaultValue={safetyPolicy?.maximumVariationPercent ?? ''} disabled={!isAdmin} /></div>
              <div className="space-y-2"><Label htmlFor="notificationEmail">{english ? 'Operations email' : 'Email opérationnel'}</Label><Input id="notificationEmail" name="notificationEmail" type="email" defaultValue={workspace.notificationEmail ?? ''} disabled={!isAdmin} /></div>
              {isAdmin && <Button type="submit" variant="outline" className="w-full">{english ? 'Save limits' : 'Enregistrer les limites'}</Button>}
            </form>
            {safetyPolicies.length > 0 && <div className="mt-5 space-y-2 border-t pt-5"><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{english ? 'Active precedence' : 'Priorité active'} · {english ? 'campaign → client → workspace' : 'campagne → client → workspace'}</p>{safetyPolicies.map((policy) => { const policyClient = clients.find((client) => client.id === policy.clientId); return <div key={policy.id} className="rounded-xl bg-[#f7f9fa] px-3 py-2 text-xs"><span className="font-semibold">{policy.campaignId ? `${english ? 'Campaign' : 'Campagne'} ${policy.campaignId}` : policyClient ? policyClient.name : 'Workspace'}</span> · {policy.currencyCode}{policy.maximumDailyBudgetMicros ? ` · ${english ? 'daily max' : 'max/jour'} ${Number(policy.maximumDailyBudgetMicros) / 1_000_000}` : ''}{policy.maximumMonthlySpendMicros ? ` · ${english ? 'monthly max' : 'max/mois'} ${Number(policy.maximumMonthlySpendMicros) / 1_000_000}` : ''}{policy.maximumVariationPercent ? ` · Δ ${policy.maximumVariationPercent}%` : ''}</div> })}</div>}
          </CardContent>
        </Card>

        {notificationsEnabled && <Card className="border-[#e8e5ef] shadow-sm">
          <CardHeader>
            <div className="flex items-center gap-3">
              <span className="grid size-10 place-items-center rounded-xl bg-sky-50 text-sky-700"><BellRing className="size-5" /></span>
              <div><CardTitle>{english ? 'Notifications' : 'Notifications'}</CardTitle><p className="mt-1 text-sm text-muted-foreground">{english ? 'Email, Slack, Teams or generic webhook.' : 'Email, Slack, Teams ou webhook générique.'}</p></div>
            </div>
          </CardHeader>
          <CardContent>
            {isAdmin && entitlements.capabilities.has('notifications.webhook') && (
              <div className="mb-5 grid gap-3 md:grid-cols-2">
                {slackReady && <div className="flex flex-col justify-between gap-3 rounded-xl border border-[#e8e5ef] bg-[#fafbfc] p-4">
                  <div><p className="text-sm font-semibold">Slack OAuth</p><p className="mt-1 text-xs text-muted-foreground">{english ? 'Choose a Slack channel during installation. The generated webhook is encrypted and never displayed.' : 'Choisissez un canal Slack pendant l’installation. Le webhook généré est chiffré et n’est jamais affiché.'}</p></div>
                  <Button asChild variant="outline"><a href="/api/connectors/slack/connect"><Cable className="mr-2 size-4" />{english ? 'Connect Slack' : 'Connecter Slack'}</a></Button>
                </div>}
                {teamsReady && <div className="flex flex-col justify-between gap-3 rounded-xl border border-[#e8e5ef] bg-[#fafbfc] p-4">
                  <div><p className="text-sm font-semibold">Microsoft Teams OAuth</p><p className="mt-1 text-xs text-muted-foreground">{english ? 'Grant delegated Microsoft Graph access, then select an accessible team and channel.' : 'Accordez l’accès Microsoft Graph délégué, puis choisissez une équipe et un canal accessibles.'}</p></div>
                  <Button asChild variant="outline"><a href="/api/connectors/teams/connect"><Cable className="mr-2 size-4" />{english ? 'Connect Teams' : 'Connecter Teams'}</a></Button>
                </div>}
              </div>
            )}
            {isAdmin && (
              <form action={createNotificationChannel} className="grid gap-3 sm:grid-cols-2">
                <Input name="label" aria-label={english ? 'Channel name' : 'Nom du canal'} placeholder={english ? 'Agency operations' : 'Ops agence'} required />
                <select name="kind" aria-label={english ? 'Channel type' : 'Type de canal'} className="h-10 rounded-lg border bg-white px-3 text-sm"><option value="email">Email</option>{slackReady && <option value="slack">Slack</option>}{teamsReady && <option value="teams">Teams</option>}<option value="webhook">Webhook</option></select>
                <Input name="destination" aria-label={english ? 'Channel destination' : 'Destination du canal'} placeholder={english ? 'email@agency.com or https://…' : 'email@agence.fr ou https://…'} required className="sm:col-span-2" />
                <select name="minimumSeverity" aria-label={english ? 'Minimum severity' : 'Sévérité minimale'} className="h-10 rounded-lg border bg-white px-3 text-sm"><option value="warning">{english ? 'Warnings and critical alerts' : 'Alertes et critiques'}</option><option value="critical">{english ? 'Critical only' : 'Critiques uniquement'}</option></select>
                <Button type="submit"><Plus className="mr-2 size-4" />{english ? 'Add' : 'Ajouter'}</Button>
              </form>
            )}
            <div className="mt-5 space-y-2">
              {channels.map((channel) => (
                <div key={channel.id} className="flex items-center justify-between rounded-xl bg-[#f7f9fa] px-4 py-3">
                  <div><p className="text-sm font-medium">{channel.label} · {channel.kind}</p><p className="mt-1 text-[11px] text-muted-foreground">{channel.destinationHint} · {english ? 'threshold' : 'seuil'} {channel.minimumSeverity}{channel.lastError ? ` · ${english ? 'error' : 'erreur'} : ${channel.lastError}` : ''}</p></div>
                  {isAdmin && <form action={disableNotificationChannel}><input type="hidden" name="channelId" value={channel.id} /><Button type="submit" size="sm" variant="ghost"><Trash2 className="size-4" /></Button></form>}
                </div>
              ))}
              {channels.length === 0 && <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">{english ? 'No active channel. Incidents remain available in the cockpit.' : 'Aucun canal actif. Les incidents restent disponibles dans le cockpit.'}</p>}
            </div>
          </CardContent>
        </Card>}

        {notificationsEnabled && <Card className="border-[#e8e5ef] shadow-sm xl:col-span-2">
          <CardHeader>
            <div className="flex items-center gap-3">
              <span className="grid size-10 place-items-center rounded-xl bg-teal-50 text-teal-700"><UserRound className="size-5" /></span>
              <div><CardTitle>{english ? 'My task notifications' : 'Mes notifications de tâches'}</CardTitle><p className="mt-1 text-sm text-muted-foreground">{english ? 'Your verified Better Auth email is encrypted when saved and is never displayed.' : 'Votre email Better Auth vérifié est chiffré au moment de l’enregistrement et n’est jamais affiché.'}</p></div>
            </div>
          </CardHeader>
          <CardContent>
            <form action={updateMyTaskNotificationPreferences} className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <div className="space-y-2"><Label htmlFor="mentionHandle">{english ? 'Mention handle' : 'Identifiant de mention'}</Label><div className="flex items-center"><span className="rounded-l-lg border border-r-0 bg-slate-50 px-3 py-2 text-sm">@</span><Input id="mentionHandle" name="mentionHandle" defaultValue={taskPreferences?.mentionHandle ?? ''} placeholder="yoann" pattern="[a-z0-9][a-z0-9_-]{1,31}" required className="rounded-l-none" /></div></div>
              <div className="space-y-2"><Label htmlFor="digestCadence">{english ? 'Personal digest' : 'Digest personnel'}</Label><select id="digestCadence" name="digestCadence" defaultValue={taskPreferences?.digestCadence ?? 'none'} className="h-10 w-full rounded-lg border bg-white px-3 text-sm"><option value="none">{english ? 'Disabled' : 'Désactivé'}</option><option value="daily">{english ? 'Every day' : 'Chaque jour'}</option><option value="weekly">{english ? 'Every Monday' : 'Chaque lundi'}</option></select></div>
              <div className="space-y-2"><Label htmlFor="digestHour">{english ? 'Local time' : 'Heure locale'}</Label><Input id="digestHour" name="digestHour" type="number" min={0} max={23} defaultValue={taskPreferences?.digestHour ?? 8} required /></div>
              <div className="space-y-2"><Label htmlFor="taskTimezone">{english ? 'Timezone' : 'Fuseau horaire'}</Label><Input id="taskTimezone" name="timezone" defaultValue={taskPreferences?.timezone ?? workspace.timezone} required /></div>
              <label className="flex items-center gap-2 text-sm md:col-span-2"><input type="checkbox" name="mentionNotifications" defaultChecked={taskPreferences?.mentionNotifications ?? true} /> {english ? 'Email me when a member mentions me' : 'M’envoyer un email lorsqu’un membre me mentionne'}</label>
              <Button type="submit" variant="outline" className="md:col-span-2 xl:col-span-2">{english ? 'Save my preferences' : 'Enregistrer mes préférences'}</Button>
            </form>
            {taskPreferences?.lastDigestAt && <p className="mt-3 text-xs text-muted-foreground">{english ? 'Last digest processed' : 'Dernier digest traité'} : {taskPreferences.lastDigestAt.toLocaleString(english ? 'en-GB' : 'fr-FR')}</p>}
            {taskPreferences?.lastError && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">{english ? 'Last error' : 'Dernière erreur'} : {taskPreferences.lastError}</p>}
          </CardContent>
        </Card>}

        <Card className="border-[#e8e5ef] shadow-sm xl:col-span-2">
          <CardContent className="flex items-start gap-4 p-5">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-emerald-50 text-emerald-700">
              <ShieldCheck className="size-5" />
            </span>
            <div>
              <h2 className="font-semibold">{english ? 'Active security' : 'Sécurité active'}</h2>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                {english ? 'Sessions and roles through Better Auth, organization-scoped data in Neon, encrypted tokens, Google Ads requests validated before approval and a complete audit log.' : 'Sessions et rôles via Better Auth, données par organisation dans Neon, jetons chiffrés, requêtes Google Ads validées avant approbation et journal d’audit complet.'}
              </p>
              <AuthSecurityControls locale={locale} />
            </div>
          </CardContent>
        </Card>

        {canUseCustomDomain && (
          <Card className="border-[#e8e5ef] shadow-sm xl:col-span-2">
            <CardContent className="p-6">
              <div className="flex items-start gap-4">
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-indigo-50 text-indigo-700"><Globe2 className="size-5" /></span>
                <div><h2 className="font-semibold">{english ? 'Agency custom domain' : 'Domaine personnalisé Agency'}</h2><p className="mt-1 text-sm text-muted-foreground">{english ? 'One domain at a time. It is used only after Yodev TXT proof, Vercel validation, DNS configuration and a successful HTTPS test.' : 'Un seul domaine à la fois. Il n’est utilisé qu’après preuve TXT Yodev, validation Vercel, configuration DNS et test HTTPS réussi.'}</p></div>
              </div>
              {query.reveal === 'domain-dns' && <SecretRevelation title={english ? 'DNS challenge · one-time reveal' : 'Challenge DNS · révélation unique'} buttonLabel={english ? 'Reveal TXT record' : 'Révéler l’enregistrement TXT'} />}
              {domains.length === 0 && isAdmin && (
                <form action={createWorkspaceDomain} className="mt-5 flex max-w-xl gap-2">
                  <Input name="hostname" placeholder={english ? 'reports.your-agency.com' : 'rapports.votre-agence.fr'} required />
                  <Button type="submit"><Plus className="mr-2 size-4" />{english ? 'Configure' : 'Configurer'}</Button>
                </form>
              )}
              <div className="mt-5 space-y-3">
                {domains.map((domain) => (
                  <div key={domain.id} className="rounded-xl bg-[#f7f9fa] p-4">
                    <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                      <div><p className="font-medium">{domain.hostname}</p><p className="mt-1 text-xs text-muted-foreground">Yodev : {domain.verificationStatus} · Vercel : {domain.vercelStatus}</p></div>
                      {isAdmin && <div className="flex gap-2"><form action={verifyWorkspaceDomain}><input type="hidden" name="domainId" value={domain.id} /><Button size="sm" variant="outline"><RefreshCw className="mr-2 size-4" />{english ? 'Verify' : 'Vérifier'}</Button></form><form action={revokeWorkspaceDomain}><input type="hidden" name="domainId" value={domain.id} /><Button size="sm" variant="ghost"><Trash2 className="mr-2 size-4" />{english ? 'Revoke' : 'Révoquer'}</Button></form></div>}
                    </div>
                    {domain.vercelConfiguration && <details className="mt-3 text-xs"><summary className="cursor-pointer text-muted-foreground">{english ? 'DNS configuration returned by Vercel' : 'Configuration DNS retournée par Vercel'}</summary><pre className="mt-2 overflow-x-auto whitespace-pre-wrap rounded-lg bg-white p-3">{JSON.stringify(domain.vercelConfiguration, null, 2)}</pre></details>}
                    {domain.lastError && <p className="mt-3 text-xs text-red-700">{domain.lastError}</p>}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {isAdmin && (
          <Card className="border-[#e8e5ef] shadow-sm xl:col-span-2">
            <CardContent className="p-6">
              <div className="flex items-start gap-4"><span className="grid size-10 shrink-0 place-items-center rounded-xl bg-rose-50 text-rose-700"><Workflow className="size-5" /></span><div><h2 className="font-semibold">{english ? 'Operational dead letter' : 'Dead-letter opérationnelle'}</h2><p className="mt-1 text-sm text-muted-foreground">{english ? 'Jobs that exhausted their attempts. Retrying is audited and adds five attempts without reusing an attempt number.' : 'Jobs arrivés au terme de leurs tentatives. La relance est auditée et ajoute cinq tentatives sans réutiliser un numéro d’essai.'}</p></div></div>
              {deadLetters.length === 0 ? <p className="mt-5 rounded-xl border border-dashed p-4 text-sm text-muted-foreground">{english ? 'No dead-letter job.' : 'Aucun job en dead-letter.'}</p> : <div className="mt-5 space-y-2">{deadLetters.map((job) => <div key={job.id} className="flex flex-col justify-between gap-3 rounded-xl bg-[#f7f9fa] px-4 py-3 sm:flex-row sm:items-center"><div><p className="text-sm font-medium">{job.type}</p><p className="mt-1 text-xs text-muted-foreground">{job.lastError ?? (english ? 'Undocumented error' : 'Erreur non documentée')} · {job.attemptCount}/{job.maximumAttempts} {english ? 'attempts' : 'tentatives'}</p></div><form action={retryDeadLetterJob}><input type="hidden" name="jobId" value={job.id} /><Button type="submit" size="sm" variant="outline"><RefreshCw className="mr-2 size-4" />{english ? 'Retry' : 'Relancer'}</Button></form></div>)}</div>}
            </CardContent>
          </Card>
        )}

        {canUsePrivateApi && <Card className="border-[#e8e5ef] shadow-sm xl:col-span-2">
          <CardContent className="p-6">
            <div className="flex items-start gap-4">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-sky-50 text-sky-700">
                <KeyRound className="size-5" />
              </span>
              <div>
                <h2 className="font-semibold">{english ? 'Agency API' : 'API d’agence'}</h2>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                  {english ? 'Connect Codex, Claude Code or your internal tools to the Ads by Yodev portfolio with a revocable key.' : 'Branchez Codex, Claude Code ou vos outils internes sur le portefeuille Ads by Yodev via une clé révocable.'}
                </p>
              </div>
            </div>
            {query.reveal === 'api-key' && (
              <SecretRevelation title={english ? 'New key · one-time reveal' : 'Nouvelle clé · révélation unique'} buttonLabel={english ? 'Reveal and copy now' : 'Révéler et copier maintenant'} />
            )}
            {isAdmin && (
              <form action={createAgencyApiKey} className="mt-5 flex max-w-xl gap-2">
                <Input name="name" placeholder="Codex production" required />
                <Button type="submit">
                  <Plus className="mr-2 size-4" />
                  {english ? 'Create key' : 'Créer une clé'}
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
                      {key.lastUsedAt ? `${english ? 'used' : 'utilisée'} ${key.lastUsedAt.toLocaleString(english ? 'en-GB' : 'fr-FR')}` : (english ? 'never used' : 'jamais utilisée')}
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
              <p className="text-xs font-medium">{english ? 'Ready-to-use endpoint' : 'Endpoint prêt à l’emploi'}</p>
              <code className="mt-2 block overflow-x-auto text-xs text-muted-foreground">
                curl -H &quot;Authorization: Bearer $YODEV_ADS_API_KEY&quot; https://ads.yodev.fr/api/v1/portfolio
              </code>
            </div>
          </CardContent>
        </Card>}
      </div>
    </>
  )
}
