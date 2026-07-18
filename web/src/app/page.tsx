import Link from 'next/link'
import { SignInButton } from '@clerk/nextjs'
import { auth } from '@clerk/nextjs/server'
import { ArrowRight, BellRing, Bot, Check, Eye, Gauge, ShieldCheck, Sparkles, UsersRound } from 'lucide-react'
import { Button } from '@/components/ui/button'

const pillars = [
  {
    icon: Eye,
    title: 'Détecter',
    description: 'Une vue portefeuille lisible et des anomalies calculées sur les données Google Ads réelles.',
  },
  {
    icon: Sparkles,
    title: 'Expliquer',
    description: 'Chaque signal indique le compte, la campagne, le seuil et la raison exacte du déclenchement.',
  },
  {
    icon: ShieldCheck,
    title: 'Approuver',
    description: 'Les écritures sont validées par Google, approuvées par un humain puis consignées.',
  },
  {
    icon: Bot,
    title: 'Agir',
    description: 'Des vigies quotidiennes, une API d’agence et des rapports clients qui travaillent sans vous.',
  },
]

const plans = [
  {
    name: 'Solo',
    price: '29 €',
    note: 'Pour démarrer proprement',
    accounts: '3 comptes clients',
    features: ['Cockpit Google Ads', '4 vigies autonomes', 'Approbations sécurisées', 'Rapports clients'],
  },
  {
    name: 'Studio',
    price: '89 €',
    note: 'Le choix des consultants',
    accounts: '15 comptes clients',
    featured: true,
    features: ['Tout Solo', 'Marque blanche', 'API d’agence', 'Historique et audit complet'],
  },
  {
    name: 'Agency',
    price: '189 €',
    note: 'Pour les équipes en croissance',
    accounts: '50 comptes clients',
    features: ['Tout Studio', 'Rôles avancés', 'Portails clients illimités', 'Support prioritaire'],
  },
]

