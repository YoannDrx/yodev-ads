import { Check, CreditCard, ExternalLink, ShieldCheck } from 'lucide-react'
import { createCheckoutSession, openBillingPortal } from '@/app/actions'
import { FlashMessage } from '@/components/flash-message'
import { PageHeading } from '@/components/page-heading'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { hasStripeConfiguration, planCatalog, subscriptionIsActive } from '@/lib/billing'
import { listWorkspaceClients } from '@/lib/data'
import { requireWorkspace } from '@/lib/workspace'

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; error?: string }>
}) {
  const query = await searchParams
  const { workspace, isAdmin } = await requireWorkspace()
  const clients = (await listWorkspaceClients(workspace.id)).filter((client) => !client.isManager)
  const stripeReady = hasStripeConfiguration()
  const active = subscriptionIsActive(workspace.subscriptionStatus)
  const currentPlan = planCatalog[workspace.plan as keyof typeof planCatalog] ?? planCatalog.solo
  return (
    <>
      <PageHeading
        eyebrow="Facturation"
        title="Abonnement"
        description="Une tarification prévisible par nombre de comptes, pilotée par Stripe et appliquée à l’organisation."
        actions={
          workspace.stripeCustomerId && isAdmin ? (
            <form action={openBillingPortal}>
              <Button type="submit" variant="outline">
                Portail Stripe <ExternalLink className="ml-2 size-4" />
              </Button>
            </form>
          ) : undefined
        }
      />
      <FlashMessage notice={query.notice} error={query.error} />
      <div className="mb-6 flex flex-wrap items-center gap-3 rounded-2xl border bg-white p-4 text-sm">
        <span className={`size-2 rounded-full ${active ? 'bg-emerald-500' : 'bg-amber-500'}`} />
        <strong>Offre actuelle : {currentPlan.name}</strong>
        <span className="text-muted-foreground">· {clients.length} compte(s) connecté(s)</span>
        <span className="text-muted-foreground">· statut {workspace.subscriptionStatus}</span>
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
                    <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs text-emerald-700">Actuelle</span>
                  )}
                </div>
                <p className="mt-5 text-4xl font-semibold tracking-tight">
                  {plan.monthlyPrice} €
                  <span className="text-sm font-normal text-muted-foreground"> / mois</span>
                </p>
                <p className="mt-2 text-sm text-muted-foreground">Jusqu’à {plan.accountLimit} comptes Google Ads.</p>
                <ul className="mt-6 space-y-3">
                  {plan.features.map((feature) => (
                    <li key={feature} className="flex gap-2 text-sm">
                      <Check className="mt-0.5 size-4 text-emerald-600" />
                      {feature}
                    </li>
                  ))}
                </ul>
                <form action={createCheckoutSession} className="mt-7">
                  <input type="hidden" name="plan" value={id} />
                  <Button
                    type="submit"
                    className="w-full"
                    variant={current ? 'outline' : 'default'}
                    disabled={!isAdmin || !stripeReady}
                  >
                    <CreditCard className="mr-2 size-4" />
                    {stripeReady ? (current ? 'Gérer cette offre' : `Choisir ${plan.name}`) : 'Stripe à connecter'}
                  </Button>
                </form>
              </CardContent>
            </Card>
          )
        })}
      </section>
      <div className="mt-6 flex gap-3 rounded-2xl bg-[#0d1722] p-5 text-sm text-white/70">
        <ShieldCheck className="size-5 shrink-0 text-[#6af0b1]" />
        Les données de carte ne transitent jamais par Vigieads. Le checkout, les renouvellements, factures et
        annulations sont traités par Stripe.
      </div>
    </>
  )
}
