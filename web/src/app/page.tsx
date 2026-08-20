import Link from 'next/link'
import { ArrowRight, BellRing, Bot, Check, Eye, Gauge, ShieldCheck, Sparkles, UsersRound } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { getLocale } from '@/lib/locale'

export default async function Home() {
  const locale = await getLocale()
  const english = locale === 'en'
  const pillars = [
    { icon: Eye, title: english ? 'Detect' : 'Détecter', description: english ? 'Search terms, Quality Score, ads, tracking and budgets analyzed from actual Google Ads data.' : 'Requêtes, Quality Score, annonces, tracking et budget analysés sur les données Google Ads réelles.' },
    { icon: Sparkles, title: english ? 'Explain' : 'Expliquer', description: english ? 'Every signal shows its evidence, impact, priority and the concrete action to review.' : 'Chaque signal montre sa preuve, son impact, sa priorité et l’action concrète à examiner.' },
    { icon: ShieldCheck, title: english ? 'Approve' : 'Approuver', description: english ? 'Writes are validated by Google, approved by a human and then recorded.' : 'Les écritures sont validées par Google, approuvées par un humain puis consignées.' },
    { icon: Bot, title: english ? 'Act' : 'Agir', description: english ? 'Daily monitors, controlled actions and client reports that work without you.' : 'Des vigies quotidiennes, des actions contrôlées et des rapports clients qui travaillent sans vous.' },
  ]
  const plans = [
    { name: 'Solo', price: '29 €', note: english ? 'A clean start' : 'Pour démarrer proprement', accounts: english ? '3 client accounts' : '3 comptes clients', features: english ? ['Google Ads cockpit', '360 analysis', '5 autonomous monitors', 'Secure approvals'] : ['Cockpit Google Ads', 'Analyse 360', '5 vigies autonomes', 'Approbations sécurisées'] },
    { name: 'Studio', price: '89 €', note: english ? 'The consultant choice' : 'Le choix des consultants', accounts: english ? '15 client accounts' : '15 comptes clients', featured: true, features: english ? ['Everything in Solo', '25 active reports', '5 members', 'Scheduled reports'] : ['Tout Solo', '25 rapports actifs', '5 membres', 'Rapports programmés'] },
    { name: 'Agency', price: '189 €', note: english ? 'For growing teams' : 'Pour les équipes en croissance', accounts: english ? '50 client accounts' : '50 comptes clients', features: english ? ['Everything in Studio', '100 active reports', '15 members', 'White label and safety rules'] : ['Tout Studio', '100 rapports actifs', '15 membres', 'Marque blanche et règles de sécurité'] },
  ]
  return (
    <main className="min-h-screen overflow-hidden bg-[#f4f7f7] text-[#0d1722]">
      <section className="relative bg-[#0d1722] text-white">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_76%_12%,rgba(106,240,177,.17),transparent_28%),radial-gradient(circle_at_40%_100%,rgba(69,139,255,.12),transparent_34%)]" />
        <nav className="relative mx-auto flex max-w-7xl items-center justify-between px-6 py-6 lg:px-8">
          <Brand />
          <div className="flex items-center gap-3">
            <Button asChild variant="ghost" className="text-white hover:bg-white/10 hover:text-white">
              <Link href="/sign-in">
                {english ? 'Sign in' : 'Se connecter'}
              </Link>
            </Button>
            <Button asChild className="rounded-full bg-[#19A58F] px-5 text-[#0d1722] hover:bg-[#35BDA6]">
              <Link href="/sign-up">{english ? 'Try Ads by Yodev' : 'Essayer Ads by Yodev'}</Link>
            </Button>
          </div>
        </nav>
        <div className="relative mx-auto grid max-w-7xl gap-14 px-6 pb-24 pt-20 lg:grid-cols-[1.06fr_.94fr] lg:px-8 lg:pb-32 lg:pt-28">
          <div>
            <p className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/6 px-4 py-2 text-sm text-[#67D8C4]">
              <Sparkles className="size-4" /> {english ? 'Google Ads, with no blind spots' : 'Google Ads, sans angle mort'}
            </p>
            <h1 className="mt-7 max-w-3xl text-balance text-5xl font-semibold leading-[1.01] tracking-[-.055em] sm:text-6xl lg:text-7xl">
              {english ? 'The operating system for Google Ads agencies.' : 'Le système d’exploitation des agences Google Ads.'}
            </h1>
            <p className="mt-7 max-w-2xl text-lg leading-8 text-white/62 sm:text-xl">
              {english ? 'Ads by Yodev monitors every account, explains anomalies and secures changes—so you can manage more clients without losing control.' : 'Ads by Yodev surveille chaque compte, explique les anomalies et sécurise les changements — pour gérer plus de clients sans perdre le contrôle.'}
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-4">
              <Button
                asChild
                size="lg"
                className="h-12 rounded-full bg-[#19A58F] px-6 text-[#0d1722] shadow-xl shadow-emerald-500/10 hover:bg-[#35BDA6]"
              >
                <Link href="/sign-up">
                  {english ? 'Start free trial' : 'Démarrer l’essai'} <ArrowRight className="ml-2 size-4" />
                </Link>
              </Button>
              <span className="flex items-center gap-2 text-sm text-white/55">
                <Check className="size-4 text-[#19A58F]" /> {english ? 'Official Google Ads API' : 'API Google Ads officielle'}
              </span>
            </div>
          </div>
          <ProductPreview locale={locale} />
        </div>
      </section>

      <section className="border-b border-black/6 bg-white">
        <div className="mx-auto grid max-w-7xl grid-cols-2 gap-y-8 px-6 py-10 text-center sm:grid-cols-4 lg:px-8">
          {[
            ['100 %', english ? 'traceable' : 'traçable'],
            ['24 h', english ? 'approval validity' : 'validité des approbations'],
            ['AES-256', english ? 'token encryption' : 'chiffrement des jetons'],
            ['0', english ? 'write without validation' : 'écriture sans validation'],
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
          <p className="text-xs font-bold uppercase tracking-[.2em] text-[#19A58F]">{english ? 'A complete decision cycle' : 'Un cycle de décision complet'}</p>
          <h2 className="mt-4 text-4xl font-semibold tracking-[-.045em] sm:text-5xl">
            {english ? 'From raw data to safe action.' : 'De la donnée brute à l’action sûre.'}
          </h2>
          <p className="mt-5 text-lg leading-8 text-[#64717b]">
            {english ? 'Ads by Yodev does more than display metrics. It organizes your agency’s daily work.' : 'Ads by Yodev ne se contente pas d’afficher des métriques. Il organise le travail quotidien de votre agence.'}
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
              <p className="text-xs font-bold uppercase tracking-[.2em] text-[#19A58F]">{english ? 'Transparent pricing' : 'Tarification transparente'}</p>
              <h2 className="mt-4 text-4xl font-semibold tracking-[-.045em] sm:text-5xl">
                {english ? 'Pay for managed accounts,' : 'Payez pour les comptes gérés,'}
                <br />
                {english ? 'not clicks in the tool.' : 'pas pour des clics dans l’outil.'}
              </h2>
            </div>
            <p className="max-w-md text-sm leading-6 text-[#64717b]">
              {english ? '14-day trial without a card, then monthly billing in euros. No commission on your advertising spend.' : '14 jours d’essai sans carte, puis facturation mensuelle en euros. Aucune commission sur vos dépenses publicitaires.'}
            </p>
          </div>
          <div className="mt-12 grid gap-5 lg:grid-cols-3">
            {plans.map((plan) => (
              <article
                key={plan.name}
                className={`relative rounded-3xl border p-7 ${plan.featured ? 'border-[#0d1722] bg-[#0d1722] text-white shadow-2xl shadow-slate-900/15' : 'border-black/7 bg-white'}`}
              >
                {plan.featured && (
                  <span className="absolute right-6 top-6 rounded-full bg-[#19A58F] px-3 py-1 text-xs font-semibold text-[#0d1722]">
                    {english ? 'Recommended' : 'Recommandé'}
                  </span>
                )}
                <p className="text-sm font-semibold">{plan.name}</p>
                <p className={`mt-1 text-sm ${plan.featured ? 'text-white/55' : 'text-[#76818a]'}`}>{plan.note}</p>
                <p className="mt-8 text-4xl font-semibold tracking-tight">
                  {plan.price}
                  <span className={`text-sm font-normal ${plan.featured ? 'text-white/45' : 'text-[#89939b]'}`}>
                    {' '}
                    / {english ? 'month' : 'mois'}
                  </span>
                </p>
                <p className={`mt-3 text-sm ${plan.featured ? 'text-[#67D8C4]' : 'text-[#19A58F]'}`}>{plan.accounts}</p>
                <ul className="mt-7 space-y-3">
                  {plan.features.map((feature) => (
                    <li
                      key={feature}
                      className={`flex items-center gap-2 text-sm ${plan.featured ? 'text-white/72' : 'text-[#596771]'}`}
                    >
                      <Check className="size-4 text-[#19A58F]" />
                      {feature}
                    </li>
                  ))}
                </ul>
                <Button
                  asChild
                  variant={plan.featured ? 'default' : 'outline'}
                  className={`mt-8 w-full rounded-full ${plan.featured ? 'bg-[#19A58F] text-[#0d1722] hover:bg-[#35BDA6]' : ''}`}
                >
                  <Link href="/sign-up">{english ? 'Try for free' : 'Essayer gratuitement'}</Link>
                </Button>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-[#0d1722] text-white">
        <div className="mx-auto flex max-w-5xl flex-col items-center px-6 py-24 text-center">
          <BellRing className="size-9 text-[#19A58F]" />
          <h2 className="mt-6 text-4xl font-semibold tracking-[-.045em] sm:text-5xl">
            {english ? 'Your next client should not add chaos.' : 'Votre prochain client ne devrait pas ajouter de chaos.'}
          </h2>
          <p className="mt-5 max-w-2xl text-lg leading-8 text-white/58">
            {english ? 'Add their account to your MCC. Ads by Yodev handles the rest: monitoring, safeguards, reporting and traceability.' : 'Ajoutez son compte à votre MCC. Ads by Yodev s’occupe du reste : surveillance, garde-fous, reporting et traçabilité.'}
          </p>
          <Button asChild size="lg" className="mt-8 rounded-full bg-[#19A58F] px-7 text-[#0d1722]">
            <Link href="/sign-up">
              {english ? 'Create my workspace' : 'Créer mon espace'} <ArrowRight className="ml-2 size-4" />
            </Link>
          </Button>
        </div>
        <footer className="mx-auto flex max-w-7xl flex-col gap-4 border-t border-white/8 px-6 py-8 text-sm text-white/42 sm:flex-row sm:items-center sm:justify-between lg:px-8">
          <span>© {new Date().getFullYear()} Ads by Yodev. {english ? 'Google Ads, under control.' : 'Google Ads, sous contrôle.'}</span>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            <Link href="/legal">{english ? 'Legal notice' : 'Mentions légales'}</Link>
            <Link href="/privacy">{english ? 'Privacy' : 'Confidentialité'}</Link>
            <Link href="/terms">{english ? 'Terms' : 'Conditions'}</Link>
            <Link href="/cookies">Cookies</Link>
            <Link href="/subprocessors">{english ? 'Subprocessors' : 'Sous-traitants'}</Link>
          </div>
        </footer>
      </section>
    </main>
  )
}

function Brand() {
  return (
    <Link href="/" className="flex items-center gap-3 font-semibold tracking-tight">
      <span className="relative grid size-10 place-items-center overflow-hidden rounded-xl bg-[#19A58F] text-[#0d1722]">
        <span className="absolute -top-2 h-5 w-7 rounded-full border-2 border-current" />
        <span className="mt-2 text-sm font-black">A</span>
      </span>
      <span className="inline-flex items-baseline gap-1.5"><span className="text-xl">Ads</span><span className="font-mono text-[10px] uppercase tracking-[.16em] text-white/50">by Yodev</span></span>
    </Link>
  )
}

function ProductPreview({ locale }: { locale: 'fr' | 'en' }) {
  const english = locale === 'en'
  return (
    <div className="relative min-h-[460px]">
      <div className="absolute inset-0 rotate-2 rounded-[2.2rem] bg-[#19A58F] opacity-10" />
      <div className="relative rounded-[2rem] border border-white/10 bg-white/[.07] p-5 shadow-[0_45px_100px_-35px_rgba(0,0,0,.65)] backdrop-blur sm:p-6">
        <div className="flex items-center justify-between border-b border-white/10 pb-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[.18em] text-white/38">{english ? 'Portfolio view' : 'Vue portefeuille'}</p>
            <p className="mt-1 text-lg font-semibold">{english ? 'Agency health' : 'Santé de l’agence'}</p>
          </div>
          <span className="rounded-full bg-[#19A58F]/12 px-3 py-1.5 text-xs font-semibold text-[#67D8C4]">
            92 / 100
          </span>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-3">
          {[
            [english ? 'Monitored accounts' : 'Comptes suivis', '12'],
            [english ? 'Spend' : 'Investissement', '48 260 €'],
            [english ? 'Open alerts' : 'Alertes ouvertes', '3'],
            [english ? 'Approvals' : 'Approbations', '1'],
          ].map(([label, value]) => (
            <div key={label} className="rounded-2xl border border-white/8 bg-black/10 p-4">
              <p className="text-xs text-white/38">{label}</p>
              <p className="mt-2 text-xl font-semibold">{value}</p>
            </div>
          ))}
        </div>
        <div className="mt-4 space-y-2">
          {[
            [Gauge, english ? 'CPA above limit' : 'CPA au-dessus du plafond', 'Mail Certificate', english ? 'Critical' : 'Critique'],
            [UsersRound, english ? 'Budget near threshold' : 'Budget proche du seuil', 'Client Atlas', english ? 'Review' : 'À vérifier'],
          ].map(([Icon, title, client, status]) => {
            const I = Icon as typeof Gauge
            return (
              <div
                key={String(title)}
                className="flex items-center gap-3 rounded-2xl border border-white/8 bg-white/[.04] p-3"
              >
                <span className="grid size-9 place-items-center rounded-xl bg-[#19A58F]/12 text-[#67D8C4]">
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
