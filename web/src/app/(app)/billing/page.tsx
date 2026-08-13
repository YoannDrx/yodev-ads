import { Check, CreditCard, Download, ExternalLink, ShieldCheck } from 'lucide-react'
import { cancelSubscriptionAtPeriodEnd, cancelWorkspaceDeletion, createCheckoutSession, openBillingPortal, reactivateSubscription, requestWorkspaceDeletion, requestWorkspaceExport } from '@/app/actions'
import { FlashMessage } from '@/components/flash-message'
import { PageHeading } from '@/components/page-heading'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { hasStripeConfiguration, planCatalog, planFeaturesForLocale, subscriptionIsActive } from '@/lib/billing'
import { listWorkspaceClients, listWorkspaceExports } from '@/lib/data'
import { requireWorkspace } from '@/lib/workspace'

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; error?: string }>
}) {
  const query = await searchParams
  const { workspace, isAdmin, role } = await requireWorkspace()
  const english = workspace.locale === 'en'
  const locale = english ? 'en' : 'fr'
  const clients = (await listWorkspaceClients(workspace.id)).filter((client) => !client.isManager)
  const exports = role === 'owner' ? await listWorkspaceExports(workspace.id) : []
  const stripeReady = hasStripeConfiguration()
  const active = subscriptionIsActive(workspace.subscriptionStatus)
  const currentPlan = planCatalog[workspace.plan as keyof typeof planCatalog] ?? planCatalog.solo
  return (
    <>
      <PageHeading
        eyebrow={english ? 'Billing' : 'Facturation'}
        title={english ? 'Subscription' : 'Abonnement'}
        description={english ? 'Predictable account-based pricing, managed by Stripe and enforced for the organization.' : 'Une tarification prévisible par nombre de comptes, pilotée par Stripe et appliquée à l’organisation.'}
        actions={
          workspace.stripeCustomerId && isAdmin ? (
            <form action={openBillingPortal}>
              <Button type="submit" variant="outline">
                {english ? 'Stripe portal' : 'Portail Stripe'} <ExternalLink className="ml-2 size-4" />
              </Button>
            </form>
          ) : undefined
        }
      />
      <FlashMessage notice={query.notice} error={query.error} locale={locale} />
      <div className="mb-6 flex flex-wrap items-center gap-3 rounded-2xl border bg-white p-4 text-sm">
        <span className={`size-2 rounded-full ${active ? 'bg-emerald-500' : 'bg-amber-500'}`} />
        <strong>{english ? 'Current plan' : 'Offre actuelle'} : {currentPlan.name}</strong>
        <span className="text-muted-foreground">· {clients.length} {english ? `connected account${clients.length === 1 ? '' : 's'}` : 'compte(s) connecté(s)'}</span>
        <span className="text-muted-foreground">· {english ? 'status' : 'statut'} {workspace.subscriptionStatus}</span>
      </div>
      <section className="grid gap-5 lg:grid-cols-3">
        {Object.entries(planCatalog).map(([id, plan]) => {
          const current = workspace.plan === id
          return (
            <Card
              key={id}
              className={current ? 'border-[var(--brand-accent)] shadow-md' : 'border-[#dde4e7] shadow-none'}
            >
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold">{plan.name}</h2>
                  {current && (
                    <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs text-emerald-700">{english ? 'Current' : 'Actuelle'}</span>
                  )}
                </div>
                <p className="mt-5 text-4xl font-semibold tracking-tight">
                  {plan.monthlyPrice} €
                  <span className="text-sm font-normal text-muted-foreground"> / {english ? 'month' : 'mois'}</span>
                </p>
                <p className="mt-2 text-sm text-muted-foreground">{english ? `Up to ${plan.accountLimit} Google Ads accounts.` : `Jusqu’à ${plan.accountLimit} comptes Google Ads.`}</p>
                <ul className="mt-6 space-y-3">
                  {planFeaturesForLocale(id as keyof typeof planCatalog, locale).map((feature) => (
                    <li key={feature} className="flex gap-2 text-sm">
                      <Check className="mt-0.5 size-4 text-emerald-600" />
                      {feature}
                    </li>
                  ))}
                </ul>
                <form action={active ? openBillingPortal : createCheckoutSession} className="mt-7">
                  <input type="hidden" name="plan" value={id} />
                  {!active && <input type="hidden" name="checkoutAttemptId" value={crypto.randomUUID()} />}
                  {!active && <div className="mb-4 space-y-3 text-sm">
                    <Input name="billingEmail" type="email" defaultValue={workspace.billingEmail ?? ''} placeholder={english ? 'Billing email' : 'Email de facturation'} required />
                    <div className="grid grid-cols-[1fr_90px] gap-2">
                      <select name="customerType" aria-label={english ? 'Customer type' : 'Type de client'} className="h-10 rounded-lg border bg-white px-3 text-sm" required><option value="business">{english ? 'Business' : 'Professionnel'}</option><option value="individual">{english ? 'Individual' : 'Particulier'}</option></select>
                      <Input name="countryCode" aria-label={english ? 'Country' : 'Pays'} defaultValue={workspace.countryCode} maxLength={2} pattern="[A-Za-z]{2}" required />
                    </div>
                    <label className="flex items-start gap-2 text-xs leading-5"><input name="acceptLegal" type="checkbox" required className="mt-1" /><span>{english ? 'I accept the ' : 'J’accepte les '}<a className="underline" href="/terms" target="_blank">{english ? 'Terms' : 'CGV'}</a>{english ? ' and the ' : ' et la '}<a className="underline" href="/privacy" target="_blank">{english ? 'Privacy Policy' : 'politique de confidentialité'}</a>.</span></label>
                    <label className="flex items-start gap-2 text-xs leading-5"><input name="startImmediately" type="checkbox" required className="mt-1" /><span>{english ? 'I request immediate performance of the service before the withdrawal period ends and acknowledge the consequences described in the Terms.' : 'Je demande l’exécution immédiate du service avant la fin du délai de rétractation et reconnais les conséquences décrites dans les CGV.'}</span></label>
                  </div>}
                  <Button
                    type="submit"
                    className="w-full"
                    variant={current ? 'outline' : 'default'}
                    disabled={!isAdmin || !stripeReady}
                  >
                    <CreditCard className="mr-2 size-4" />
                    {stripeReady ? (active ? english ? 'Manage or change with Stripe' : 'Gérer ou changer via Stripe' : `${english ? 'Choose' : 'Choisir'} ${plan.name}`) : english ? 'Connect Stripe' : 'Stripe à connecter'}
                  </Button>
                </form>
              </CardContent>
            </Card>
          )
        })}
      </section>
      <div className="mt-6 flex gap-3 rounded-2xl bg-[#0d1722] p-5 text-sm text-white/70">
        <ShieldCheck className="size-5 shrink-0 text-[#19A58F]" />
        {english ? 'Card data never passes through Ads by Yodev. Checkout, renewals, invoices and cancellations are handled by Stripe.' : 'Les données de carte ne transitent jamais par Ads by Yodev. Le checkout, les renouvellements, factures et annulations sont traités par Stripe.'}
      </div>
      {active && isAdmin && (
        <Card className="mt-6 border-[#dde4e7] shadow-none"><CardContent className="flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="font-semibold">{english ? 'Online cancellation' : 'Résiliation électronique'}</h2><p className="mt-1 text-sm text-muted-foreground">{english ? 'Access remains active until the end of the paid period. You can withdraw the cancellation request before then.' : 'L’accès reste actif jusqu’à la fin de la période déjà payée. Vous pourrez annuler la demande avant cette date.'}</p></div><div className="flex gap-2"><form action={cancelSubscriptionAtPeriodEnd}><Button type="submit" variant="outline">{english ? 'Cancel at period end' : 'Résilier à l’échéance'}</Button></form><form action={reactivateSubscription}><Button type="submit" variant="ghost">{english ? 'Undo cancellation' : 'Annuler une résiliation'}</Button></form></div></CardContent></Card>
      )}
      {role === 'owner' && (
        <Card className="mt-6 border-[#dde4e7] shadow-none">
          <CardContent className="p-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div><h2 className="font-semibold">{english ? 'Data export' : 'Export des données'}</h2><p className="mt-1 text-sm text-muted-foreground">{english ? 'Complete secret-free ZIP archive, retained for seven days.' : 'Archive ZIP complète sans secrets, conservée pendant sept jours.'}</p></div>
              <form action={requestWorkspaceExport}><Button type="submit" variant="outline"><Download className="mr-2 size-4" />{english ? 'Create export' : 'Créer un export'}</Button></form>
            </div>
            {exports.length > 0 && <ul className="mt-5 divide-y text-sm">{exports.map((item) => <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 py-3"><span>{english ? 'Requested on' : 'Demandé le'} {item.createdAt.toLocaleString(english ? 'en-GB' : 'fr-FR')} · {item.status} · {item.progress}%</span>{item.status === 'completed' && item.expiresAt && item.expiresAt > new Date() ? <a className="font-medium text-[var(--brand-accent)] underline" href={`/api/exports/${item.id}`}>{english ? 'Download' : 'Télécharger'}</a> : null}</li>)}</ul>}
          </CardContent>
        </Card>
      )}
      {role === 'owner' && (
        <Card className="mt-6 border-red-200 shadow-none">
          <CardContent className="p-6">
            <h2 className="font-semibold text-red-800">{english ? 'Delete workspace' : 'Suppression de l’espace'}</h2>
            {workspace.accessState === 'deletion_pending' ? (
              <div className="mt-3">
                <p className="text-sm text-muted-foreground">{english ? 'Access and secrets have been revoked. Final purge is scheduled for' : 'Les accès et secrets ont été révoqués. La purge définitive est prévue le'} {workspace.purgeAt?.toLocaleDateString(english ? 'en-GB' : 'fr-FR')}.</p>
                <form action={cancelWorkspaceDeletion} className="mt-4"><Button type="submit" variant="outline">{english ? 'Cancel deletion' : 'Annuler la suppression'}</Button></form>
              </div>
            ) : (
              <form action={requestWorkspaceDeletion} className="mt-3 max-w-xl space-y-3">
                <p className="text-sm text-muted-foreground">{english ? 'This immediately revokes Google Ads, API keys and reports. Purge occurs after 30 days and can be cancelled before the deadline.' : 'Cette action révoque immédiatement Google Ads, les clés API et les rapports. La purge intervient après 30 jours et peut être annulée avant l’échéance.'}</p>
                <Input name="confirmation" placeholder={english ? 'Type DELETE' : 'Tapez SUPPRIMER'} pattern={english ? 'DELETE' : 'SUPPRIMER'} required />
                <Button type="submit" variant="destructive">{english ? 'Schedule deletion' : 'Programmer la suppression'}</Button>
              </form>
            )}
          </CardContent>
        </Card>
      )}
    </>
  )
}
