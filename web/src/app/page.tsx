import Link from 'next/link'
import { SignInButton } from '@clerk/nextjs'
import { auth } from '@clerk/nextjs/server'
import { ArrowRight, Check, Radar, ShieldCheck, Sparkles, UsersRound } from 'lucide-react'
import { Button } from '@/components/ui/button'

const features = [
  {
    icon: Radar,
    title: 'Vue agence instantanée',
    description: 'Dépenses, conversions, budgets et statuts réunis pour chaque compte client.',
  },
  {
    icon: ShieldCheck,
    title: 'Changements sous contrôle',
    description: 'Chaque écriture est validée par Google, approuvée et consignée avant exécution.',
  },
  {
    icon: UsersRound,
    title: 'Vraiment multi-tenant',
    description: 'Organisations, rôles, marque blanche et données cloisonnées dès la base.',
  },
]

export default async function Home() {
  const { userId } = await auth()
  return (
    <main className="min-h-screen overflow-hidden bg-[#f8f7ff] text-[#151326]">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[760px] bg-[radial-gradient(circle_at_20%_10%,rgba(139,92,246,.18),transparent_35%),radial-gradient(circle_at_80%_0%,rgba(45,212,191,.14),transparent_30%)]" />
      <nav className="relative mx-auto flex max-w-7xl items-center justify-between px-6 py-6 lg:px-8">
        <Link href="/" className="flex items-center gap-3 font-semibold tracking-tight">
          <span className="grid size-9 place-items-center rounded-xl bg-[#635bff] text-white shadow-lg shadow-violet-500/25">
            <Radar className="size-5" />
          </span>
          <span className="text-xl">VigieAds</span>
        </Link>
        <div className="flex items-center gap-3">
          {!userId ? <>
            <SignInButton mode="modal">
              <Button variant="ghost">Se connecter</Button>
            </SignInButton>
            <Button asChild className="rounded-full bg-[#151326] px-5 text-white hover:bg-[#27233f]">
              <Link href="/sign-up">Créer mon espace</Link>
            </Button>
          </> : (
            <Button asChild className="rounded-full bg-[#151326] px-5 text-white hover:bg-[#27233f]">
              <Link href="/dashboard">Ouvrir le cockpit</Link>
            </Button>
          )}
        </div>
      </nav>

      <section className="relative mx-auto grid max-w-7xl gap-14 px-6 pb-24 pt-20 lg:grid-cols-[1.05fr_.95fr] lg:px-8 lg:pt-28">
        <div>
          <div className="mb-7 inline-flex items-center gap-2 rounded-full border border-violet-200 bg-white/80 px-4 py-2 text-sm font-medium text-violet-700 shadow-sm backdrop-blur">
            <Sparkles className="size-4" /> Conçu pour les opérateurs Google Ads exigeants
          </div>
          <h1 className="max-w-3xl text-balance text-5xl font-semibold leading-[1.03] tracking-[-0.055em] sm:text-6xl lg:text-7xl">
            Tous vos comptes.
            <span className="block bg-gradient-to-r from-[#635bff] to-[#9b5de5] bg-clip-text text-transparent">
              Zéro angle mort.
            </span>
          </h1>
          <p className="mt-7 max-w-xl text-lg leading-8 text-[#666078] sm:text-xl">
            VigieAds transforme votre MCC en cockpit clair : vous voyez ce qui compte, votre équipe collabore et aucune
            modification sensible ne part sans garde-fou.
          </p>
          <div className="mt-9 flex flex-wrap items-center gap-4">
            <Button asChild size="lg" className="h-12 rounded-full bg-[#635bff] px-6 text-white shadow-xl shadow-violet-500/20 hover:bg-[#554ee8]">
              <Link href="/sign-up">
                Lancer mon cockpit <ArrowRight className="ml-1 size-4" />
              </Link>
            </Button>
            <span className="flex items-center gap-2 text-sm text-[#666078]">
              <Check className="size-4 text-emerald-600" /> Connexion officielle Google Ads API
            </span>
          </div>
        </div>

        <div className="relative min-h-[440px]">
          <div className="absolute inset-0 rotate-3 rounded-[2.2rem] bg-gradient-to-br from-[#635bff] to-[#9b5de5] opacity-15 blur-sm" />
          <div className="relative rounded-[2rem] border border-white/80 bg-white/90 p-5 shadow-[0_40px_100px_-35px_rgba(53,43,110,.4)] backdrop-blur sm:p-7">
            <div className="flex items-center justify-between border-b border-[#eeeaf8] pb-5">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[.18em] text-[#8d87a0]">Vue portefeuille</p>
                <p className="mt-1 text-lg font-semibold">7 comptes surveillés</p>
              </div>
              <span className="rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700">Tout est calme</span>
            </div>
            <div className="mt-5 grid grid-cols-2 gap-3">
              {[
                ['Investissement', '18 420 €', '+8,2 %'],
                ['Conversions', '1 284', '+12,4 %'],
                ['CPA moyen', '14,34 €', '−3,8 %'],
                ['Alertes', '2', 'à examiner'],
              ].map(([label, value, trend]) => (
                <div key={label} className="rounded-2xl bg-[#f7f5fc] p-4">
                  <p className="text-xs text-[#827c93]">{label}</p>
                  <p className="mt-2 text-xl font-semibold tracking-tight">{value}</p>
                  <p className="mt-1 text-xs font-medium text-violet-600">{trend}</p>
                </div>
              ))}
            </div>
            <div className="mt-5 rounded-2xl border border-[#eeeaf8] p-4">
              <div className="flex items-end justify-between gap-2">
                {[38, 52, 47, 68, 62, 84, 74, 96, 82, 108, 98, 126].map((height, index) => (
                  <div key={index} className="w-full rounded-t-md bg-gradient-to-t from-[#635bff] to-[#a78bfa]" style={{ height }} />
                ))}
              </div>
              <div className="mt-3 flex justify-between text-[10px] uppercase tracking-wider text-[#9a95a8]">
                <span>Juin</span><span>Aujourd’hui</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="relative border-y border-[#ece8f6] bg-white/75">
        <div className="mx-auto grid max-w-7xl gap-px px-6 py-16 lg:grid-cols-3 lg:px-8">
          {features.map(({ icon: Icon, title, description }) => (
            <article key={title} className="p-6 lg:p-8">
              <span className="grid size-11 place-items-center rounded-2xl bg-violet-50 text-violet-700"><Icon className="size-5" /></span>
              <h2 className="mt-5 text-xl font-semibold tracking-tight">{title}</h2>
              <p className="mt-2 leading-7 text-[#716b80]">{description}</p>
            </article>
          ))}
        </div>
      </section>

      <footer className="relative mx-auto flex max-w-7xl flex-col gap-4 px-6 py-10 text-sm text-[#7d778d] sm:flex-row sm:items-center sm:justify-between lg:px-8">
        <span>© {new Date().getFullYear()} VigieAds. Pilotage serein, décisions traçables.</span>
        <div className="flex gap-5"><Link href="/privacy">Confidentialité</Link><Link href="/terms">Conditions</Link></div>
      </footer>
    </main>
  )
}