export default async function Home() {
  const { userId } = await auth()
  return (
    <main className="min-h-screen overflow-hidden bg-[#f4f7f7] text-[#0d1722]">
      <section className="relative bg-[#0d1722] text-white">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_76%_12%,rgba(106,240,177,.17),transparent_28%),radial-gradient(circle_at_40%_100%,rgba(69,139,255,.12),transparent_34%)]" />
        <nav className="relative mx-auto flex max-w-7xl items-center justify-between px-6 py-6 lg:px-8">
          <Brand />
          <div className="flex items-center gap-3">
            {!userId ? (
              <>
                <SignInButton mode="modal">
                  <Button variant="ghost" className="text-white hover:bg-white/10 hover:text-white">
                    Se connecter
                  </Button>
                </SignInButton>
                <Button asChild className="rounded-full bg-[#6af0b1] px-5 text-[#0d1722] hover:bg-[#8ff8c7]">
                  <Link href="/sign-up">Essayer Vigihat</Link>
                </Button>
              </>
            ) : (
              <Button asChild className="rounded-full bg-[#6af0b1] px-5 text-[#0d1722]">
                <Link href="/dashboard">Ouvrir Vigihat</Link>
              </Button>
            )}
          </div>
        </nav>
        <div className="relative mx-auto grid max-w-7xl gap-14 px-6 pb-24 pt-20 lg:grid-cols-[1.06fr_.94fr] lg:px-8 lg:pb-32 lg:pt-28">
          <div>
            <p className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/6 px-4 py-2 text-sm text-[#a9f7cf]">
              <Sparkles className="size-4" /> Google Ads, sans angle mort
            </p>
            <h1 className="mt-7 max-w-3xl text-balance text-5xl font-semibold leading-[1.01] tracking-[-.055em] sm:text-6xl lg:text-7xl">
              Le système d’exploitation des agences Google Ads.
            </h1>
            <p className="mt-7 max-w-2xl text-lg leading-8 text-white/62 sm:text-xl">
              Vigihat surveille chaque compte, explique les anomalies et sécurise les changements — pour gérer plus de
              clients sans perdre le contrôle.
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-4">
              <Button
                asChild
                size="lg"
                className="h-12 rounded-full bg-[#6af0b1] px-6 text-[#0d1722] shadow-xl shadow-emerald-500/10 hover:bg-[#8ff8c7]"
              >
                <Link href="/sign-up">
                  Démarrer l’essai <ArrowRight className="ml-2 size-4" />
                </Link>
              </Button>
              <span className="flex items-center gap-2 text-sm text-white/55">
                <Check className="size-4 text-[#6af0b1]" /> API Google Ads officielle
              </span>
            </div>
          </div>
          <ProductPreview />
        </div>
      </section>

      <section className="border-b border-black/6 bg-white">
        <div className="mx-auto grid max-w-7xl grid-cols-2 gap-y-8 px-6 py-10 text-center sm:grid-cols-4 lg:px-8">
          {[
            ['100 %', 'traçable'],
            ['24 h', 'validité des approbations'],
            ['AES-256', 'chiffrement des jetons'],
            ['0', 'écriture sans validation'],
          ].map(([value, label]) => (
            <div key={label}>
              <p className="text-2xl font-semibold tracking-tight">{value}</p>
              <p className="mt-1 text-xs uppercase tracking-wider text-[#77828b]">{label}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-6 py-24 lg:px-8">
        <div className="max-w-2xl">
          <p className="text-xs font-bold uppercase tracking-[.2em] text-[#287656]">Un cycle de décision complet</p>
          <h2 className="mt-4 text-4xl font-semibold tracking-[-.045em] sm:text-5xl">
            De la donnée brute à l’action sûre.
          </h2>
          <p className="mt-5 text-lg leading-8 text-[#64717b]">
            Vigihat ne se contente pas d’afficher des métriques. Il organise le travail quotidien de votre agence.
          </p>
        </div>
        <div className="mt-12 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {pillars.map(({ icon: Icon, title, description }, index) => (
            <article key={title} className="rounded-3xl border border-black/7 bg-white p-6">
              <span className="text-xs font-semibold text-[#98a2aa]">0{index + 1}</span>
              <span className="mt-8 grid size-11 place-items-center rounded-2xl bg-[#e6f8ef] text-[#1e7152]">
                <Icon className="size-5" />
              </span>
              <h3 className="mt-5 text-xl font-semibold">{title}</h3>
              <p className="mt-2 text-sm leading-6 text-[#6d7983]">{description}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="bg-[#e9f0f1]">
        <div className="mx-auto max-w-7xl px-6 py-24 lg:px-8">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-[.2em] text-[#287656]">Tarification transparente</p>
              <h2 className="mt-4 text-4xl font-semibold tracking-[-.045em] sm:text-5xl">
                Payez pour les comptes gérés,
                <br />
                pas pour des clics dans l’outil.
              </h2>
            </div>
            <p className="max-w-md text-sm leading-6 text-[#64717b]">
              14 jours d’essai. Deux mois offerts en paiement annuel. Aucune commission sur vos dépenses publicitaires.
            </p>
          </div>
          <div className="mt-12 grid gap-5 lg:grid-cols-3">
            {plans.map((plan) => (
              <article
                key={plan.name}
                className={`relative rounded-3xl border p-7 ${plan.featured ? 'border-[#0d1722] bg-[#0d1722] text-white shadow-2xl shadow-slate-900/15' : 'border-black/7 bg-white'}`}
              >
                {plan.featured && (
                  <span className="absolute right-6 top-6 rounded-full bg-[#6af0b1] px-3 py-1 text-xs font-semibold text-[#0d1722]">
                    Recommandé
                  </span>
                )}
                <p className="text-sm font-semibold">{plan.name}</p>
                <p className={`mt-1 text-sm ${plan.featured ? 'text-white/55' : 'text-[#76818a]'}`}>{plan.note}</p>
                <p className="mt-8 text-4xl font-semibold tracking-tight">
                  {plan.price}
                  <span className={`text-sm font-normal ${plan.featured ? 'text-white/45' : 'text-[#89939b]'}`}>
                    {' '}
                    / mois
                  </span>
                </p>
                <p className={`mt-3 text-sm ${plan.featured ? 'text-[#a9f7cf]' : 'text-[#287656]'}`}>{plan.accounts}</p>
                <ul className="mt-7 space-y-3">
                  {plan.features.map((feature) => (
                    <li
                      key={feature}
                      className={`flex items-center gap-2 text-sm ${plan.featured ? 'text-white/72' : 'text-[#596771]'}`}
                    >
                      <Check className="size-4 text-[#36b77d]" />
                      {feature}
                    </li>
                  ))}
                </ul>
                <Button
                  asChild
                  variant={plan.featured ? 'default' : 'outline'}
                  className={`mt-8 w-full rounded-full ${plan.featured ? 'bg-[#6af0b1] text-[#0d1722] hover:bg-[#8ff8c7]' : ''}`}
                >
                  <Link href="/sign-up">Essayer gratuitement</Link>
                </Button>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-[#0d1722] text-white">
        <div className="mx-auto flex max-w-5xl flex-col items-center px-6 py-24 text-center">
          <BellRing className="size-9 text-[#6af0b1]" />
          <h2 className="mt-6 text-4xl font-semibold tracking-[-.045em] sm:text-5xl">
            Votre prochain client ne devrait pas ajouter de chaos.
          </h2>
          <p className="mt-5 max-w-2xl text-lg leading-8 text-white/58">
            Ajoutez son compte à votre MCC. Vigihat s’occupe du reste : surveillance, garde-fous, reporting et
            traçabilité.
          </p>
          <Button asChild size="lg" className="mt-8 rounded-full bg-[#6af0b1] px-7 text-[#0d1722]">
            <Link href="/sign-up">
              Créer mon espace <ArrowRight className="ml-2 size-4" />
            </Link>
          </Button>
        </div>
        <footer className="mx-auto flex max-w-7xl flex-col gap-4 border-t border-white/8 px-6 py-8 text-sm text-white/42 sm:flex-row sm:items-center sm:justify-between lg:px-8">
          <span>© {new Date().getFullYear()} Vigihat. Google Ads, sous contrôle.</span>
          <div className="flex gap-5">
            <Link href="/privacy">Confidentialité</Link>
            <Link href="/terms">Conditions</Link>
          </div>
        </footer>
      </section>
    </main>
  )
}

function Brand() {
  return (
    <Link href="/" className="flex items-center gap-3 font-semibold tracking-tight">
      <span className="relative grid size-10 place-items-center overflow-hidden rounded-xl bg-[#6af0b1] text-[#0d1722]">
        <span className="absolute -top-2 h-5 w-7 rounded-full border-2 border-current" />
        <span className="mt-2 text-sm font-black">V</span>
      </span>
      <span className="text-xl">Vigihat</span>
    </Link>
  )
}

function ProductPreview() {
  return (
    <div className="relative min-h-[460px]">
      <div className="absolute inset-0 rotate-2 rounded-[2.2rem] bg-[#6af0b1] opacity-10" />
      <div className="relative rounded-[2rem] border border-white/10 bg-white/[.07] p-5 shadow-[0_45px_100px_-35px_rgba(0,0,0,.65)] backdrop-blur sm:p-6">
        <div className="flex items-center justify-between border-b border-white/10 pb-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[.18em] text-white/38">Vue portefeuille</p>
            <p className="mt-1 text-lg font-semibold">Santé de l’agence</p>
          </div>
          <span className="rounded-full bg-[#6af0b1]/12 px-3 py-1.5 text-xs font-semibold text-[#9af7c9]">
            92 / 100
          </span>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-3">
          {[
            ['Comptes suivis', '12'],
            ['Investissement', '48 260 €'],
            ['Alertes ouvertes', '3'],
            ['Approbations', '1'],
          ].map(([label, value]) => (
            <div key={label} className="rounded-2xl border border-white/8 bg-black/10 p-4">
              <p className="text-xs text-white/38">{label}</p>
              <p className="mt-2 text-xl font-semibold">{value}</p>
            </div>
          ))}
        </div>
        <div className="mt-4 space-y-2">
          {[
            [Gauge, 'CPA au-dessus du plafond', 'Mail Certificate', 'Critique'],
            [UsersRound, 'Budget proche du seuil', 'Client Atlas', 'À vérifier'],
          ].map(([Icon, title, client, status]) => {
            const I = Icon as typeof Gauge
            return (
              <div
                key={String(title)}
                className="flex items-center gap-3 rounded-2xl border border-white/8 bg-white/[.04] p-3"
              >
                <span className="grid size-9 place-items-center rounded-xl bg-[#6af0b1]/12 text-[#8af5c2]">
                  <I className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{String(title)}</p>
                  <p className="mt-0.5 text-xs text-white/35">{String(client)}</p>
                </div>
                <span className="text-[10px] text-white/40">{String(status)}</span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
