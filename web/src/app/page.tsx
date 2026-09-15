import { YodevBrand, ProductLinks } from "@/brand/brand";
import { AppearanceToggle } from "@/components/appearance";
import { LocaleSwitcher } from "@/components/locale-switcher";
import Link from 'next/link'
import { ArrowRight, BellRing, Bot, Check, Eye, Gauge, ShieldCheck, Sparkles, UsersRound } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { getLocale } from '@/lib/locale'
import { featureEnabled } from '@/lib/feature-flags'
import { planCatalog } from '@/lib/billing'
import { entitlementContext } from '@/lib/entitlements'

export default async function Home() {
  const locale = await getLocale()
  const english = locale === 'en'
  const publicTrial = featureEnabled('publicBeta')
  const accessLabel = publicTrial ? (english ? 'Start free trial' : 'Démarrer l’essai') : (english ? 'I have an invitation' : 'J’ai une invitation')
  const registrationNote = publicTrial
    ? (english ? '14-day trial without a card for your first workspace. Choose a subscription separately when billing is available.' : '14 jours d’essai sans carte pour votre premier espace. La souscription à un abonnement se fait séparément, lorsqu’elle est ouverte.')
    : (english ? 'Private beta by invitation. Use the approved email address to create your account. These catalogue prices do not open a subscription.' : 'Bêta privée sur invitation. Utilisez l’adresse email autorisée pour créer votre compte. Ces tarifs catalogue n’ouvrent pas une souscription.')
  const pillars = [
    { icon: Eye, title: english ? 'Detect' : 'Détecter', description: english ? 'Search terms, Quality Score, ads, tracking and budgets analyzed from actual Google Ads data.' : 'Requêtes, Quality Score, annonces, tracking et budget analysés sur les données Google Ads réelles.' },
    { icon: Sparkles, title: english ? 'Explain' : 'Expliquer', description: english ? 'Every signal shows its evidence, impact, priority and the concrete action to review.' : 'Chaque signal montre sa preuve, son impact, sa priorité et l’action concrète à examiner.' },
    { icon: ShieldCheck, title: english ? 'Approve' : 'Approuver', description: english ? 'Writes are validated by Google, approved by a human and then recorded.' : 'Les écritures sont validées par Google, approuvées par un humain puis consignées.' },
    { icon: Bot, title: english ? 'Organize' : 'Organiser', description: english ? 'Schedule monitors and client reports, then review their results and delivery status.' : 'Programmez vos vigies et rapports clients, puis consultez leurs résultats et leur état de livraison.' },
  ]
  const plans = (['solo', 'studio', 'agency'] as const).map((id) => {
    const catalogue = planCatalog[id]
    const limits = entitlementContext('active', id).limits
    return {
      name: catalogue.name, price: `${catalogue.monthlyPrice} €`, featured: id === 'studio',
      note: id === 'solo' ? (english ? 'For independent professionals' : 'Pour les indépendants') : id === 'studio' ? (english ? 'For small teams' : 'Pour les petites équipes') : (english ? 'For growing agencies' : 'Pour les agences en croissance'),
      accounts: english ? `${limits.advertiserAccounts} client accounts` : `${limits.advertiserAccounts} comptes clients`,
      features: english ? [`${limits.monitors} monitors`, `${limits.reports} active reports`, `${limits.members} member${limits.members === 1 ? '' : 's'}`, id === 'solo' ? 'Cockpit and 360 analysis' : 'Teamwork and scheduled reports'] : [`${limits.monitors} vigies`, `${limits.reports} rapports actifs`, `${limits.members} membre${limits.members === 1 ? '' : 's'}`, id === 'solo' ? 'Cockpit et analyse 360' : 'Équipe et rapports programmés'],
    }
  })
  return (
    <main className="min-h-screen overflow-hidden bg-card text-foreground">
      <section className="relative bg-card text-foreground">
        <div className="pointer-events-none absolute inset-0 bg-background" />
        <nav className="relative mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-6 py-6 lg:px-8">
          <Brand />
          <div className="flex w-full flex-wrap items-center gap-3 sm:w-auto"><LocaleSwitcher locale={locale}/><AppearanceToggle locale={locale}/>
            <Button asChild variant="ghost" className="text-foreground hover:bg-card hover:text-foreground">
              <Link href="/sign-in">
                {english ? 'Sign in' : 'Se connecter'}
              </Link>
            </Button>
            <Button asChild className="rounded-md bg-primary px-5 text-primary-foreground hover:bg-primary">
              <Link href="/sign-up">{accessLabel}</Link>
            </Button>
          </div>
        </nav>
        <div className="relative mx-auto grid max-w-7xl gap-14 px-6 pb-24 pt-20 lg:grid-cols-[1.15fr_.85fr] lg:px-8 lg:pb-32 lg:pt-28">
          <div>
            <p className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-4 py-2 text-sm text-primary">
              <Sparkles className="size-4" /> {publicTrial ? (english ? 'Public trial' : 'Essai public') : (english ? 'Private beta by invitation' : 'Bêta privée sur invitation')}
            </p>
            <h1 className="mt-7 max-w-3xl text-balance text-5xl font-semibold leading-[1.01] tracking-[-.055em] sm:text-6xl lg:text-6xl">
              {english ? 'The operating system for Google Ads agencies.' : 'Le système d’exploitation des agences Google Ads.'}
            </h1>
            <p className="mt-7 max-w-2xl text-lg leading-8 text-muted-foreground sm:text-xl">
              {english ? 'Yodev Ads monitors every account, explains anomalies and secures changes—so you can manage more clients without losing control.' : 'Yodev Ads surveille chaque compte, explique les anomalies et sécurise les changements — pour gérer plus de clients sans perdre le contrôle.'}
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-4">
              <Button
                asChild
                size="lg"
                className="h-12 rounded-md bg-primary px-6 text-primary-foreground   hover:bg-primary"
              >
                <Link href="/sign-up">
                  {accessLabel} <ArrowRight className="ml-2 size-4" />
                </Link>
              </Button>
              <span className="flex items-center gap-2 text-sm text-muted-foreground">
                <Check className="size-4 text-primary" /> {english ? 'Official Google Ads API' : 'API Google Ads officielle'}
              </span>
            </div>
            <p className="mt-5 max-w-xl text-sm leading-6 text-muted-foreground">{registrationNote}</p>
            <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">{english ? 'Google changes and external connectors become available after validation for your workspace. No automatic Google changes.' : 'Les changements Google et connecteurs externes sont disponibles après validation pour votre espace. Aucune modification Google automatique.'}</p>
          </div>
          <ProductPreview locale={locale} />
        </div>
      </section>

      <section className="border-b border-border bg-card">
        <div className="mx-auto grid max-w-7xl grid-cols-2 gap-y-8 px-6 py-10 text-center sm:grid-cols-4 lg:px-8">
          {[
            [english ? 'Audit' : 'Journal', english ? 'recorded actions' : 'actions consignées'],
            ['24 h', english ? 'approval validity' : 'validité des approbations'],
            ['AES-256', english ? 'token encryption' : 'chiffrement des jetons'],
            ['0', english ? 'write without validation' : 'écriture sans validation'],
          ].map(([value, label]) => (
            <div key={label}>
              <p className="text-2xl font-semibold tracking-tight">{value}</p>
              <p className="mt-1 text-xs uppercase tracking-wider text-muted-foreground">{label}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-6 py-24 lg:px-8">
        <div className="max-w-2xl">
          <p className="text-xs font-bold uppercase tracking-[.2em] text-primary">{english ? 'A complete decision cycle' : 'Un cycle de décision complet'}</p>
          <h2 className="mt-4 text-4xl font-semibold tracking-[-.045em] sm:text-5xl">
            {english ? 'From raw data to safe action.' : 'De la donnée brute à l’action sûre.'}
          </h2>
          <p className="mt-5 text-lg leading-8 text-muted-foreground">
            {english ? 'Yodev Ads does more than display metrics. It organizes your agency’s daily work.' : 'Yodev Ads ne se contente pas d’afficher des métriques. Il organise le travail quotidien de votre agence.'}
          </p>
        </div>
        <div className="mt-12 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {pillars.map(({ icon: Icon, title, description }, index) => (
            <article key={title} className="rounded-md border border-border bg-card p-6">
              <span className="text-xs font-semibold text-muted-foreground">0{index + 1}</span>
              <span className="mt-8 grid size-11 place-items-center rounded-md bg-card text-muted-foreground">
                <Icon className="size-5" />
              </span>
              <h3 className="mt-5 text-xl font-semibold">{title}</h3>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="bg-card">
        <div className="mx-auto max-w-7xl px-6 py-24 lg:px-8">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-[.2em] text-primary">{english ? 'Transparent pricing' : 'Tarification transparente'}</p>
              <h2 className="mt-4 text-4xl font-semibold tracking-[-.045em] sm:text-5xl">
                {english ? 'Pay for managed accounts,' : 'Payez pour les comptes gérés,'}
                <br />
                {english ? 'not clicks in the tool.' : 'pas pour des clics dans l’outil.'}
              </h2>
            </div>
            <p className="max-w-md text-sm leading-6 text-muted-foreground">
              {registrationNote}
            </p>
          </div>
          <div className="mt-12 grid gap-5 lg:grid-cols-3">
            {plans.map((plan) => (
              <article
                key={plan.name}
                className={`relative rounded-md border p-7 ${plan.featured ? 'border-border bg-card text-foreground  ' : 'border-border bg-card'}`}
              >
                {plan.featured && (
                  <span className="absolute right-6 top-6 rounded-md bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground">
                    {english ? 'Recommended' : 'Recommandé'}
                  </span>
                )}
                <p className="text-sm font-semibold">{plan.name}</p>
                <p className={`mt-1 text-sm ${plan.featured ? 'text-muted-foreground' : 'text-muted-foreground'}`}>{plan.note}</p>
                <p className="mt-8 text-4xl font-semibold tracking-tight">
                  {plan.price}
                  <span className={`text-sm font-normal ${plan.featured ? 'text-muted-foreground' : 'text-muted-foreground'}`}>
                    {' '}
                    / {english ? 'month' : 'mois'}
                  </span>
                </p>
                <p className={`mt-3 text-sm ${plan.featured ? 'text-primary' : 'text-primary'}`}>{plan.accounts}</p>
                <ul className="mt-7 space-y-3">
                  {plan.features.map((feature) => (
                    <li
                      key={feature}
                      className={`flex items-center gap-2 text-sm ${plan.featured ? 'text-muted-foreground' : 'text-muted-foreground'}`}
                    >
                      <Check className="size-4 text-primary" />
                      {feature}
                    </li>
                  ))}
                </ul>
                <Button
                  asChild
                  variant={plan.featured ? 'default' : 'outline'}
                  className={`mt-8 w-full rounded-md ${plan.featured ? 'bg-primary text-primary-foreground hover:bg-primary' : ''}`}
                >
                  <Link href="/sign-up">{accessLabel}</Link>
                </Button>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-card text-foreground">
        <div className="mx-auto flex max-w-5xl flex-col items-center px-6 py-24 text-center">
          <BellRing className="size-9 text-primary" />
          <h2 className="mt-6 text-4xl font-semibold tracking-[-.045em] sm:text-5xl">
            {english ? 'Your next client should not add chaos.' : 'Votre prochain client ne devrait pas ajouter de chaos.'}
          </h2>
          <p className="mt-5 max-w-2xl text-lg leading-8 text-muted-foreground">
            {english ? 'Connect your MCC, select the client accounts you manage, then configure their monitors and reports.' : 'Connectez votre MCC, sélectionnez les comptes clients à gérer, puis configurez leurs vigies et leurs rapports.'}
          </p>
          <Button asChild size="lg" className="mt-8 rounded-md bg-primary px-7 text-primary-foreground">
            <Link href="/sign-up">
              {accessLabel} <ArrowRight className="ml-2 size-4" />
            </Link>
          </Button>
        </div>
        <footer className="mx-auto flex max-w-7xl flex-col gap-4 border-t border-border px-6 py-8 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between lg:px-8">
          <span>© {new Date().getFullYear()} Yodev Ads. {english ? 'Google Ads, under control.' : 'Google Ads, sous contrôle.'}</span>
          <div className="flex flex-wrap gap-x-5 gap-y-2"><ProductLinks current="ads" locale={locale}/>
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

function Brand() { return <Link href="/" aria-label="Yodev Ads"><YodevBrand product="ads" className="text-xl"/></Link>; }

function ProductPreview({ locale }: { locale: 'fr' | 'en' }) {
  const english = locale === 'en'
  return (
    <div className="relative min-h-[460px]">
      <div className="absolute inset-0  rounded-md bg-primary opacity-10" />
      <div className="relative rounded-md border border-border bg-card p-5   sm:p-6">
        <p className="mb-4 text-xs text-muted-foreground">{english ? 'Illustrative preview — fictional data' : 'Aperçu illustratif — données fictives'}</p>
        <div className="flex items-center justify-between border-b border-border pb-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[.18em] text-muted-foreground">{english ? 'Portfolio view' : 'Vue portefeuille'}</p>
            <p className="mt-1 text-lg font-semibold">{english ? 'Agency health' : 'Santé de l’agence'}</p>
          </div>
          <span className="rounded-md bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary">
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
            <div key={label} className="rounded-md border border-border bg-black/10 p-4">
              <p className="text-xs text-muted-foreground">{label}</p>
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
                className="flex items-center gap-3 rounded-md border border-border bg-card p-3"
              >
                <span className="grid size-9 place-items-center rounded-md bg-primary/10 text-primary">
                  <I className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{String(title)}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{String(client)}</p>
                </div>
                <span className="text-[10px] text-muted-foreground">{String(status)}</span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
