import { auth } from '@clerk/nextjs/server'
import { CreateOrganization } from '@clerk/nextjs'
import { redirect } from 'next/navigation'
import { Check, Radar, ShieldCheck, Sparkles } from 'lucide-react'

export default async function OnboardingPage() {
  const { userId, orgId } = await auth()
  if (!userId) redirect('/sign-in')
  if (orgId) redirect('/dashboard')
  return (
    <main className="grid min-h-screen place-items-center bg-[#0d1722] p-6 text-white">
      <div className="grid w-full max-w-5xl gap-10 lg:grid-cols-[.9fr_1.1fr] lg:items-center">
        <div className="text-center">
          <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-[#6af0b1] text-[#0d1722]">
            <Radar />
          </span>
          <h1 className="mt-5 text-3xl font-semibold tracking-[-.035em]">Bienvenue dans Vigieads</h1>
          <p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-white/55">
            Créez l’espace sécurisé qui contiendra vos clients, vos vigies et votre identité d’agence.
          </p>
          <div className="mx-auto mt-7 max-w-sm space-y-3 text-left">
            {[
              'Données cloisonnées par organisation',
              'Rôles et membres gérés avec Clerk',
              'Écritures Google Ads sous approbation',
            ].map((item) => (
              <p key={item} className="flex items-center gap-3 text-sm text-white/70">
                <span className="grid size-6 place-items-center rounded-full bg-[#6af0b1]/12 text-[#6af0b1]">
                  <Check className="size-3.5" />
                </span>
                {item}
              </p>
            ))}
          </div>
        </div>
        <div className="rounded-3xl bg-white p-6 text-[#0d1722] shadow-2xl shadow-black/20">
          <div className="mb-5 flex items-center justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-[.16em] text-[#287656]">Étape 1 sur 3</p>
              <p className="mt-1 font-semibold">Votre espace agence</p>
            </div>
            <div className="flex gap-2">
              <Sparkles className="size-4 text-[#287656]" />
              <ShieldCheck className="size-4 text-[#287656]" />
            </div>
          </div>
          <CreateOrganization afterCreateOrganizationUrl="/settings" />
        </div>
      </div>
    </main>
  )
}
